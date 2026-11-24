import { collectWarnings, foldSourceValues, mergePositions, syncSignature } from './graph';
import { layoutGraph } from './layout';
import { operatorSpec, resolveCall } from './registry';
import type { FlowGraph, MethodNode, MethodSpec, Port } from './types';

function adaptEffect(effect: string, spec: MethodSpec, node: MethodNode): string {
  if (!spec.returns.length || !node.outputs.length) return effect;
  const oldName = spec.returns[0].name;
  const newName = node.outputs[0].name;
  if (!oldName || oldName === newName) return effect;
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${oldName}([^A-Za-z0-9_]|$)`);
  if (!pattern.test(effect)) return effect;
  return effect.replace(pattern, (_m, before, after) => `${before}${newName}${after}`).trim();
}

function reconcilePorts(ports: Port[], specs: { name: string; type: string }[], allowRename: boolean): void {
  ports.forEach((port, i) => {
    const spec = specs[i];
    if (!spec) return;
    if (allowRename && (port.name === `arg${i + 1}` || port.name === 'result' || !port.name)) {
      port.name = spec.name;
    }
    if (port.type === 'any' && spec.type !== 'any') port.type = spec.type as Port['type'];
  });
}

export function enrichNode(node: MethodNode, userMethods: MethodSpec[]): void {
  const spec = node.op
    ? operatorSpec(node.op)
    : resolveCall(node.callee ?? node.qualifiedName ?? node.name, userMethods);
  if (!spec) {
    if (node.category === '内置') node.category = '函数';
    return;
  }
  node.methodId = spec.id;
  node.category = spec.category;
  node.origin = spec.origin;
  node.qualifiedName = spec.qualifiedName ?? node.qualifiedName;
  if (spec.kind === 'operator') node.kind = 'operator';
  node.effect = adaptEffect(spec.effect, spec, node);
  reconcilePorts(node.inputs, spec.params, spec.origin === 'user');
  reconcilePorts(node.outputs, spec.returns.map((r) => ({ name: r.name, type: r.type })), spec.origin === 'user');
}

export function enrichGraph(graph: FlowGraph, userMethods: MethodSpec[]): FlowGraph {
  for (const node of graph.nodes) enrichNode(node, userMethods);
  foldSourceValues(graph);
  // Node output names are the source of truth for signature returns.
  syncSignature(graph);
  graph.warnings = collectWarnings(graph);
  return graph;
}

/** Convert the raw bridge payload into a positioned, decorated FlowGraph. */
export function hydrateGraph(raw: FlowGraph, userMethods: MethodSpec[], previous?: FlowGraph): FlowGraph {
  const graph: FlowGraph = structuredClone(raw);
  for (const node of graph.nodes) {
    node.key = node.key || node.id;
    node.position = node.position ?? { x: 0, y: 0 };
  }
  for (const value of graph.values) {
    value.key = value.key || value.id;
    value.position = value.position ?? { x: 0, y: 0 };
  }
  enrichGraph(graph, userMethods);
  const topology = topologyKey(graph);
  const sameTopology = Boolean(previous) && topologyKey(previous!) === topology;
  const positioned = graph.nodes.length === 0 || graph.nodes.some((node) => node.position.x !== 0 || node.position.y !== 0);
  // A changed dependency graph should be re-layered; preserving old positions
  // would leave independent producers and their consumer in the wrong column.
  if (!positioned || !sameTopology) layoutGraph(graph);
  if (sameTopology) mergePositions(graph, previous);
  return graph;
}

function topologyKey(graph: FlowGraph): string {
  const nodes = graph.nodes.map((node) => node.key || node.id).sort().join(',');
  const edges = graph.edges
    .map((edge) => `${edge.from.node}:${edge.from.port}>${edge.to.node}:${edge.to.port}`)
    .sort()
    .join('|');
  return `${nodes}::${edges}`;
}
