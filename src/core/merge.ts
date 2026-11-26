import { nodeHeight, NODE_WIDTH, removeNodes, uid } from './graph';
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

/**
 * Refresh segments after nodes were removed: drop dangling members, remove
 * empty blocks, and recompute block ports from the remaining cross-block
 * edges (mirrors the port aggregation in parse_flow.py).
 */
export function pruneSegments(graph: FlowGraph, removedIds: Set<string>): void {
  const segments = graph.segments ?? [];
  if (!segments.length) return;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const alive: Segment[] = [];
  for (const segment of segments) {
    const members = segment.members.filter((id) => !removedIds.has(id));
    if (!members.length) continue;
    alive.push({ ...segment, members, size: members.length });
  }
  const owner = new Map<string, number>();
  alive.forEach((segment, index) => segment.members.forEach((id) => owner.set(id, index)));
  const ins = alive.map(() => new Map<string, string>());
  const outs = alive.map(() => new Map<string, string>());
  for (const edge of graph.edges) {
    const ia = owner.get(edge.from.node);
    const ib = owner.get(edge.to.node);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    const source = byId.get(edge.from.node);
    const target = byId.get(edge.to.node);
    if (source?.outputs[0]) outs[ia].set(source.outputs[0].name, source.outputs[0].type);
    if (target?.inputs[0]) ins[ib].set(target.inputs[0].name, target.inputs[0].type);
  }
  alive.forEach((segment, index) => {
    segment.inputs = [...ins[index].entries()].map(([name, type]) => ({ name, type }));
    segment.outputs = [...outs[index].entries()].map(([name, type]) => ({ name, type }));
    segment.names = segment.members.map((id) => byId.get(id)?.name ?? '');
    const starts = segment.members
      .map((id) => byId.get(id)?.sourceRange?.start.line)
      .filter((line): line is number => line !== undefined);
    const ends = segment.members
      .map((id) => byId.get(id)?.sourceRange?.end.line)
      .filter((line): line is number => line !== undefined);
    if (starts.length) segment.startLine = Math.min(...starts);
    if (ends.length) segment.endLine = Math.max(...ends);
  });
  graph.segments = alive.length ? alive : undefined;
}

/**
 * A mini graph holding one block's members, their boundary values and the
 * edges among them — used to render the block's code for AI adjustment.
 */
export function blockSubGraph(graph: FlowGraph, segment: Segment): FlowGraph {
  const memberIds = new Set(segment.members);
  const nodes = graph.nodes.filter((node) => memberIds.has(node.id));
  const boundaryValues = graph.values.filter(
    (value) => !value.hidden && graph.edges.some((edge) =>
      (memberIds.has(edge.from.node) && edge.to.node === value.id) ||
      (memberIds.has(edge.to.node) && edge.from.node === value.id)),
  );
  const valueIds = new Set(boundaryValues.map((value) => value.id));
  const edges = graph.edges.filter((edge) =>
    (memberIds.has(edge.from.node) && memberIds.has(edge.to.node)) ||
    (memberIds.has(edge.from.node) && valueIds.has(edge.to.node)) ||
    (valueIds.has(edge.from.node) && memberIds.has(edge.to.node)));
  const params = boundaryValues
    .filter((value) => graph.edges.some((edge) => edge.from.node === value.id && memberIds.has(edge.to.node)))
    .map((value) => ({ name: value.name, type: value.type, annotation: value.annotation }));
  const returns = boundaryValues
    .filter((value) => graph.edges.some((edge) => edge.to.node === value.id && memberIds.has(edge.from.node)))
    .map((value) => ({ name: value.name, type: value.type, annotation: value.annotation }));
  return {
    version: 1,
    id: `block:${segment.id}`,
    name: 'block',
    doc: segment.label,
    language: 'python',
    entryKind: 'function',
    params,
    returns,
    returnType: returns[0]?.type,
    nodes,
    values: boundaryValues,
    edges,
    warnings: [],
    segments: undefined,
    regions: undefined,
  };
}

/**
 * Replace a block's members with nodes from another graph (e.g. the parsed
 * result of an AI adjustment). Boundary edges are rewired by port NAME:
 * free variables in the replacement bind to the values that fed the old
 * members, and replacement outputs bind to the old consumers.
 */
export function replaceBlockMembers(graph: FlowGraph, segment: Segment, replacement: FlowGraph): void {
  const memberIds = new Set(segment.members);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  // remember how the block was wired to the outside world, keyed by port name
  const inByName = new Map<string, { node: string; port: string }>();
  const outByName = new Map<string, { node: string; port: string }>();
  for (const edge of graph.edges) {
    const fromIn = memberIds.has(edge.from.node);
    const toIn = memberIds.has(edge.to.node);
    if (fromIn === toIn) continue;
    if (fromIn) {
      const source = byId.get(edge.from.node);
      const port = source?.outputs.find((item) => item.id === edge.from.port);
      if (port) outByName.set(port.name, { node: edge.to.node, port: edge.to.port });
    } else {
      const target = byId.get(edge.to.node);
      const port = target?.inputs.find((item) => item.id === edge.to.port);
      if (port) inByName.set(port.name, { node: edge.from.node, port: edge.from.port });
    }
  }

  removeNodes(graph, [...memberIds]);

  // clone the replacement with fresh ids; ports are re-keyed to their owner
  const nodeIdMap = new Map<string, string>();
  const nodePortMap = new Map<string, string>();
  for (const node of replacement.nodes) {
    const id = uid('n');
    nodeIdMap.set(node.id, id);
    node.inputs.forEach((port, index) => nodePortMap.set(port.id, `${id}:in:${index}`));
    node.outputs.forEach((port, index) => nodePortMap.set(port.id, `${id}:out:${index}`));
    graph.nodes.push({
      ...node,
      id,
      key: id,
      inputs: node.inputs.map((port, index) => ({ ...port, id: `${id}:in:${index}` })),
      outputs: node.outputs.map((port, index) => ({ ...port, id: `${id}:out:${index}` })),
    });
  }
  const valueIdMap = new Map<string, string>();
  const valuePortMap = new Map<string, string>();
  for (const value of replacement.values) {
    const id = uid('v');
    valueIdMap.set(value.id, id);
    valuePortMap.set(`${value.id}:out`, `${id}:out`);
    valuePortMap.set(`${value.id}:in`, `${id}:in`);
  }

  // classify replacement values: inputs bind to outside feeders, outputs
  // bind to outside consumers, intermediates stay inside
  const consumed = new Set(replacement.values
    .filter((value) => replacement.edges.some((edge) => edge.to.node === value.id))
    .map((value) => value.id));
  const produced = new Set(replacement.values
    .filter((value) => replacement.edges.some((edge) => edge.from.node === value.id))
    .map((value) => value.id));

  for (const value of replacement.values) {
    const isOutput = consumed.has(value.id) && !produced.has(value.id);
    const isInput = produced.has(value.id) && !consumed.has(value.id);
    if (isInput && inByName.has(value.name)) continue; // binds to the outside feeder
    if (isOutput && outByName.has(value.name)) continue; // binds to the outside consumer
    graph.values.push({ ...value, id: valueIdMap.get(value.id)!, key: valueIdMap.get(value.id)! });
  }

  for (const edge of replacement.edges) {
    const fromNode = nodeIdMap.get(edge.from.node);
    const toNode = nodeIdMap.get(edge.to.node);
    const fromValue = valueIdMap.get(edge.from.node);
    const toValue = valueIdMap.get(edge.to.node);
    let from: { node: string; port: string } | null = null;
    let to: { node: string; port: string } | null = null;
    if (fromNode) from = { node: fromNode, port: nodePortMap.get(edge.from.port) ?? edge.from.port };
    else if (fromValue) {
      const value = replacement.values.find((item) => item.id === edge.from.node)!;
      // an input value in the replacement binds to the outside feeder
      // that used to feed the old member input of the same name
      const outside = inByName.get(value.name);
      if (outside) from = outside;
      else from = { node: fromValue, port: `${fromValue}:out` };
    }
    if (toNode) to = { node: toNode, port: nodePortMap.get(edge.to.port) ?? edge.to.port };
    else if (toValue) {
      const value = replacement.values.find((item) => item.id === edge.to.node)!;
      // an output value in the replacement binds to the outside consumer
      // that used to read the old member output of the same name
      const outside = outByName.get(value.name);
      if (outside) to = outside;
      else to = { node: toValue, port: `${toValue}:in` };
    }
    if (!from || !to) continue;
    graph.edges.push({ id: uid('e'), from, to });
  }

  // the replacement nodes continue this segment's story
  const seg = (graph.segments ?? []).find((item) => item.id === segment.id);
  if (seg) seg.members = [...nodeIdMap.values()];

  pruneSegments(graph, memberIds);
}
