import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileEdge, FileGraph, FileNode } from '../../../src/core/types';
import { clamp } from '../utils';
import { FileCode, Fit, Search, Warning } from '../icons';
import type { Viewport } from '../store';

export const FILE_WIDTH = 252;
export const FILE_HEIGHT = 116;

interface FileLayout extends FileGraph {
  nodes: (FileNode & { position: { x: number; y: number } })[];
}

export function layoutFileGraph(graph: FileGraph): FileGraph {
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges) incoming.get(edge.to)?.push(edge.from);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const value = parents.length ? Math.max(...parents.map((parent) => visit(parent) + 1)) : 0;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const node of graph.nodes) visit(node.id);
  const groups = new Map<number, FileNode[]>();
  for (const node of graph.nodes) {
    const layer = depth.get(node.id) ?? 0;
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer)!.push(node);
  }
  let maxRight = 0;
  for (const [layer, nodes] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    nodes.sort((a, b) => a.relPath.localeCompare(b.relPath));
    const total = nodes.length * FILE_HEIGHT + Math.max(0, nodes.length - 1) * 42;
    let y = -total / 2;
    for (const node of nodes) {
      node.position = { x: 80 + layer * 370, y };
      maxRight = Math.max(maxRight, node.position.x + FILE_WIDTH);
      y += FILE_HEIGHT + 42;
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  for (const node of graph.nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
  }
  if (Number.isFinite(minX)) {
    const dx = 70 - minX;
    const dy = 70 - minY + Math.max(0, 0);
    for (const node of graph.nodes) {
      node.position.x += dx;
      node.position.y += dy;
    }
  }
  void maxRight;
  return graph;
}

function edgeLabelPoint(from: FileNode, to: FileNode): { x: number; y: number } {
  const x1 = from.position.x + FILE_WIDTH;
  const y1 = from.position.y + FILE_HEIGHT / 2;
  const x2 = to.position.x;
  const y2 = to.position.y + FILE_HEIGHT / 2;
  const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
  const t = 0.5;
  return {
    x: 0.125 * x1 + 0.375 * (x1 + dx) + 0.375 * (x2 - dx) + 0.125 * x2,
    y: 0.125 * y1 + 0.375 * y1 + 0.375 * y2 + 0.125 * y2,
  };
}

export function FileLibrary({
  graph,
  selected,
  query,
  onQuery,
  onSelect,
}: {
  graph: FileGraph | null;
  selected: string | null;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (path: string) => void;
}) {
  const groups = useMemo(() => {
    if (!graph) return [];
    const q = query.trim().toLowerCase();
    const filtered = graph.nodes.filter((node) => {
      if (!q) return true;
      return (
        node.relPath.toLowerCase().includes(q) ||
        node.functions.some((fn) => fn.toLowerCase().includes(q)) ||
        node.classes.some((name) => name.toLowerCase().includes(q))
      );
    });
    const map = new Map<string, FileNode[]>();
    for (const node of filtered) {
      const key = node.dir === '.' ? '根目录' : node.dir;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(node);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [graph, query]);

  return (
    <aside className="library file-library">
      <div className="library-head">
        <div className="library-title"><span>文件关系</span><span className="count-badge">{graph?.nodes.length ?? 0}</span></div>
        <div className="library-sub">Python 文件与 import 关系</div>
      </div>
      <div className="search-box">
        <Search size={14} className="search-icon" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="搜索文件、函数或目录…"
          spellCheck={false}
          aria-label="搜索文件"
        />
      </div>
      <div className="library-list">
        {!graph && <div className="library-empty"><Search size={22} /><p>正在扫描工作区</p><span>只扫描 .py 文件，最多 300 个</span></div>}
        {graph && graph.nodes.length === 0 && (
          <div className="library-empty"><FileCode size={22} /><p>没有 Python 文件</p><span>请打开一个包含 .py 文件的工作区</span></div>
        )}
        {groups.map(([dir, nodes]) => (
          <section className="method-group" key={dir}>
            <div className="group-head file-group-head"><span className="group-dot" style={{ background: 'var(--fc-accent)' }} /><span className="group-name">{dir}</span><span className="group-count">{nodes.length}</span></div>
            <div className="group-items">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  className={`file-list-item ${selected === node.id ? 'is-selected' : ''}`}
                  onClick={() => onSelect(node.id)}
                  title={node.relPath}
                >
                  <FileCode size={14} />
                  <span className="file-list-name">{node.name}</span>
                  <span className="file-list-count">{node.functions.length}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="library-foot"><FileCode size={13} /><span>点击文件查看导入 / 被导入关系</span></div>
    </aside>
  );
}

function FileCard({
  node,
  graph,
  selected,
  dimmed,
  onClick,
}: {
  node: FileNode;
  graph: FileGraph;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const importedBy = graph.edges.filter((edge) => edge.to === node.id).length;
  const imports = graph.edges.filter((edge) => edge.from === node.id).length;
  return (
    <div
      className={`file-node ${selected ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''}`}
      style={{ left: node.position.x, top: node.position.y, width: FILE_WIDTH, height: FILE_HEIGHT }}
      onClick={onClick}
    >
      <div className="file-node-head">
        <span className="file-node-icon"><FileCode size={16} /></span>
        <div className="file-node-title">
          <div className="file-node-name">{node.name}</div>
          <div className="file-node-dir">{node.dir === '.' ? './' : `${node.dir}/`}</div>
        </div>
        <span className="file-node-badge">{node.functions.length} fn</span>
      </div>
      <div className="file-node-functions">
        {node.functions.slice(0, 4).map((fn) => <span className="file-fn" key={fn}>{fn}()</span>)}
        {node.functions.length === 0 && <span className="file-fn muted">无函数</span>}
        {node.functions.length > 4 && <span className="file-fn muted">+{node.functions.length - 4}</span>}
      </div>
      <div className="file-node-foot">
        <span>导入 {imports}</span>
        <span>被导入 {importedBy}</span>
      </div>
    </div>
  );
}

export function FileCanvas({
  graph,
  selected,
  onSelect,
  fitSignal,
}: {
  graph: FileGraph | null;
  selected: string | null;
  onSelect: (path: string | null) => void;
  fitSignal: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ x: 60, y: 60, zoom: 1 });
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const viewRef = useRef(viewport);
  viewRef.current = viewport;
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    const rect = element.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  const fit = () => {
    if (!graph || !size.width || !size.height) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + FILE_WIDTH);
      maxY = Math.max(maxY, node.position.y + FILE_HEIGHT);
    }
    if (!Number.isFinite(minX)) return;
    const zoom = clamp(Math.min((size.width - 80) / (maxX - minX), (size.height - 80) / (maxY - minY)), 0.3, 1.35);
    setViewport({
      x: (size.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (size.height - (maxY - minY) * zoom) / 2 - minY * zoom,
      zoom,
    });
  };

  useEffect(() => {
    if (!graph || !size.width) return;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph?.root, graph?.nodes.length, size.width, size.height, fitSignal]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const current = viewRef.current;
        const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0015), 0.3, 1.6);
        const gx = (event.clientX - rect.left - current.x) / current.zoom;
        const gy = (event.clientY - rect.top - current.y) / current.zoom;
        setViewport({
          x: event.clientX - rect.left - gx * nextZoom,
          y: event.clientY - rect.top - gy * nextZoom,
          zoom: nextZoom,
        });
      } else {
        setViewport((value) => ({ ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const related = useMemo(() => {
    if (!selectedEdge || !graph) return null;
    const edge = graph.edges.find((item) => item.id === selectedEdge);
    if (!edge) return null;
    return new Set([edge.from, edge.to]);
  }, [selectedEdge, graph]);

  const edgePath = (edge: FileEdge) => {
    if (!graph) return '';
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return '';
    const x1 = from.position.x + FILE_WIDTH;
    const y1 = from.position.y + FILE_HEIGHT / 2;
    const x2 = to.position.x;
    const y2 = to.position.y + FILE_HEIGHT / 2;
    const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  if (!graph) {
    return (
      <div ref={wrapRef} className="canvas file-canvas is-empty">
        <div className="file-loading"><FileCode size={28} /><p>正在扫描工作区 Python 文件…</p></div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="canvas file-canvas"
      style={{
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        backgroundSize: '24px 24px',
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.button !== 1) return;
        if ((event.target as HTMLElement).closest('.file-node')) return;
        panRef.current = { x: event.clientX, y: event.clientY, vx: viewport.x, vy: viewport.y };
        setSelectedEdge(null);
        onSelect(null);
        wrapRef.current?.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!panRef.current) return;
        setViewport((value) => ({
          ...value,
          x: panRef.current!.vx + event.clientX - panRef.current!.x,
          y: panRef.current!.vy + event.clientY - panRef.current!.y,
        }));
      }}
      onPointerUp={(event) => {
        panRef.current = null;
        try {
          wrapRef.current?.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }}
    >
      <div
        className="canvas-world"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
      >
        <svg className="edges" width="1" height="1" aria-hidden="true">
          <defs>
            <marker id="file-arrow" viewBox="0 0 10 10" refX="8.2" refY="5" markerWidth="6.4" markerHeight="6.4" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--fc-accent)" />
            </marker>
          </defs>
          {graph.edges.map((edge) => {
            const active = selectedEdge === edge.id;
            const featured = !selectedEdge || active;
            const from = graph.nodes.find((node) => node.id === edge.from);
            const to = graph.nodes.find((node) => node.id === edge.to);
            return (
              <g key={edge.id} className={`file-edge ${active ? 'is-selected' : ''} ${!featured ? 'is-dimmed' : ''}`}>
                <path
                  className="file-edge-hit"
                  d={edgePath(edge)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedEdge(edge.id);
                    onSelect(null);
                  }}
                  onPointerEnter={() => setHoverEdge(edge.id)}
                  onPointerLeave={() => setHoverEdge(null)}
                />
                <path className="file-edge-line" d={edgePath(edge)} markerEnd="url(#file-arrow)" />
                {(active || hoverEdge === edge.id) && from && to && (
                  <text className="file-edge-label" x={edgeLabelPoint(from, to).x} y={edgeLabelPoint(from, to).y - 6} textAnchor="middle">{edge.label}</text>
                )}
              </g>
            );
          })}
        </svg>
        {graph.nodes.map((node) => (
          <FileCard
            key={node.id}
            node={node}
            graph={graph}
            selected={selected === node.id}
            dimmed={Boolean(related && !related.has(node.id))}
            onClick={() => {
              setSelectedEdge(null);
              onSelect(node.id);
            }}
          />
        ))}
      </div>
      <div className="canvas-zoom">
        <button onClick={() => setViewport((value) => ({ ...value, zoom: clamp(value.zoom * 1.15, 0.3, 1.6) }))} title="放大">+</button>
        <span>{Math.round(viewport.zoom * 100)}%</span>
        <button onClick={() => setViewport((value) => ({ ...value, zoom: clamp(value.zoom * 0.87, 0.3, 1.6) }))} title="缩小">−</button>
        <button onClick={fit} title="适应窗口"><Fit size={13} /></button>
      </div>
      <div className="canvas-signature">
        <span className="sig-pill"><span className="sig-name">文件关系</span><span className="sig-params">{graph.nodes.length} 个文件</span></span>
        <span className="sig-mode">import 图</span>
      </div>
      {graph.nodes.length === 0 && <div className="file-loading"><FileCode size={28} /><p>没有可显示的 Python 文件</p></div>}
      {graph.warnings.length > 0 && (
        <div className="file-warning"><Warning size={13} />{graph.warnings[0]}</div>
      )}
    </div>
  );
}

export function FileInspector({
  graph,
  selected,
  collapsed,
  onSelect,
  onClose,
}: {
  graph: FileGraph | null;
  selected: string | null;
  collapsed: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  if (collapsed) {
    return (
      <aside className="inspector is-collapsed">
        <button className="rail-toggle" onClick={onClose} title="展开文件详情"><FileCode size={15} /><span>文件</span></button>
      </aside>
    );
  }
  const node = graph?.nodes.find((item) => item.id === selected) ?? null;
  if (!graph) {
    return <aside className="inspector"><div className="panel-scroll"><div className="empty-inline">正在扫描工作区…</div></div></aside>;
  }
  if (!node) {
    return (
      <aside className="inspector">
        <div className="inspector-head"><div className="inspector-tabs"><button className="active">文件详情</button></div></div>
        <div className="panel-scroll">
          <div className="overview-hero"><div className="overview-kicker">工作区</div><div className="overview-name">文件关系</div><div className="overview-doc">{graph.nodes.length} 个 Python 文件，{graph.edges.length} 条 import 关系。点击左侧文件查看详情。</div></div>
          <div className="stats-row">
            <div className="stat"><b>{graph.nodes.length}</b><span>文件</span></div>
            <div className="stat"><b>{graph.edges.length}</b><span>import</span></div>
            <div className="stat"><b>{graph.externals.length}</b><span>外部</span></div>
          </div>
          {graph.warnings.length > 0 && <div className="warning-list" style={{ marginTop: 12 }}>{graph.warnings.map((warning) => <div className="warning-row" key={warning}><Warning size={12} /><span className="warning-text">{warning}</span></div>)}</div>}
        </div>
      </aside>
    );
  }
  const imports = graph.edges.filter((edge) => edge.from === node.id);
  const importedBy = graph.edges.filter((edge) => edge.to === node.id);
  return (
    <aside className="inspector">
      <div className="inspector-head"><div className="inspector-tabs"><button className="active">文件详情</button></div><button className="icon-btn" onClick={onClose} title="收起">›</button></div>
      <div className="panel-scroll">
        <div className="selected-head">
          <span className="selected-glyph"><FileCode size={17} /></span>
          <div className="selected-title"><div className="selected-name">{node.name}</div><div className="selected-meta"><span className="chip">{node.dir === '.' ? '根目录' : node.dir}</span></div></div>
        </div>
        <div className="file-path">{node.relPath}</div>
        <div className="stats-row" style={{ marginTop: 8 }}>
          <div className="stat"><b>{node.functions.length}</b><span>函数</span></div>
          <div className="stat"><b>{node.classes.length}</b><span>类</span></div>
          <div className="stat"><b>{imports.length}</b><span>导入</span></div>
          <div className="stat"><b>{importedBy.length}</b><span>被导入</span></div>
        </div>
        <div className="section-title"><span>函数 / 类</span></div>
        <div className="file-symbols">
          {node.functions.map((fn) => <span className="file-fn" key={fn}>{fn}()</span>)}
          {node.classes.map((cls) => <span className="file-fn class" key={cls}>{cls}</span>)}
          {node.functions.length + node.classes.length === 0 && <span className="empty-inline">没有顶层函数或类</span>}
        </div>
        <div className="section-title"><span>导入了</span><span className="section-count">{imports.length}</span></div>
        <div className="file-relations">
          {imports.map((edge) => {
            const target = graph.nodes.find((item) => item.id === edge.to);
            return <button key={edge.id} className="file-relation" onClick={() => onSelect(edge.to)}><span className="relation-arrow">→</span><span className="relation-name">{target?.relPath ?? edge.to}</span><span className="relation-label">{edge.label}</span></button>;
          })}
          {imports.length === 0 && <div className="empty-inline">没有导入项目内文件</div>}
        </div>
        <div className="section-title"><span>被导入</span><span className="section-count">{importedBy.length}</span></div>
        <div className="file-relations">
          {importedBy.map((edge) => {
            const source = graph.nodes.find((item) => item.id === edge.from);
            return <button key={edge.id} className="file-relation" onClick={() => onSelect(edge.from)}><span className="relation-arrow">←</span><span className="relation-name">{source?.relPath ?? edge.from}</span><span className="relation-label">{edge.label}</span></button>;
          })}
          {importedBy.length === 0 && <div className="empty-inline">没有被项目内文件导入</div>}
        </div>
        {graph.externals.filter((item) => item.from === node.id).length > 0 && (
          <>
            <div className="section-title"><span>外部依赖</span></div>
            <div className="file-symbols">{graph.externals.filter((item) => item.from === node.id).map((item) => <span className="file-fn muted" key={item.name}>{item.name}</span>)}</div>
          </>
        )}
        <div className="hint-card"><div className="hint-card-title">关系视图</div><p>箭头从“导入方”指向“被导入文件”。点击连线会淡化其他连线；点击右侧文件可跳转。</p></div>
      </div>
    </aside>
  );
}
