import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BlockRegion, FlowGraph } from '../../src/core/types';

/**
 * Block view: the entry function folded into AST-derived blocks.
 *
 * The data-flow canvas is honest but unreadable past a few dozen nodes — a
 * 140-line dispatcher becomes ~170 boxes in one column. `parse_flow.py`
 * already returns `graph.regions` (one block per if/elif branch, per loop,
 * plus def-use clusters for linear runs), so this panel just lays those
 * blocks out by dependency depth and lets you drill in.
 *
 * Read-only by design: it never touches the graph or the generated code.
 */

const CARD_W = 148;
const CARD_H = 40;
const GAP_X = 12;
const GAP_Y = 8;
const MAX_COLS = 4;
const LAYER_GAP = 22;
const KIND_COLOR: Record<string, string> = {
  case: 'var(--fc-amber)',
  linear: 'var(--fc-accent)',
  misc: 'var(--fc-dim)',
};

interface Props {
  graph: FlowGraph;
  onReveal: (line: number) => void;
}

interface Placed {
  region: BlockRegion;
  x: number;
  y: number;
}

function buildDeps(regions: BlockRegion[]) {
  const deps = new Map<string, string[]>();
  const outs = new Map<string, string[]>();
  const known = new Set(regions.map((region) => region.id));
  for (const region of regions) {
    deps.set(region.id, []);
    outs.set(region.id, []);
  }
  for (const region of regions) {
    for (const to of region.edgesOut ?? []) {
      if (!known.has(to)) continue;
      deps.get(to)!.push(region.id);
      outs.get(region.id)!.push(to);
    }
  }
  return { deps, outs };
}

function depthOf(deps: Map<string, string[]>) {
  const memo = new Map<string, number>();
  const visit = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    let depth = 0;
    for (const parent of deps.get(id) ?? []) depth = Math.max(depth, visit(parent) + 1);
    memo.set(id, depth);
    return depth;
  };
  for (const id of deps.keys()) visit(id);
  return memo;
}

function closure(id: string, map: Map<string, string[]>) {
  const seen = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const next of map.get(current) ?? []) walk(next);
  };
  walk(id);
  return seen;
}

/** Longest prefix shared by >=60% of the labels, e.g. "node 是". */
function dominantPrefix(labels: string[]) {
  if (labels.length < 3) return '';
  let best = '';
  for (const seed of labels) {
    for (let len = Math.max(best.length + 1, 3); len <= Math.min(seed.length, 12); len += 1) {
      const candidate = seed.slice(0, len);
      const hits = labels.filter((label) => label.startsWith(candidate)).length;
      if (hits / labels.length >= 0.6 && candidate.length > best.length) best = candidate;
    }
  }
  return best.replace(/\s+$/, '');
}

function layout(depths: Map<string, number>, regions: BlockRegion[]) {
  const byLayer = new Map<number, BlockRegion[]>();
  for (const region of regions) {
    const depth = depths.get(region.id) ?? 0;
    if (!byLayer.has(depth)) byLayer.set(depth, []);
    byLayer.get(depth)!.push(region);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const spec = layers.map((depth) => {
    const items = byLayer.get(depth)!.slice().sort((a, b) => a.startLine - b.startLine);
    const cols = Math.min(items.length, MAX_COLS);
    const rows = Math.ceil(items.length / cols);
    return {
      depth,
      items,
      cols,
      rows,
      width: cols * (CARD_W + GAP_X) - GAP_X,
      height: rows * (CARD_H + GAP_Y) - GAP_Y,
    };
  });
  const width = spec.reduce((max, layer) => Math.max(max, layer.width), 0);

  const placed = new Map<string, Placed>();
  const boxes: { depth: number; y: number; height: number }[] = [];
  let y = 0;
  for (const layer of spec) {
    const x0 = (width - layer.width) / 2;
    layer.items.forEach((region, index) => {
      const row = Math.floor(index / layer.cols);
      const col = index % layer.cols;
      placed.set(region.id, {
        region,
        x: x0 + col * (CARD_W + GAP_X),
        y: y + row * (CARD_H + GAP_Y),
      });
    });
    boxes.push({ depth: layer.depth, y, height: layer.height });
    y += layer.height + LAYER_GAP;
  }
  return { placed, boxes, width, height: Math.max(0, y - LAYER_GAP) };
}

export function BlockView({ graph, onReveal }: Props) {
  // 空块（docstring / pass 之类，size === 0）没有可渲染内容，渲染前再兜一道，
  // 防止旧版本解析器产出的缓存图把 "0 段" 带进界面
  const regions = useMemo(
    () => (graph.regions ?? []).filter((region) => region.size > 0),
    [graph.regions],
  );
  const [open, setOpen] = useState(false);
  const [sliceMode, setSliceMode] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setFocus(null);
    setSelected(null);
  }, [graph.id, graph.name]);

  const labels = useMemo(
    () => regions.map((region) => region.name || region.label || region.id),
    [regions],
  );
  const prefix = useMemo(() => dominantPrefix(labels), [labels]);

  const model = useMemo(() => {
    if (!regions.length) return null;
    const { deps, outs } = buildDeps(regions);
    const depths = depthOf(deps);
    return { deps, outs, ...layout(depths, regions) };
  }, [regions]);

  const focusUp = useMemo(
    () => (sliceMode && focus && model ? closure(focus, model.deps) : null),
    [sliceMode, focus, model],
  );
  const focusDown = useMemo(
    () => (sliceMode && focus && model ? closure(focus, model.outs) : null),
    [sliceMode, focus, model],
  );

  const choose = useCallback(
    (region: BlockRegion) => {
      setSelected(region.id);
      if (sliceMode) setFocus((current) => (current === region.id ? null : region.id));
    },
    [sliceMode],
  );

  const current = regions.find((region) => region.id === selected) ?? null;
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  const width = (model?.width ?? 0) + 24;
  const height = (model?.height ?? 0) + 46;

  return (
    <>
      <button
        type="button"
        className="blockview-launch"
        title="把当前函数按 AST 结构折叠成块（只读，不影响生成代码）"
        onClick={() => setOpen((value) => !value)}
      >
        <span>▦</span>
        <span>块视图</span>
        {regions.length > 0 && <span className="blockview-count">{regions.length}</span>}
      </button>

      {open && (
        <aside className="blockview-panel" aria-label="块视图">
          <header className="blockview-head">
            <span className="blockview-title">块视图</span>
            <span className="blockview-stat">
              {regions.length > 0 ? `${graph.nodes.length} 节点 → ${regions.length} 块` : '无分块信息'}
            </span>
            <button type="button" className="blockview-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
          </header>

          <div className="blockview-modes">
            <button
              type="button"
              className={`blockview-mode ${sliceMode ? '' : 'is-on'}`}
              onClick={() => { setSliceMode(false); setFocus(null); }}
            >
              结构
            </button>
            <button
              type="button"
              className={`blockview-mode ${sliceMode ? 'is-on' : ''}`}
              onClick={() => setSliceMode(true)}
            >
              切片
            </button>
            <span className="blockview-hint">
              {sliceMode
                ? '点块 = 聚焦上下游依赖'
                : prefix
                  ? `块名统一前缀「${prefix}」`
                  : '点块看内部 · 点节点跳源码'}
            </span>
          </div>

          <div className="blockview-stage">
            {!model ? (
              <p className="blockview-empty">
                {graph.nodes.length
                  ? '当前函数没有分块信息。\n（Notebook 单元模式暂不支持块视图）'
                  : '打开一个 Python 文件并执行「FlowCode: 打开流程图」。'}
              </p>
            ) : (
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                style={{ height: 'auto', maxWidth: width, display: 'block' }}
              >
                {model.boxes.map((box) => (
                  <g key={box.depth}>
                    <rect
                      x={4} y={box.y + 18} width={width - 8} height={box.height + 14}
                      rx={9} fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.05)"
                    />
                    <text x={8} y={box.y + 12} fill="var(--fc-dim)" fontSize={9}>
                      第 {box.depth} 层
                    </text>
                  </g>
                ))}

                {[...model.placed.values()].flatMap((from) =>
                  (from.region.edgesOut ?? []).map((toId) => {
                    const to = model.placed.get(toId);
                    if (!to) return null;
                    const active =
                      !focusUp ||
                      (focusUp.has(from.region.id) && focusUp.has(toId)) ||
                      (focusDown!.has(from.region.id) && focusDown!.has(toId));
                    const x1 = from.x + 12 + CARD_W / 2;
                    const y1 = from.y + 18 + CARD_H;
                    const x2 = to.x + 12 + CARD_W / 2;
                    const y2 = to.y + 18;
                    const dy = Math.max(16, (y2 - y1) * 0.5);
                    return (
                      <path
                        key={`${from.region.id}->${toId}`}
                        d={`M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`}
                        fill="none"
                        stroke={active ? 'var(--fc-accent)' : 'var(--fc-border-strong)'}
                        strokeWidth={active ? 1.2 : 1}
                        opacity={active ? 0.7 : 0.25}
                      />
                    );
                  }),
                )}

                {[...model.placed.values()].map(({ region, x, y }) => {
                  const dimmed = focusUp && !focusUp.has(region.id) && !focusDown!.has(region.id);
                  const isSelected = selected === region.id;
                  const isFocus = focus === region.id;
                  const raw = region.name || region.label || region.id;
                  const text = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw;
                  return (
                    <g
                      key={region.id}
                      transform={`translate(${x + 12},${y + 18})`}
                      opacity={dimmed ? 0.3 : 1}
                      style={{ cursor: 'pointer' }}
                      onClick={() => choose(region)}
                    >
                      <rect
                        width={CARD_W} height={CARD_H} rx={7}
                        fill={isSelected ? 'var(--fc-panel-3)' : 'var(--fc-panel-2)'}
                        stroke={isFocus ? 'var(--fc-green)' : isSelected ? 'var(--fc-accent)' : 'var(--fc-border-strong)'}
                        strokeWidth={isFocus || isSelected ? 1.6 : 1}
                      />
                      <rect
                        x={0} y={6} width={2.5} height={CARD_H - 12} rx={1.2}
                        fill={KIND_COLOR[region.kind] ?? 'var(--fc-accent-2)'}
                      />
                      <text x={10} y={17} fontSize={11} fontWeight={600}
                        fill={region.name ? 'var(--fc-green)' : 'var(--fc-text)'}>
                        {text.length > 16 ? `${text.slice(0, 15)}…` : text}
                      </text>
                      <text x={10} y={30} fontSize={9} fill="var(--fc-dim)">
                        {region.size} 段 · L{region.startLine}–{region.endLine}
                      </text>
                      <title>
                        {`${raw}\n${region.condition ?? ''}\n进入: ${region.inputs.join(', ') || '—'}\n输出: ${region.outputs.join(', ') || '—'}`}
                      </title>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {current && (
            <div className="blockview-detail">
              <div className="blockview-detail-head">
                <b>{current.name || current.label || current.id}</b>
                <span>{current.size} 段 · L{current.startLine}–{current.endLine}</span>
                {current.outputs.length > 0 && <span>→ {current.outputs.slice(0, 4).join(', ')}</span>}
              </div>
              {current.nodes.length === 0 && <p className="blockview-node">（该块没有可下钻的节点）</p>}
              {current.nodes.slice(0, 60).map((id) => {
                const node = nodeById.get(id);
                if (!node) return null;
                const line = node.sourceRange?.start.line;
                return (
                  <button
                    type="button"
                    key={id}
                    className="blockview-node"
                    title={line ? `跳转到源码第 ${line} 行` : undefined}
                    onClick={() => line && onReveal(line)}
                  >
                    <span className="blockview-node-line">{line ?? '—'}</span>
                    <span className="blockview-node-name">{node.name}</span>
                    <span className="blockview-node-effect">{node.effect}</span>
                  </button>
                );
              })}
            </div>
          )}

          <footer className="blockview-foot">
            只读视图 · 不影响「应用到代码」的生成结果
          </footer>
        </aside>
      )}
    </>
  );
}
