import type { CSSProperties } from 'react';
import type { FlowGraph, MethodNode, Port, ValueNode } from '../../../src/core/types';
import { nodeHeight, NODE_ROW, NODE_WIDTH } from '../../../src/core/graph';
import { typeLabel, portColor } from '../../../src/core/types';
import { ExternalLink, Trash } from '../icons';
import { kindLabel, methodGlyph } from '../utils';
import { categoryColor } from '../../../src/core/registry';
import type { MethodSpec } from '../../../src/core/types';

function PortButton({
  port,
  side,
  connected,
  nodeId,
  focused,
  targeted,
  vertical,
  left,
}: {
  port: Port;
  side: 'in' | 'out';
  connected: boolean;
  nodeId: string;
  focused?: boolean;
  /** Ports that a link/value drag is about to drop on. */
  targeted?: boolean;
  vertical?: boolean;
  left?: string;
}) {
  return (
    <button
      className={`port port-${side} ${vertical ? 'port-vertical' : ''} ${connected ? 'is-connected' : 'is-open'} ${focused ? 'is-focus' : ''} ${targeted ? 'is-target' : ''}`}
      style={vertical ? ({ ['--port-x' as string]: left ?? '50%' } as CSSProperties) : undefined}
      data-port-node={nodeId}
      data-port-id={port.id}
      data-port-kind={side}
      data-port-type={port.type}
      title={`${port.name} : ${typeLabel(port.type, port.annotation)}${port.defaultValue !== undefined ? `（默认 ${port.defaultValue}）` : ''}${connected ? '' : '（未连接）'} · 点击查看后续用途`}
      aria-label={`${side === 'in' ? '输入' : '输出'}端口 ${port.name}`}
    >
      <span className="port-dot" style={{ ['--port-color' as string]: portColor(port.type) }} />
    </button>
  );
}

export function MethodNodeView({
  node,
  graph,
  selected,
  dimmed,
  focusPort,
  linkTarget,
  onSelect,
  onReveal,
  onDelete,
  onEditParam,
  orientation = 'horizontal',
}: {
  node: MethodNode;
  graph: FlowGraph;
  selected: boolean;
  dimmed?: boolean;
  focusPort?: { node: string; port: string } | null;
  linkTarget?: { node: string; port: string } | null;
  onSelect: () => void;
  onReveal: (line: number, character: number) => void;
  onDelete: () => void;
  onEditParam?: (nodeId: string, side: 'in' | 'out', index: number, anchor: { x: number; y: number }) => void;
  orientation?: 'horizontal' | 'vertical';
}) {
  const vertical = orientation === 'vertical';
  const rows = Math.max(node.inputs.length, node.outputs.length, 1);
  const height = nodeHeight(node);
  const connectedIn = new Set(graph.edges.filter((e) => e.to.node === node.id).map((e) => e.to.port));
  const connectedOut = new Set(graph.edges.filter((e) => e.from.node === node.id).map((e) => e.from.port));
  const methodLike: MethodSpec = {
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
    qualifiedName: node.qualifiedName,
  };
  const color = categoryColor(node.category);

  return (
    <div
      className={`node ${selected ? 'is-selected' : ''} ${node.origin === 'user' ? 'is-user' : ''} ${dimmed ? 'is-dimmed' : ''} ${vertical ? 'is-vertical' : ''} ${linkTarget?.node === node.id ? 'is-accept' : ''}`}
      data-node-id={node.id}
      data-node-kind="method"
      style={{ left: node.position.x, top: node.position.y, width: NODE_WIDTH, height, ['--node-color' as string]: color }}
      onPointerDown={(event) => {
        // Ports handle their own press (link drag or focus).
        if ((event.target as HTMLElement).closest('[data-port-node]')) return;
        onSelect();
      }}
    >
      <div className="node-head">
        <span className="node-glyph" style={{ color }}>
          {node.methodId.startsWith('segment:') ? '▦' : methodGlyph(methodLike)}
        </span>
        <div className="node-heading">
          <div className="node-title-row">
            <span className="node-name">{node.name}</span>
            <span className={`node-origin ${node.origin}`}>
              {node.methodId.startsWith('segment:') ? node.category : kindLabel(methodLike)}
            </span>
            {graph.cells && graph.cellIndex === -1 && node.cellIndex !== undefined && node.cellIndex >= 0 && (
              <span className="node-cell">C{node.cellIndex + 1}</span>
            )}
          </div>
          <div className="node-effect" title={node.effect}>
            {node.effect || '—'}
          </div>
        </div>
        <div className="node-actions">
          {node.sourceRange && (
            <button
              className="node-action"
              title="在源码中定位"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onReveal(node.sourceRange!.start.line, node.sourceRange!.start.character);
              }}
            >
              <ExternalLink size={12} />
            </button>
          )}
          <button
            className="node-action danger"
            title="删除这个模块"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash size={12} />
          </button>
        </div>
      </div>

      {vertical && (
        <div className="vertical-ports vertical-ports-in">
          {node.inputs.map((input, index) => (
            <PortButton
              key={input.id}
              port={input}
              side="in"
              vertical
              left={`${((index + 1) / (node.inputs.length + 1)) * 100}%`}
              connected={connectedIn.has(input.id)}
              nodeId={node.id}
              focused={focusPort?.node === node.id && focusPort?.port === input.id}
              targeted={linkTarget?.node === node.id && linkTarget?.port === input.id}
            />
          ))}
        </div>
      )}

      <div className="node-body">
        {Array.from({ length: rows }).map((_, index) => {
          const input = node.inputs[index];
          const output = node.outputs[index];
          const targetRow =
            linkTarget?.node === node.id &&
            ((input && input.id === linkTarget.port) || (output && output.id === linkTarget.port));
          return (
            <div className={`node-row ${targetRow ? 'is-target-row' : ''}`} key={index} style={{ height: NODE_ROW }}>
              <div
                className={`row-side row-in ${input && onEditParam ? 'is-editable' : ''}`}
                title={input && onEditParam ? '点击编辑这个输入参数' : undefined}
                onPointerDown={(event) => {
                  if (!input || !onEditParam) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onEditParam(node.id, 'in', index, { x: event.clientX, y: event.clientY });
                }}
              >
                {input && (
                  <>
                    <span className="row-name">{input.name}</span>
                    <span className="row-type" style={{ color: portColor(input.type) }}>
                      {typeLabel(input.type, input.annotation)}
                    </span>
                    {!connectedIn.has(input.id) && input.defaultValue !== undefined && input.defaultValue !== input.name && (
                      <span className="row-default" title={`默认值：${input.defaultValue}`}>
                        = {input.defaultValue}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div
                className={`row-side row-out ${output && onEditParam ? 'is-editable' : ''}`}
                title={output && onEditParam ? '点击编辑这个输出参数' : undefined}
                onPointerDown={(event) => {
                  if (!output || !onEditParam) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onEditParam(node.id, 'out', index, { x: event.clientX, y: event.clientY });
                }}
              >
                {output && (
                  <>
                    <span className="row-type" style={{ color: portColor(output.type) }}>
                      {typeLabel(output.type, output.annotation)}
                    </span>
                    <span className="row-name">{output.name}</span>
                  </>
                )}
              </div>
              {!vertical && input && (
                <PortButton
                  port={input}
                  side="in"
                  connected={connectedIn.has(input.id)}
                  nodeId={node.id}
                  focused={focusPort?.node === node.id && focusPort?.port === input.id}
                  targeted={linkTarget?.node === node.id && linkTarget?.port === input.id}
                />
              )}
              {!vertical && output && (
                <PortButton
                  port={output}
                  side="out"
                  connected={connectedOut.has(output.id)}
                  nodeId={node.id}
                  focused={focusPort?.node === node.id && focusPort?.port === output.id}
                  targeted={linkTarget?.node === node.id && linkTarget?.port === output.id}
                />
              )}
            </div>
          );
        })}
      </div>

      {vertical && (
        <div className="vertical-ports vertical-ports-out">
          {node.outputs.map((output, index) => (
            <PortButton
              key={output.id}
              port={output}
              side="out"
              vertical
              left={`${((index + 1) / (node.outputs.length + 1)) * 100}%`}
              connected={connectedOut.has(output.id)}
              nodeId={node.id}
              focused={focusPort?.node === node.id && focusPort?.port === output.id}
              targeted={linkTarget?.node === node.id && linkTarget?.port === output.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ValueNodeView({
  node,
  graph,
  selected,
  dimmed,
  focusPort,
  linkTarget,
  onSelect,
  onDelete,
  orientation = 'horizontal',
}: {
  node: ValueNode;
  graph: FlowGraph;
  selected: boolean;
  dimmed?: boolean;
  focusPort?: { node: string; port: string } | null;
  linkTarget?: { node: string; port: string } | null;
  onSelect: () => void;
  onDelete: () => void;
  orientation?: 'horizontal' | 'vertical';
}) {
  const vertical = orientation === 'vertical';
  const incoming = graph.edges.filter((e) => e.to.node === node.id);
  const outgoing = graph.edges.filter((e) => e.from.node === node.id);
  const connected = node.kind === 'output' ? incoming.length > 0 : outgoing.length > 0;
  const label =
    node.kind === 'literal' && node.value !== undefined && node.name !== node.value
      ? `${node.name} = ${node.value}`
      : node.name;
  return (
    <div
      className={`value-node value-${node.kind} ${selected ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''} ${vertical ? 'is-vertical' : ''} ${linkTarget?.node === node.id ? 'is-accept' : ''}`}
      data-node-id={node.id}
      data-node-kind="value"
      style={{ left: node.position.x, top: node.position.y }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-port-node]')) return;
        onSelect();
      }}
      title={label}
    >
      <div className="value-top">
        <span className={`value-kind ${node.kind}`}>
          {node.kind === 'input' ? 'IN' : node.kind === 'output' ? 'OUT' : node.kind === 'literal' ? 'VAL' : 'EXT'}
        </span>
        <span className="value-name">{label}</span>
        <button
          className="value-delete"
          title="删除参数"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash size={11} />
        </button>
      </div>
      <div className="value-type" style={{ color: portColor(node.type) }}>
        {typeLabel(node.type, node.annotation)}
        {!connected && <span className="value-open">未连接</span>}
      </div>
      {node.kind !== 'output' && (
        <button
          className={`port port-out ${vertical ? 'port-vertical' : ''} ${connected ? 'is-connected' : 'is-open'} ${focusPort?.node === node.id && focusPort?.port === `${node.id}:out` ? 'is-focus' : ''} ${linkTarget?.node === node.id && linkTarget?.port === `${node.id}:out` ? 'is-target' : ''}`}
          data-port-node={node.id}
          data-port-id={`${node.id}:out`}
          data-port-kind="out"
          data-port-type={node.type}
          title={`${node.name} : ${typeLabel(node.type, node.annotation)} · 点击查看后续用途`}
          aria-label={`参数 ${node.name} 输出`}
        >
          <span className="port-dot" style={{ ['--port-color' as string]: portColor(node.type) }} />
        </button>
      )}
      {node.kind === 'output' && (
        <button
          className={`port port-in ${vertical ? 'port-vertical' : ''} ${connected ? 'is-connected' : 'is-open'} ${focusPort?.node === node.id && focusPort?.port === `${node.id}:in` ? 'is-focus' : ''} ${linkTarget?.node === node.id && linkTarget?.port === `${node.id}:in` ? 'is-target' : ''}`}
          data-port-node={node.id}
          data-port-id={`${node.id}:in`}
          data-port-kind="in"
          data-port-type={node.type}
          title={`${node.name} : ${typeLabel(node.type, node.annotation)} · 点击查看后续用途`}
          aria-label={`流程输出 ${node.name}`}
        >
          <span className="port-dot" style={{ ['--port-color' as string]: portColor(node.type) }} />
        </button>
      )}
    </div>
  );
}
