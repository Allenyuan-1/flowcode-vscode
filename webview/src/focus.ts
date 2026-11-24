import { findNode, isValueNode } from '../../src/core/graph';
import type { FlowGraph, MethodNode, ValueNode } from '../../src/core/types';
import type { Selection } from './store';

export interface FocusItem {
  id: string;
  name: string;
  kind: 'method' | 'value';
  meta: string;
}

export interface FocusState {
  /** Something is highlighted, so unrelated links/nodes get dimmed. */
  active: boolean;
  /** Edges highlighted because they belong to the focused thing. */
  edges: Set<string>;
  /** Edges highlighted only because they are downstream of the focus. */
  follow: Set<string>;
  /** Nodes that stay lit. */
  nodes: Set<string>;
  title: string;
  summary: string;
  /** Downstream chain, nearest first (the "后续用途" list). */
  chain: FocusItem[];
  portNode?: string;
  portId?: string;
  portSide?: 'in' | 'out';
  portName: string;
}

const EMPTY: FocusState = {
  active: false,
  edges: new Set(),
  follow: new Set(),
  nodes: new Set(),
  title: '',
  summary: '',
  chain: [],
  portName: '',
};

function nameOf(graph: FlowGraph, id: string): string {
  return findNode(graph, id)?.name ?? id;
}

function nodeMeta(node: MethodNode | ValueNode): string {
  if (isValueNode(node)) {
    const kind = { input: '流程输入', literal: '常量', global: '外部变量', output: '流程输出' }[node.kind];
    return kind ?? '参数';
  }
  return node.effect || node.category || '方法';
}

/**
 * Walk the graph forward from a set of nodes and collect every edge/nodes that
 * uses their output. `seed` edges (direct port connections) are highlighted as
 * first-class, everything discovered later is "follow" (downstream usage).
 */
function walkDownstream(
  graph: FlowGraph,
  startIds: string[],
  seed: string[],
): { edges: Set<string>; follow: Set<string>; nodes: Set<string>; chain: string[] } {
  const edges = new Set(seed);
  const follow = new Set<string>();
  const nodes = new Set<string>();
  const chain: string[] = [];
  const seen = new Set<string>();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.add(id);
    const node = findNode(graph, id);
    if (node && !isValueNode(node)) chain.push(id);
    for (const edge of graph.edges) {
      if (edge.from.node !== id) continue;
      edges.add(edge.id);
      follow.add(edge.id);
      nodes.add(edge.to.node);
      queue.push(edge.to.node);
    }
  }
  return { edges, follow, nodes, chain };
}

interface PortLookup {
  node: MethodNode | ValueNode;
  side: 'in' | 'out';
  name: string;
}

function lookupPort(graph: FlowGraph, nodeId: string, portId: string): PortLookup | null {
  const node = findNode(graph, nodeId);
  if (!node) return null;
  if (isValueNode(node)) {
    return { node, side: portId.endsWith(':in') ? 'in' : 'out', name: node.name };
  }
  const input = node.inputs.find((port) => port.id === portId);
  if (input) return { node, side: 'in', name: input.name };
  const output = node.outputs.find((port) => port.id === portId);
  if (output) return { node, side: 'out', name: output.name };
  return null;
}

function portFocus(graph: FlowGraph, selection: { node: string; port: string }): FocusState {
  const info = lookupPort(graph, selection.node, selection.port);
  if (!info) return EMPTY;
  const attached = graph.edges.filter((edge) =>
    info.side === 'in'
      ? edge.to.node === selection.node && edge.to.port === selection.port
      : edge.from.node === selection.node && edge.from.port === selection.port,
  );
  const start =
    info.side === 'in'
      ? [selection.node]
      : attached.map((edge) => edge.to.node).filter((id, index, list) => list.indexOf(id) === index);
  const { edges, follow, nodes, chain } = walkDownstream(
    graph,
    start,
    attached.map((edge) => edge.id),
  );
  nodes.add(selection.node);
  if (info.side === 'in') {
    // Keep the upstream source visible so the input's origin is readable.
    for (const edge of attached) nodes.add(edge.from.node);
  }
  const items: FocusItem[] = chain.map((id) => {
    const node = findNode(graph, id);
    return {
      id,
      name: nameOf(graph, id),
      kind: node && isValueNode(node) ? 'value' : 'method',
      meta: node ? nodeMeta(node) : '',
    };
  });

  const owner = info.node;
  const ownerLabel = isValueNode(owner)
    ? `${owner.name} · ${info.side === 'in' ? '输入' : '输出'}`
    : `${owner.name}.${info.name}`;
  const portName = isValueNode(owner) ? (info.side === 'in' ? '输入' : '输出') : info.name;
  const sourceNames = attached
    .map((edge) => nameOf(graph, edge.from.node))
    .filter((name, index, list) => list.indexOf(name) === index);

  const preview = (list: FocusItem[]) =>
    `${list.slice(0, 4).map((item) => item.name).join('、')}${list.length > 4 ? ' …' : ''}`;

  let summary: string;
  if (!attached.length) {
    summary = info.side === 'in' ? '这个输入还没接线' : '这个输出还没接线，暂无后续用途';
  } else if (info.side === 'out') {
    summary = chain.length
      ? `后续 ${chain.length} 处：${preview(items)}`
      : `直接连到 ${attached
          .map((edge) => nameOf(graph, edge.to.node))
          .filter((name, index, list) => list.indexOf(name) === index)
          .join('、')}`;
  } else {
    const after = items.slice(1);
    summary = after.length
      ? `被 ${owner.name} 使用，之后流向：${preview(after)}`
      : `被 ${owner.name} 使用，后面没有更多连线`;
    if (sourceNames.length) summary = `来自 ${sourceNames.join('、')}，${summary}`;
  }

  return {
    active: edges.size > 0,
    edges,
    follow,
    nodes,
    title: ownerLabel,
    summary,
    chain: items,
    portNode: selection.node,
    portId: selection.port,
    portSide: info.side,
    portName,
  };
}

/** Highlight rules for the current selection (null = nothing focused). */
export function computeFocus(graph: FlowGraph, selection: Selection): FocusState {
  if (!selection) return EMPTY;

  if (selection.kind === 'port') return portFocus(graph, selection);

  if (selection.kind === 'edge') {
    const edge = graph.edges.find((item) => item.id === selection.id);
    if (!edge) return EMPTY;
    const nodes = new Set([edge.from.node, edge.to.node]);
    return {
      ...EMPTY,
      active: true,
      edges: new Set([edge.id]),
      nodes,
      title: `${nameOf(graph, edge.from.node)} → ${nameOf(graph, edge.to.node)}`,
      summary: '1 条参数线',
    };
  }

  if (selection.kind === 'value') {
    const nodes = new Set<string>([selection.id]);
    const edges = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.from.node !== selection.id && edge.to.node !== selection.id) continue;
      edges.add(edge.id);
      nodes.add(edge.from.node);
      nodes.add(edge.to.node);
    }
    return {
      ...EMPTY,
      active: edges.size > 0,
      edges,
      nodes,
      title: nameOf(graph, selection.id),
      summary: `${edges.size} 条参数线`,
    };
  }

  return EMPTY;
}
