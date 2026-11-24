import type {
  Endpoint,
  FlowEdge,
  FlowGraph,
  FlowWarning,
  MethodNode,
  MethodSpec,
  ParamSpec,
  Point,
  Port,
  PortType,
  ReturnSpec,
  ValueKind,
  ValueNode,
} from './types';

export const NODE_WIDTH = 230;
export const NODE_HEADER = 66;
export const NODE_ROW = 27;
export const NODE_PAD_BOTTOM = 14;
export const VALUE_WIDTH = 112;
export const VALUE_HEIGHT = 46;
/**
 * Horizontal distance between a value pill's right edge and the method node it
 * feeds. Kept wider than the port hit target (26px) so the two clickable port
 * circles never overlap.
 */
export const VALUE_GAP = 34;

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function nodeHeight(node: MethodNode): number {
  return NODE_HEADER + Math.max(1, Math.max(node.inputs.length, node.outputs.length)) * NODE_ROW + NODE_PAD_BOTTOM;
}

export function nodeSize(node: MethodNode): { width: number; height: number } {
  return { width: NODE_WIDTH, height: nodeHeight(node) };
}

export function createMethodNode(spec: MethodSpec, position: Point, id = uid('n')): MethodNode {  const inputs: Port[] = spec.params.map((p, i) => ({
    id: `${id}:in:${i}`,
    name: p.name,
    type: p.type,
    annotation: p.annotation,
    keyword: p.keywordOnly,
    defaultValue: p.defaultValue,
    optional: p.defaultValue !== undefined,
    description: p.description,
  }));
  const outputs: Port[] = spec.returns.map((r, i) => ({
    id: `${id}:out:${i}`,
    name: r.name,
    type: r.type,
    annotation: r.annotation,
  }));
  return {
    id,
    key: id,
    methodId: spec.id,
    name: spec.name,
    qualifiedName: spec.qualifiedName,
    kind: spec.kind,
    op: spec.op,
    callee: spec.callee,
    effect: spec.effect,
    category: spec.category,
    origin: spec.origin,
    inputs,
    outputs,
    position: { ...position },
    sourceRange: spec.sourceRange,
  };
}

/** Copy a method block without its edges; every port gets a fresh id. */
export function cloneMethodNode(node: MethodNode, id = uid('n')): MethodNode {
  const clone = structuredClone(node);
  clone.id = id;
  clone.key = id;
  clone.inputs = node.inputs.map((port, index) => ({ ...port, id: `${id}:in:${index}` }));
  clone.outputs = node.outputs.map((port, index) => ({ ...port, id: `${id}:out:${index}` }));
  clone.position = { x: node.position.x + 42, y: node.position.y + nodeHeight(node) + 44 };
  return clone;
}

export function createValueNode(input: {
  kind: ValueKind;
  name: string;
  type?: PortType;
  annotation?: string;
  value?: string;
  position: Point;
  id?: string;
  auto?: boolean;
}): ValueNode {
  const id = input.id ?? uid('v');
  return {
    id,
    key: id,
    kind: input.kind,
    name: input.name,
    type: input.type ?? 'any',
    annotation: input.annotation,
    value: input.value,
    position: { ...input.position },
    auto: input.auto,
  };
}

export function valueOutPort(v: ValueNode): string {
  return `${v.id}:out`;
}

export function valueInPort(v: ValueNode): string {
  return `${v.id}:in`;
}

export function findNode(graph: FlowGraph, id: string): MethodNode | ValueNode | undefined {
  return graph.nodes.find((n) => n.id === id) ?? graph.values.find((n) => n.id === id);
}

export function findMethodNode(graph: FlowGraph, id: string): MethodNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function isValueNode(node: MethodNode | ValueNode): node is ValueNode {
  return (node as ValueNode).kind === 'input' || (node as ValueNode).kind === 'literal' || (node as ValueNode).kind === 'global' || (node as ValueNode).kind === 'output';
}

export function portPosition(graph: FlowGraph, endpoint: Endpoint): Point {
  const node = findNode(graph, endpoint.node);
  if (!node) return { x: 0, y: 0 };
  if (isValueNode(node)) {
    return {
      x: endpoint.port.endsWith(':in') ? node.position.x : node.position.x + VALUE_WIDTH,
      y: node.position.y + VALUE_HEIGHT / 2,
    };
  }
  if (endpoint.port.includes(':in:')) {
    const idx = node.inputs.findIndex((p) => p.id === endpoint.port);
    return {
      x: node.position.x,
      y: node.position.y + NODE_HEADER + Math.max(0, idx) * NODE_ROW + NODE_ROW / 2,
    };
  }
  const idx = node.outputs.findIndex((p) => p.id === endpoint.port);
  return {
    x: node.position.x + NODE_WIDTH,
    y: node.position.y + NODE_HEADER + Math.max(0, idx) * NODE_ROW + NODE_ROW / 2,
  };
}

export function edgeKey(edge: FlowEdge): string {
  return `${edge.from.node}:${edge.from.port}->${edge.to.node}:${edge.to.port}`;
}

export function hasEdgeTo(graph: FlowGraph, to: Endpoint): FlowEdge | undefined {
  return graph.edges.find((e) => e.to.node === to.node && e.to.port === to.port);
}

export function hasEdgeFrom(graph: FlowGraph, from: Endpoint): FlowEdge[] {
  return graph.edges.filter((e) => e.from.node === from.node && e.from.port === from.port);
}

function methodAdjacency(graph: FlowGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes) adj.set(n.id, new Set());
  for (const e of graph.edges) {
    if (graph.nodes.some((n) => n.id === e.from.node) && graph.nodes.some((n) => n.id === e.to.node)) {
      adj.get(e.from.node)!.add(e.to.node);
    }
  }
  return adj;
}

export function wouldCreateCycle(graph: FlowGraph, fromNode: string, toNode: string): boolean {
  if (fromNode === toNode) return true;
  const adj = methodAdjacency(graph);
  const stack = [toNode];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === fromNode) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

export function connectionError(graph: FlowGraph, from: Endpoint, to: Endpoint): string | undefined {
  if (from.node === to.node) return '不能连接到自身';
  const fromNode = findNode(graph, from.node);
  const toNode = findNode(graph, to.node);
  if (!fromNode || !toNode) return '节点不存在';
  if (isValueNode(fromNode) && fromNode.kind === 'output') return '流程输出不能作为起点';
  if (isValueNode(toNode) && toNode.kind !== 'output') return '参数节点没有输入口';
  if (!isValueNode(fromNode) && !fromNode.outputs.some((p) => p.id === from.port)) return '输出端口不存在';
  if (isValueNode(toNode)) {
    if (to.port !== valueInPort(toNode)) return '输入端口不存在';
    if (fromNode.id === toNode.id) return '不能连接到自身';
    return undefined;
  }
  if (!toNode.inputs.some((p) => p.id === to.port)) return '输入端口不存在';
  if (graph.nodes.some((n) => n.id === from.node) && wouldCreateCycle(graph, from.node, to.node)) return '这条连线会形成环';
  return undefined;
}

export interface ConnectResult {
  ok: boolean;
  edge?: FlowEdge;
  replaced?: FlowEdge;
  reason?: string;
}

export function connect(graph: FlowGraph, from: Endpoint, to: Endpoint): ConnectResult {
  const reason = connectionError(graph, from, to);
  if (reason) return { ok: false, reason };
  const replaced = hasEdgeTo(graph, to);
  if (replaced) {
    graph.edges = graph.edges.filter((e) => e.id !== replaced.id);
  }
  const edge: FlowEdge = { id: uid('e'), from: { ...from }, to: { ...to } };
  graph.edges.push(edge);
  return { ok: true, edge, replaced };
}

export function removeEdge(graph: FlowGraph, edgeId: string): void {
  graph.edges = graph.edges.filter((e) => e.id !== edgeId);
}

export function removeNodes(graph: FlowGraph, ids: string[]): void {
  const set = new Set(ids);
  const removedValues = graph.values.filter((v) => set.has(v.id));
  graph.nodes = graph.nodes.filter((n) => !set.has(n.id));
  graph.values = graph.values.filter((v) => !set.has(v.id));
  graph.edges = graph.edges.filter((e) => !set.has(e.from.node) && !set.has(e.to.node));
  for (const v of removedValues) {
    if (v.kind === 'input') graph.params = graph.params.filter((p) => p.name !== v.name);
  }
  syncSignature(graph);
}

/** Remove auto-created input/literal/global values that no longer feed anything. */
export function pruneValues(graph: FlowGraph): void {
  const used = new Set(graph.edges.map((e) => e.from.node).concat(graph.edges.map((e) => e.to.node)));
  graph.values = graph.values.filter((v) => used.has(v.id) || v.kind === 'output' || v.hidden || !v.auto);
  syncSignature(graph);
}

/**
 * Fold a source value (input / literal / global) into the method input it
 * feeds. The port stores the expression as its default, so the graph no longer
 * draws a separate parameter pill for something that is not inherited.
 * Input values are kept as hidden signature declarations; literals/globals are
 * removed.
 */
export function foldSourceValues(graph: FlowGraph): void {
  const methodIds = new Set(graph.nodes.map((node) => node.id));
  const removedEdges = new Set<string>();
  const removedValues = new Set<string>();

  for (const value of graph.values) {
    if (value.hidden || value.kind === 'output') continue;
    if (graph.edges.some((edge) => edge.to.node === value.id)) continue;
    const outgoing = graph.edges.filter((edge) => edge.from.node === value.id);
    if (!outgoing.length) continue;
    // Only fold pure source values whose consumers are method ports.
    if (outgoing.some((edge) => !methodIds.has(edge.to.node))) continue;
    const expression = value.kind === 'literal' ? value.value ?? value.name : value.name;
    let folded = false;
    for (const edge of outgoing) {
      const target = graph.nodes.find((node) => node.id === edge.to.node);
      const port = target?.inputs.find((item) => item.id === edge.to.port);
      if (!port) continue;
      port.defaultValue = expression;
      removedEdges.add(edge.id);
      folded = true;
    }
    if (!folded) continue;
    if (value.kind === 'input') {
      value.hidden = true;
      value.auto = false;
    } else {
      removedValues.add(value.id);
    }
  }

  if (removedEdges.size) {
    graph.edges = graph.edges.filter((edge) => !removedEdges.has(edge.id));
  }
  if (removedValues.size) {
    graph.values = graph.values.filter((value) => !removedValues.has(value.id));
  }
}

export function syncSignature(graph: FlowGraph): void {
  const inputs = graph.values.filter((v) => v.kind === 'input');
  const existing = new Map(graph.params.map((p) => [p.name, p]));
  graph.params = inputs
    .slice()
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .map((v) => {
      const prev = existing.get(v.name);
      return {
        name: v.name,
        type: v.type,
        annotation: v.annotation ?? prev?.annotation,
        defaultValue: prev?.defaultValue,
        description: prev?.description,
      } as ParamSpec;
    });
  const outputs = graph.values.filter((v) => v.kind === 'output');
  graph.returns = outputs.map((v) => ({ name: v.name, type: v.type, annotation: v.annotation }) as ReturnSpec);
}

/** Reuse an existing value node with the same name/type, if present. */
export function findReusableValue(graph: FlowGraph, name: string, kind: ValueKind, type: PortType): ValueNode | undefined {
  return graph.values.find(
    (v) => !v.hidden && v.kind === kind && v.name === name && (v.type === type || v.type === 'any' || type === 'any'),
  );
}

export function firstCompatibleOutput(graph: FlowGraph, name: string, toNode: string, x: number): MethodNode | undefined {
  const candidates = graph.nodes.filter((n) => n.id !== toNode && n.outputs.some((p) => p.name === name) && n.position.x < x + 20);
  candidates.sort((a, b) => b.position.x - a.position.x);
  return candidates[0];
}

function defaultExpressionForPort(graph: FlowGraph, port: Port): string {
  if (graph.params.some((param) => param.name === port.name)) return port.name;
  switch (port.type) {
    case 'number':
    case 'int':
      return '0';
    case 'string':
      return "''";
    case 'boolean':
      return 'False';
    case 'list':
      return '[]';
    case 'dict':
      return '{}';
    case 'none':
      return 'None';
    default:
      return 'None';
  }
}

export function autoWire(graph: FlowGraph, node: MethodNode, preferredX?: number): void {
  const x = preferredX ?? node.position.x;
  node.inputs.forEach((port) => {
    if (hasEdgeTo(graph, { node: node.id, port: port.id })) return;
    const sourceNode = firstCompatibleOutput(graph, port.name, node.id, x);
    if (sourceNode) {
      const out = sourceNode.outputs.find((p) => p.name === port.name)!;
      if (connect(graph, { node: sourceNode.id, port: out.id }, { node: node.id, port: port.id }).ok) return;
    }
    const existing = findReusableValue(graph, port.name, 'input', port.type);
    if (existing && graph.edges.every((e) => e.from.node !== existing.id || e.to.port !== port.id)) {
      if (connect(graph, { node: existing.id, port: valueOutPort(existing) }, { node: node.id, port: port.id }).ok) return;
    }
    if (port.defaultValue !== undefined) return;
    // Non-inherited parameters live in the interface as a default value,
    // instead of creating a separate input pill on the canvas.
    port.defaultValue = defaultExpressionForPort(graph, port);
  });
  syncSignature(graph);
}

export function cloneGraph(graph: FlowGraph): FlowGraph {
  return structuredClone(graph);
}

/** Preserve hand-placed positions when a fresh graph is parsed from code. */
export function mergePositions(next: FlowGraph, prev: FlowGraph | undefined): FlowGraph {
  if (!prev) return next;
  const positions = new Map<string, Point>();
  for (const n of [...prev.nodes, ...prev.values]) positions.set(n.key, n.position);
  for (const n of [...next.nodes, ...next.values]) {
    const p = positions.get(n.key);
    if (p) n.position = { ...p };
  }
  return next;
}

export function collectWarnings(graph: FlowGraph): FlowWarning[] {
  // Parser / control-flow warnings are persistent; connection and type
  // warnings are recomputed from the current edges so they never go stale.
  const warnings = graph.warnings.filter(
    (warning) => warning.code !== 'unconnected' && warning.code !== 'type',
  );
  const seen = new Set(warnings.map((warning) => `${warning.code}|${warning.nodeId ?? ''}|${warning.message}|${warning.line ?? ''}`));
  const add = (warning: FlowWarning) => {
    const key = `${warning.code}|${warning.nodeId ?? ''}|${warning.message}|${warning.line ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      warnings.push(warning);
    }
  };
  for (const node of graph.nodes) {
    for (const port of node.inputs) {
      if (!graph.edges.some((e) => e.to.node === node.id && e.to.port === port.id) && !port.defaultValue && !port.optional) {
        add({
          code: 'unconnected',
          message: `${node.name} 的输入参数 “${port.name}” 还没有接入`,
          nodeId: node.id,
          line: node.sourceRange?.start.line,
        });
      }
    }
  }
  for (const edge of graph.edges) {
    const target = findNode(graph, edge.to.node);
    if (!target) continue;
    const port = isValueNode(target) ? undefined : target.inputs.find((p) => p.id === edge.to.port);
    if (port && !isValueNode(target)) {
      const source = findNode(graph, edge.from.node);
      if (source && !isValueNode(source)) {
        const out = source.outputs.find((p) => p.id === edge.from.port);
        if (out && out.type !== port.type && out.type !== 'any' && port.type !== 'any') {
          add({
            code: 'type',
            message: `${source.name}.${out.name}（${out.type}）连接到 ${target.name}.${port.name}（${port.type}），类型不一致`,
            nodeId: target.id,
          });
        }
      }
    }
  }
  for (const value of graph.values) {
    if (value.kind === 'output' && !graph.edges.some((edge) => edge.to.node === value.id)) {
      add({
        code: 'unconnected',
        message: `流程输出 “${value.name}” 还没有接入任何方法`,
        nodeId: value.id,
      });
    }
  }
  return warnings;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function isIdentifier(name: string): boolean {
  return IDENT.test(name);
}

export function sanitizeIdentifier(name: string, fallback = 'value'): string {
  let out = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(out)) out = `_${out}`;
  return out || fallback;
}

export function graphBounds(graph: FlowGraph): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of graph.nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
    maxY = Math.max(maxY, n.position.y + nodeHeight(n));
  }
  for (const v of graph.values) {
    if (v.hidden) continue;
    minX = Math.min(minX, v.position.x);
    minY = Math.min(minY, v.position.y);
    maxX = Math.max(maxX, v.position.x + VALUE_WIDTH);
    maxY = Math.max(maxY, v.position.y + VALUE_HEIGHT);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number,
): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/** Find a nearby free spot for a new block, so dropped methods never stack. */
export function findFreeSpot(graph: FlowGraph, desired: Point, width: number, height: number): Point {
  const obstacles = [
    ...graph.nodes.map((n) => ({ x: n.position.x, y: n.position.y, width: NODE_WIDTH, height: nodeHeight(n) })),
    ...graph.values.map((v) => ({ x: v.position.x, y: v.position.y, width: VALUE_WIDTH, height: VALUE_HEIGHT })),
  ];
  const gap = 26;
  const stepX = width + 48;
  const stepY = height + 44;
  const offsets: Point[] = [{ x: 0, y: 0 }];
  for (let ring = 1; ring <= 8; ring += 1) {
    offsets.push(
      { x: ring * stepX, y: 0 },
      { x: 0, y: ring * stepY },
      { x: -ring * stepX, y: 0 },
      { x: 0, y: -ring * stepY },
      { x: ring * stepX, y: ring * stepY },
      { x: -ring * stepX, y: ring * stepY },
      { x: ring * stepX, y: -ring * stepY },
      { x: -ring * stepX, y: -ring * stepY },
    );
  }
  for (const offset of offsets) {
    const candidate = {
      x: desired.x + offset.x,
      y: desired.y + offset.y,
      width,
      height,
    };
    if (!obstacles.some((obstacle) => overlaps(candidate, obstacle, gap))) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return { x: desired.x, y: desired.y + graph.nodes.length * stepY };
}
