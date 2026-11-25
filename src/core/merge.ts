import { nodeHeight, NODE_WIDTH } from './graph';
import type { FlowEdge, FlowGraph, MethodNode, Port, PortType, Segment } from './types';

const ROW_GAP = 44;
const LAYER_GAP = 96;
const MAX_ROW_WIDTH = 1320;

/**
 * Fold a flow graph down to its semantic segments.
 *
 * The result is a *view* graph: every segment becomes one block node, and the
 * edges between segments become plain method-to-method edges. It renders with
 * the normal canvas, so layout, zoom and fit all keep working — and code
 * generation never sees it, because the original graph is left untouched.
 */
export function collapseGraph(graph: FlowGraph): FlowGraph {
  const segments = graph.segments ?? [];
  if (!segments.length) return graph;

  const owner = new Map<string, string>();
  for (const segment of segments) {
    for (const member of segment.members) owner.set(member, segment.id);
  }

  const nodes: MethodNode[] = segments.map((segment, index) => {
    const id = blockId(segment.id);
    return {
      id,
      key: id,
      methodId: `segment:${segment.kind}`,
      name: segment.label,
      qualifiedName: segment.kind,
      kind: 'method',
      effect: segment.names.join(' → '),
      category: blockKindLabel(segment.kind),
      origin: 'builtin',
      inputs: segment.inputs.map((port, i) => toPort(`${id}:in:${i}`, port.name, port.type)),
      outputs: segment.outputs.map((port, i) => toPort(`${id}:out:${i}`, port.name, port.type)),
      position: { x: 0, y: 0 },
      order: index,
      sourceRange: {
        start: { line: segment.startLine, character: 0 },
        end: { line: segment.endLine, character: 0 },
      },
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const fromSegment = owner.get(edge.from.node);
    const toSegment = owner.get(edge.to.node);
    if (!fromSegment || !toSegment || fromSegment === toSegment) continue;
    const key = `${fromSegment}->${toSegment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const from = byId.get(blockId(fromSegment));
    const to = byId.get(blockId(toSegment));
    if (!from || !to || !from.outputs.length || !to.inputs.length) continue;
    edges.push({
      id: `e:${key}`,
      from: { node: from.id, port: from.outputs[0].id },
      to: { node: to.id, port: to.inputs[0].id },
    });
  }

  const result: FlowGraph = {
    ...graph,
    id: `${graph.id}:blocks`,
    name: `${graph.name} · 合并`,
    nodes,
    values: [],
    edges,
    regions: undefined,
  };
  layoutBlocks(result, segments);
  return result;
}

/**
 * Depth-based layered layout for blocks: independent blocks share a layer
 * (side by side), rows wrap when they get too wide.
 */
function layoutBlocks(graph: FlowGraph, segments: Segment[]): void {
  const depth = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      const next = Math.min(graph.nodes.length, (depth.get(edge.from.node) ?? 0) + 1);
      if (next > (depth.get(edge.to.node) ?? 0)) {
        depth.set(edge.to.node, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const layers = new Map<number, MethodNode[]>();
  for (const node of graph.nodes) {
    const level = depth.get(node.id) ?? 0;
    if (!layers.has(level)) layers.set(level, []);
    layers.get(level)!.push(node);
  }

  const levels = [...layers.keys()].sort((a, b) => a - b);
  let y = 0;
  for (const level of levels) {
    const row = layers.get(level)!.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const perRow = Math.max(1, Math.floor((MAX_ROW_WIDTH + ROW_GAP) / (NODE_WIDTH + ROW_GAP)));
    for (let i = 0; i < row.length; i += perRow) {
      const chunk = row.slice(i, i + perRow);
      const height = Math.max(...chunk.map((node) => nodeHeight(node)));
      const width = chunk.length * NODE_WIDTH + (chunk.length - 1) * ROW_GAP;
      let x = -width / 2;
      for (const node of chunk) {
        node.position = { x, y: y + (height - nodeHeight(node)) / 2 };
        x += NODE_WIDTH + ROW_GAP;
      }
      y += height + (i + perRow >= row.length ? LAYER_GAP : ROW_GAP);
    }
  }
  void segments;
}

function blockId(segmentId: string): string {
  return `blk:${segmentId}`;
}

function blockKindLabel(kind: string): string {
  switch (kind) {
    case 'init': case 'read': return '读取并初始化';
    case 'lib': return '库引用';
    case 'io': case 'write': return '写出数据';
    case 'morph': return '格式转换';
    case 'index': return '索引整理';
    case 'shape': return '形状重构';
    default: return '数据处理';
  }
}

function toPort(id: string, name: string, type: string): Port {
  return { id, name, type: (type || 'any') as PortType };
}

/** True when the graph carries merge blocks at all. */
export function canCollapse(graph: FlowGraph | null | undefined): boolean {
  return Boolean(graph?.segments?.length);
}

/** Member method nodes of a block, in source order. */
export function segmentMembers(graph: FlowGraph, segment: Segment): MethodNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return segment.members.map((id) => byId.get(id)).filter((node): node is MethodNode => Boolean(node));
}
