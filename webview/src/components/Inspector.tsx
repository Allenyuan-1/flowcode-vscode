import type { ReactNode } from 'react';
import type { FlowGraph, FlowWarning, MethodNode, Port, PortType, ValueNode } from '../../../src/core/types';
import { findNode, isValueNode } from '../../../src/core/graph';
import { portColor, typeLabel } from '../../../src/core/types';
import type { GenerateResult } from '../../../src/core/generate';
import { categoryColor } from '../../../src/core/registry';
import type { MethodSpec } from '../../../src/core/types';
import { kindLabel, methodGlyph } from '../utils';
import { CodeBlock } from './CodeBlock';
import { computeFocus } from '../focus';
import {
  ArrowDownToLine, ChevronLeft, ChevronRight, Copy, ExternalLink, Plus, Trash, Warning,
} from '../icons';
import type { RightTab, Selection } from '../store';

const TYPES: PortType[] = ['number', 'int', 'string', 'boolean', 'list', 'dict', 'any'];

interface Props {
  graph: FlowGraph;
  selected: Selection;
  collapsed: boolean;
  tab: RightTab;
  generated: GenerateResult | null;
  dirty: boolean;
  demo: boolean;
  onToggle: () => void;
  onTab: (tab: RightTab) => void;
  onSelect: (selection: Selection) => void;
  onMutate: (mutate: (graph: FlowGraph) => void, options?: { history?: boolean; historyKey?: string }) => void;
  onDeleteSelection: () => void;
  onDuplicate: (id: string) => void;
  onReveal: (line: number, character?: number) => void;
  onAddInput: () => void;
  onAddOutput: () => void;
  onApply: () => void;
  onCopy: (text: string) => void;
  onToast: (message: string, kind?: 'info' | 'warn' | 'error') => void;
}

function TypeSelect({
  value,
  annotation,
  onChange,
}: {
  value: PortType;
  annotation?: string;
  onChange: (type: PortType) => void;
}) {
  return (
    <span className="type-select-wrap" title={annotation ? `源码注解：${annotation}` : undefined}>
      <select
        className="type-select"
        value={value}
        onChange={(event) => onChange(event.target.value as PortType)}
        style={{ color: portColor(value) }}
      >
        {TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      {annotation && <span className="annotation-mark">: {annotation}</span>}
    </span>
  );
}

function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {extra}
    </div>
  );
}

function WarningList({ warnings, onReveal }: { warnings: FlowWarning[]; onReveal: (line: number) => void }) {
  if (!warnings.length) return null;
  return (
    <div className="warning-list">
      {warnings.slice(0, 8).map((warning, index) => (
        <button
          className={`warning-row ${warning.code === 'control-flow' ? 'is-control' : ''}`}
          key={`${warning.code}-${index}`}
          onClick={() => warning.line && onReveal(warning.line)}
          title={warning.message}
        >
          <Warning size={12} />
          <span className="warning-text">{warning.message}</span>
          {warning.line && <span className="warning-line">L{warning.line}</span>}
        </button>
      ))}
      {warnings.length > 8 && <div className="warning-more">还有 {warnings.length - 8} 条提示</div>}
    </div>
  );
}

function NodePanel({
  node,
  graph,
  onMutate,
  onDelete,
  onDuplicate,
  onReveal,
  onToast,
}: {
  node: MethodNode;
  graph: FlowGraph;
  onMutate: Props['onMutate'];
  onDelete: () => void;
  onDuplicate: () => void;
  onReveal: (line: number, character?: number) => void;
  onToast: Props['onToast'];
}) {
  const fakeSpec: MethodSpec = {
    id: node.methodId,
    name: node.name,
    kind: node.kind,
    op: node.op,
    category: node.category,
    signature: '',
    effect: node.effect,
    params: [],
    returns: [],
    origin: node.origin,
  };
  const color = categoryColor(node.category);

  const updateEffect = (effect: string) => {
    onMutate(
      (graph) => {
        const target = graph.nodes.find((n) => n.id === node.id);
        if (target) target.effect = effect;
      },
      { historyKey: `effect-${node.id}` },
    );
  };

  const updatePort = (portId: string, patch: Partial<Port>, key: string) => {
    onMutate(
      (graph) => {
        const target = graph.nodes.find((n) => n.id === node.id);
        const port = target?.inputs.find((p) => p.id === portId) ?? target?.outputs.find((p) => p.id === portId);
        if (port) Object.assign(port, patch);
      },
      { historyKey: key },
    );
  };

  return (
    <div className="panel-scroll">
      <div className="selected-head">
        <span className="selected-glyph" style={{ color, borderColor: color }}>{methodGlyph(fakeSpec)}</span>
        <div className="selected-title">
          <div className="selected-name">{node.name}</div>
          <div className="selected-meta">
            <span className="chip">{node.category}</span>
            <span className={`chip ${node.origin}`}>{kindLabel(fakeSpec)}</span>
          </div>
        </div>
      </div>

      <div className="field-block">
        <div className="field-label">方法效果</div>
        <textarea
          className="text-area effect-input"
          value={node.effect}
          rows={2}
          onChange={(event) => updateEffect(event.target.value)}
          placeholder="用一句话说明这个方法做什么"
        />
      </div>

      <SectionTitle extra={<span className="section-count">{node.inputs.length}</span>}>输入参数</SectionTitle>
      <div className="param-list">
        {node.inputs.map((port) => {
          const edge = graph.edges.find((e) => e.to.node === node.id && e.to.port === port.id);
          const source = edge ? findNode(graph, edge.from.node) : undefined;
          let sourceLabel = '';
          if (source) {
            if (isValueNode(source)) sourceLabel = source.name;
            else {
              const output = source.outputs.find((p) => p.id === edge!.from.port);
              sourceLabel = `${source.name}.${output?.name ?? '?'}`;
            }
          }
          return (
            <div className="param-row" key={port.id}>
              <span className="param-dot" style={{ background: portColor(port.type) }} />
              <div className="param-main">
                <div className="param-line">
                  <input
                    className="param-name"
                    value={port.name}
                    spellCheck={false}
                    onChange={(event) => updatePort(port.id, { name: event.target.value }, `in-name-${port.id}`)}
                  />
                  <TypeSelect
                    value={port.type}
                    annotation={port.annotation}
                    onChange={(type) => updatePort(port.id, { type, annotation: undefined }, `in-type-${port.id}`)}
                  />
                </div>
                <div className={`param-conn ${edge ? 'ok' : 'missing'}`}>
                  {edge ? `← ${sourceLabel}` : port.defaultValue !== undefined ? '未连接，使用默认值' : '未连接（生成时使用 None）'}
                </div>
                <div className="param-default-row">
                  <span className="param-default-label">默认</span>
                  <input
                    className="param-default-input"
                    value={port.defaultValue ?? ''}
                    placeholder="无"
                    spellCheck={false}
                    title="未连接时写入代码的默认表达式"
                    onChange={(event) => {
                      const value = event.target.value;
                      updatePort(
                        port.id,
                        { defaultValue: value === '' ? undefined : value, optional: value !== '' },
                        `in-default-${port.id}`,
                      );
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <SectionTitle extra={<span className="section-count">{node.outputs.length}</span>}>输出参数</SectionTitle>
      <div className="param-list">
        {node.outputs.length === 0 && <div className="empty-inline">这个方法没有返回值</div>}
        {node.outputs.map((port) => {
          const uses = graph.edges.filter((e) => e.from.node === node.id && e.from.port === port.id).length;
          return (
            <div className="param-row" key={port.id}>
              <span className="param-dot hollow" style={{ borderColor: portColor(port.type) }} />
              <div className="param-main">
                <div className="param-line">
                  <input
                    className="param-name"
                    value={port.name}
                    spellCheck={false}
                    onChange={(event) => updatePort(port.id, { name: event.target.value }, `out-name-${port.id}`)}
                  />
                  <TypeSelect
                    value={port.type}
                    annotation={port.annotation}
                    onChange={(type) => updatePort(port.id, { type, annotation: undefined }, `out-type-${port.id}`)}
                  />
                </div>
                <div className="param-conn">{uses ? `→ 被 ${uses} 处使用` : '→ 未被使用'}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel-actions">
        <button className="btn small" onClick={onDuplicate}>
          <Copy size={13} /> 复制模块
        </button>
        {node.sourceRange && (
          <button className="btn small" onClick={() => onReveal(node.sourceRange!.start.line, node.sourceRange!.start.character)}>
            <ExternalLink size={13} /> 定位源码
          </button>
        )}
        <button className="btn small danger" onClick={onDelete}>
          <Trash size={13} /> 删除模块
        </button>
      </div>

      <div className="hint-card">
        <div className="hint-card-title">怎么接线？</div>
        <p>从模块右侧的圆点拖出，落到下一个模块左侧的圆点。参数会按名称自动匹配；也可以直接拖到空白处创建流程输出。</p>
      </div>
      <button className="link-btn" onClick={() => onToast('提示：右键或 Delete 可删除选中的模块和连线', 'info')}>
        查看快捷操作
      </button>
    </div>
  );
}

function ValuePanel({
  node,
  graph,
  onMutate,
  onDelete,
}: {
  node: ValueNode;
  graph: FlowGraph;
  onMutate: Props['onMutate'];
  onDelete: () => void;
}) {
  const kindText = { input: '流程输入', literal: '常量 / 表达式', global: '外部变量', output: '流程输出' }[node.kind];
  const update = (patch: Partial<ValueNode>, key: string) => {
    onMutate(
      (draft) => {
        const target = draft.values.find((v) => v.id === node.id);
        if (target) Object.assign(target, patch);
      },
      { historyKey: key },
    );
  };
  const incoming = graph.edges.find((e) => e.to.node === node.id);
  const source = incoming ? findNode(graph, incoming.from.node) : undefined;
  const param = graph.params.find((p) => p.name === node.name);

  return (
    <div className="panel-scroll">
      <div className="selected-head">
        <span className={`selected-glyph value-glyph ${node.kind}`}>{node.kind === 'output' ? 'OUT' : node.kind === 'input' ? 'IN' : 'VAL'}</span>
        <div className="selected-title">
          <div className="selected-name">{node.name}</div>
          <div className="selected-meta"><span className="chip">{kindText}</span></div>
        </div>
      </div>

      <div className="field-block">
        <div className="field-label">名称</div>
        <input
          className="text-input"
          value={node.name}
          spellCheck={false}
          onChange={(event) => update({ name: event.target.value }, `value-name-${node.id}`)}
        />
        {node.kind === 'input' && <div className="field-note">名称会出现在函数签名里</div>}
      </div>

      <div className="field-block">
        <div className="field-label">类型</div>
        <TypeSelect
          value={node.type}
          annotation={node.annotation}
          onChange={(type) => update({ type, annotation: undefined }, `value-type-${node.id}`)}
        />
      </div>

      {node.kind === 'input' && (
        <div className="field-block">
          <div className="field-label">默认值</div>
          <input
            className="text-input mono"
            value={param?.defaultValue ?? ''}
            placeholder="无（必填参数）"
            spellCheck={false}
            onChange={(event) => {
              const value = event.target.value;
              onMutate(
                (draft) => {
                  const target = draft.params.find((p) => p.name === node.name);
                  if (target) target.defaultValue = value === '' ? undefined : value;
                },
                { historyKey: `flow-default-${node.id}` },
              );
            }}
          />
          <div className="field-note">未连接时使用；生成签名会写成 <code>{node.name}={param?.defaultValue ?? '值'}</code>。</div>
        </div>
      )}

      {(node.kind === 'literal' || node.kind === 'global') && (
        <div className="field-block">
          <div className="field-label">Python 表达式</div>
          <textarea
            className="text-area mono"
            rows={3}
            value={node.value ?? ''}
            spellCheck={false}
            onChange={(event) => update({ value: event.target.value }, `value-expr-${node.id}`)}
          />
          <div className="field-note">会原样写入生成的代码，例如 <code>2.0</code>、<code>"hello"</code>、<code>[1, 2]</code>。</div>
        </div>
      )}

      {node.kind === 'output' && (
        <div className="info-card">
          <div className="info-title">流程输出</div>
          <p>{source ? `当前来自 ${source.name}。` : '还没有连接到任何方法。'}生成代码时会作为 <code>return</code> 的值。</p>
        </div>
      )}

      {node.kind === 'input' && (
        <div className="info-card">
          <div className="info-title">流程输入</div>
          <p>它会成为入口函数的参数，并由箭头送入方法模块。</p>
        </div>
      )}

      <div className="panel-actions">
        <button className="btn small danger" onClick={onDelete}>
          <Trash size={13} /> 删除参数
        </button>
      </div>
    </div>
  );
}

function EdgePanel({
  edgeId,
  graph,
  onDelete,
}: {
  edgeId: string;
  graph: FlowGraph;
  onDelete: () => void;
}) {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const from = findNode(graph, edge.from.node);
  const to = findNode(graph, edge.to.node);
  const fromPort = from && !isValueNode(from) ? from.outputs.find((p) => p.id === edge.from.port) : undefined;
  const toPort = to && !isValueNode(to) ? to.inputs.find((p) => p.id === edge.to.port) : undefined;
  return (
    <div className="panel-scroll">
      <div className="selected-head">
        <span className="selected-glyph edge-glyph">→</span>
        <div className="selected-title">
          <div className="selected-name">参数连线</div>
          <div className="selected-meta"><span className="chip">数据流</span></div>
        </div>
      </div>
      <div className="edge-detail">
        <div className="edge-node">
          <span className="edge-label">来源</span>
          <b>{from?.name}</b>
          {fromPort && <code>{fromPort.name}</code>}
        </div>
        <div className="edge-arrow">→</div>
        <div className="edge-node">
          <span className="edge-label">去向</span>
          <b>{to?.name}</b>
          {toPort && <code>{toPort.name}</code>}
        </div>
      </div>
      <div className="info-card">
        <div className="info-title">这条线代表</div>
        <p>把 <code>{fromPort?.name ?? from?.name}</code> 的输出值，作为 <code>{toPort?.name ?? to?.name}</code> 的输入参数传入。</p>
      </div>
      <div className="panel-actions">
        <button className="btn small danger" onClick={onDelete}>
          <Trash size={13} /> 删除连线
        </button>
      </div>
    </div>
  );
}

function PortPanel({
  selection,
  graph,
  onSelect,
}: {
  selection: { node: string; port: string };
  graph: FlowGraph;
  onSelect: Props['onSelect'];
}) {
  const focus = computeFocus(graph, { kind: 'port', node: selection.node, port: selection.port });
  const node = findNode(graph, selection.node);
  if (!node) return null;
  const side = focus.portSide ?? 'out';
  const port = isValueNode(node) ? undefined : (side === 'in' ? node.inputs : node.outputs).find((p) => p.id === selection.port);
  const type = isValueNode(node) ? node.type : port?.type;
  const attached = graph.edges.filter((edge) =>
    side === 'in'
      ? edge.to.node === selection.node && edge.to.port === selection.port
      : edge.from.node === selection.node && edge.from.port === selection.port,
  );
  const direct = attached
    .map((edge) => findNode(graph, side === 'in' ? edge.from.node : edge.to.node)?.name ?? '?')
    .filter((name, index, list) => list.indexOf(name) === index);

  return (
    <div className="panel-scroll">
      <div className="selected-head">
        <span className={`selected-glyph port-glyph ${side}`}>{side === 'in' ? 'IN' : 'OUT'}</span>
        <div className="selected-title">
          <div className="selected-name">{focus.title}</div>
          <div className="selected-meta">
            <span className="chip">{side === 'in' ? '输入端口' : '输出端口'}</span>
            {type && (
              <span className="chip" style={{ color: portColor(type) }}>
                {typeLabel(type, port?.annotation)}
              </span>
            )}
          </div>
        </div>
      </div>

      <SectionTitle extra={<span className="section-count">{focus.chain.length}</span>}>后续用途</SectionTitle>
      <div className="port-chain">
        {focus.chain.length === 0 && (
          <div className="empty-inline">
            {side === 'out' ? '这条输出还没有下游连线' : '这个输入还没有接线'}
          </div>
        )}
        {focus.chain.map((item, index) => (
          <button
            key={item.id}
            className="port-chain-row"
            onClick={() => onSelect(item.kind === 'value' ? { kind: 'value', id: item.id } : { kind: 'node', id: item.id })}
            title={item.meta}
          >
            <span className="port-chain-index">{index + 1}</span>
            <span className="port-chain-name">{item.name}</span>
            <span className="port-chain-meta">{item.meta}</span>
          </button>
        ))}
      </div>

      <div className="info-card">
        <div className="info-title">端口聚焦</div>
        <p>
          {attached.length
            ? `${side === 'in' ? '数据来自' : '数据流到'} ${direct.join('、')}，后续会继续向下游传递。`
            : '端口未连接，所以画布上没有相关连线。'}
          {' '}再点一次端口即可取消聚焦。
        </p>
      </div>
    </div>
  );
}

function Overview({
  graph,
  generated,
  onMutate,
  onSelect,
  onAddInput,
  onAddOutput,
  onReveal,
}: {
  graph: FlowGraph;
  generated: GenerateResult | null;
  onMutate: Props['onMutate'];
  onSelect: Props['onSelect'];
  onAddInput: () => void;
  onAddOutput: () => void;
  onReveal: (line: number, character?: number) => void;
}) {
  const warnings = graph.warnings;
  const params = new Map(graph.params.map((param) => [param.name, param]));
  return (
    <div className="panel-scroll">
      <div className="overview-hero">
        <div className="overview-kicker">当前流程</div>
        <div className="overview-name">{graph.entryKind === 'module' ? '模块级流程' : `${graph.name}()`}</div>
        <div className="overview-doc">{graph.doc || '还没有说明。可以在代码里写 docstring，或在这里补充。'}</div>
      </div>

      <div className="stats-row">
        <div className="stat"><b>{graph.nodes.length}</b><span>方法</span></div>
        <div className="stat"><b>{graph.values.filter((v) => v.kind === 'input').length}</b><span>输入</span></div>
        <div className="stat"><b>{graph.values.filter((v) => v.kind === 'output').length}</b><span>输出</span></div>
        <div className="stat"><b>{graph.edges.length}</b><span>连线</span></div>
      </div>

      <SectionTitle extra={<button className="mini-btn" onClick={onAddInput}><Plus size={12} /> 添加</button>}>流程输入</SectionTitle>
      <div className="flow-io-list">
        {graph.values.filter((v) => v.kind === 'input').length === 0 && (
          <div className="empty-inline">没有输入参数</div>
        )}
        {graph.values.filter((v) => v.kind === 'input').map((value) => (
          <button className="flow-io-row" key={value.id} onClick={() => onSelect({ kind: 'value', id: value.id })}>
            <span className="param-dot" style={{ background: portColor(value.type) }} />
            <span className="flow-io-name">{value.name}</span>
            {params.get(value.name)?.defaultValue !== undefined && (
              <span className="flow-io-default">={params.get(value.name)!.defaultValue}</span>
            )}
            <span className="flow-io-type" style={{ color: portColor(value.type) }}>{typeLabel(value.type, value.annotation)}</span>
          </button>
        ))}
      </div>

      <SectionTitle extra={<button className="mini-btn" onClick={onAddOutput}><Plus size={12} /> 添加</button>}>流程输出</SectionTitle>
      <div className="flow-io-list">
        {graph.values.filter((v) => v.kind === 'output').length === 0 && (
          <div className="empty-inline">没有输出，生成代码时不会 return</div>
        )}
        {graph.values.filter((v) => v.kind === 'output').map((value) => (
          <button className="flow-io-row" key={value.id} onClick={() => onSelect({ kind: 'value', id: value.id })}>
            <span className="param-dot hollow" style={{ borderColor: portColor(value.type) }} />
            <span className="flow-io-name">{value.name}</span>
            <span className="flow-io-type" style={{ color: portColor(value.type) }}>{typeLabel(value.type, value.annotation)}</span>
          </button>
        ))}
      </div>

      {warnings.length > 0 && (
        <>
          <SectionTitle extra={<span className="section-count warn">{warnings.length}</span>}>诊断</SectionTitle>
          <WarningList warnings={warnings} onReveal={(line) => onReveal(line)} />
        </>
      )}

      <div className="hint-card">
        <div className="hint-card-title">双向同步</div>
        <p>修改图后点“应用到代码”，FlowCode 会重新生成入口函数并替换原代码。不会动文件里的其他函数。</p>
      </div>
      {generated && !generated.ok && <div className="error-card">{generated.error}</div>}
    </div>
  );
}

function CodePanel({
  graph,
  generated,
  onCopy,
  onApply,
  onReveal,
}: {
  graph: FlowGraph;
  generated: GenerateResult | null;
  onCopy: (text: string) => void;
  onApply: () => void;
  onReveal: (line: number) => void;
}) {
  if (!generated) {
    return <div className="panel-scroll"><div className="empty-inline">还没有流程图</div></div>;
  }
  const target = graph.cells
    ? graph.cellIndex === -1
      ? '汇总视图，不能直接写回'
      : '当前 Cell 将被整体替换'
    : graph.entryKind === 'function'
      ? '入口函数将被整体替换'
      : '模块代码将被整体替换';
  return (
    <div className="panel-scroll code-panel">
      <div className="code-head">
        <div>
          <div className="code-title">生成的 Python</div>
          <div className="code-sub">{generated.ok ? target : '暂时无法生成'}</div>
        </div>
        <div className="code-actions">
          <button className="icon-btn" title="复制代码" onClick={() => onCopy(generated.code)} disabled={!generated.ok}>
            <Copy size={14} />
          </button>
          <button className="icon-btn accent" title="写入编辑器" onClick={onApply} disabled={!generated.ok}>
            <ArrowDownToLine size={14} />
          </button>
        </div>
      </div>
      {!generated.ok && <div className="error-card">{generated.error}</div>}
      {generated.ok && (
        <>
          <div className="code-frame"><CodeBlock code={generated.code} /></div>
          {generated.warnings.length > 0 && (
            <>
              <div className="code-note">生成提示</div>
              <WarningList warnings={generated.warnings} onReveal={onReveal} />
            </>
          )}
          {generated.imports.length > 0 && (
            <div className="import-note">
              需要 import：{generated.imports.map((imp) => <code key={imp}>{imp}</code>)}
            </div>
          )}
          <button className="btn primary full" onClick={onApply} disabled={!generated.ok}>
            <ArrowDownToLine size={14} /> 写入编辑器
          </button>
        </>
      )}
    </div>
  );
}

export function Inspector(props: Props) {
  const { graph, selected, generated } = props;
  if (props.collapsed) {
    return (
      <aside className="inspector is-collapsed">
        <button className="rail-toggle" onClick={props.onToggle} title="展开参数面板">
          <ChevronLeft size={15} />
          <span>参数</span>
        </button>
        <div className="rail-count">{selected ? '1' : graph.nodes.length}</div>
      </aside>
    );
  }

  const node = selected?.kind === 'node' ? graph.nodes.find((n) => n.id === selected.id) : undefined;
  const value = selected?.kind === 'value' ? graph.values.find((v) => v.id === selected.id) : undefined;
  const edge = selected?.kind === 'edge' ? selected.id : undefined;
  const port = selected?.kind === 'port' ? selected : undefined;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="inspector-tabs" role="tablist">
          <button className={props.tab === 'params' ? 'active' : ''} onClick={() => props.onTab('params')} role="tab">
            参数
          </button>
          <button className={props.tab === 'code' ? 'active' : ''} onClick={() => props.onTab('code')} role="tab">
            代码
            {props.dirty && <span className="tab-dirty" />}
          </button>
        </div>
        <button className="icon-btn" title="收起面板" onClick={props.onToggle}>
          <ChevronRight size={15} />
        </button>
      </div>

      {props.tab === 'params' && (
        <>
          {node && (
            <NodePanel
              node={node}
              graph={graph}
              onMutate={props.onMutate}
              onDelete={props.onDeleteSelection}
              onDuplicate={() => props.onDuplicate(node.id)}
              onReveal={props.onReveal}
              onToast={props.onToast}
            />
          )}
          {value && (
            <ValuePanel
              node={value}
              graph={graph}
              onMutate={props.onMutate}
              onDelete={props.onDeleteSelection}
            />
          )}
          {edge && <EdgePanel edgeId={edge} graph={graph} onDelete={props.onDeleteSelection} />}
          {port && <PortPanel selection={{ node: port.node, port: port.port }} graph={graph} onSelect={props.onSelect} />}
          {!selected && (
            <Overview
              graph={graph}
              generated={generated}
              onMutate={props.onMutate}
              onSelect={props.onSelect}
              onAddInput={props.onAddInput}
              onAddOutput={props.onAddOutput}
              onReveal={props.onReveal}
            />
          )}
        </>
      )}

      {props.tab === 'code' && (
        <CodePanel
          graph={graph}
          generated={generated}
          onCopy={props.onCopy}
          onApply={props.onApply}
          onReveal={props.onReveal}
        />
      )}
    </aside>
  );
}
