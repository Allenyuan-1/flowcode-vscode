import {
  NODE_HEADER,
  NODE_ROW,
  NODE_WIDTH,
  VALUE_GAP,
  VALUE_HEIGHT,
  VALUE_WIDTH,
  nodeHeight,
  portPosition,
} from './graph';
import type { FlowGraph, MethodNode, Point, ValueNode } from './types';

export type FlowOrientation = 'horizontal' | 'vertical';

const H_GAP_MIN = 365;
const H_GAP_MAX = 680;
const V_GAP_MIN = 70;
const V_GAP_MAX = 440;
const ROW_GAP = 44;
const PILL_GAP = 50;
const OUTPUT_GAP = 62;

function deps(graph: FlowGraph): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const methods = new Set(graph.nodes.map((n) => n.id));
  for (const n of graph.nodes) map.set(n.id, new Set());
  const producers = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    const fromMethod = methods.has(e.from.node);
    const toMethod = methods.has(e.to.node);
    if (fromMethod && toMethod) {
      map.get(e.to.node)!.add(e.from.node);
    } else if (fromMethod && !toMethod) {
      if (!producers.has(e.to.node)) producers.set(e.to.node, new Set());
      producers.get(e.to.node)!.add(e.from.node);
    }
  }
  // Values are transparent for layering: a method that consumes a value
  // depends on every method that produced it. This keeps independent
  // producers (add / menos) on the same layer and moves their consumer
  // (xiangjia) to the next one, even when the UI inserts value pills.
  for (const e of graph.edges) {
    if (methods.has(e.from.node) || !methods.has(e.to.node)) continue;
    for (const producer of producers.get(e.from.node) ?? []) {
      map.get(e.to.node)!.add(producer);
    }
  }
  return map;
}

function layerMap(graph: FlowGraph): Map<string, number> {
  const map = deps(graph);
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let value = 0;
    for (const dep of map.get(id) ?? []) value = Math.max(value, visit(dep) + 1);
    visiting.delete(id);
    layer.set(id, value);
    return value;
  };
  for (const n of graph.nodes) visit(n.id);
  const initial = new Map(layer);

  // Parallel branches must share a column:
  // - front parallel: one parent with several children -> left edges align;
  // - end parallel: several parents with one child -> right edges align.
  const children = new Map<string, Set<string>>();
  const groups: string[][] = [];
  for (const node of graph.nodes) children.set(node.id, new Set());
  for (const [child, parents] of map) {
    if (parents.size > 1) groups.push([...parents]);
    for (const parent of parents) children.get(parent)?.add(child);
  }
  for (const [, kids] of children) {
    if (kids.size > 1) groups.push([...kids]);
  }
  if (!groups.length) return layer;

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const group of groups) {
    for (let i = 1; i < group.length; i += 1) union(group[0], group[i]);
  }

  const components = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const root = find(node.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(node.id);
  }
  const hasInternalDependency = (ids: string[]): boolean => {
    const set = new Set(ids);
    for (const id of ids) {
      for (const dependency of map.get(id) ?? []) {
        if (set.has(dependency)) return true;
      }
    }
    return false;
  };
  // An equality constraint that contains an ancestor/descendant pair is
  // contradictory; fall back to the plain dependency layering.
  if ([...components.values()].some(hasInternalDependency)) return initial;

  const aligned = new Map(layer);
  for (const ids of components.values()) {
    const max = Math.max(...ids.map((id) => aligned.get(id) ?? 0));
    for (const id of ids) aligned.set(id, max);
  }

  const maxIterations = graph.nodes.length * 3 + 5;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (const ids of components.values()) {
      const max = Math.max(...ids.map((id) => aligned.get(id) ?? 0));
      for (const id of ids) {
        if ((aligned.get(id) ?? 0) !== max) {
          aligned.set(id, max);
          changed = true;
        }
      }
    }
    for (const node of graph.nodes) {
      const current = aligned.get(node.id) ?? 0;
      const required = Math.max(
        current,
        ...Array.from(map.get(node.id) ?? []).map((dependency) => (aligned.get(dependency) ?? 0) + 1),
      );
      if (required !== current) {
        aligned.set(node.id, required);
        changed = true;
      }
    }
    if (!changed) return aligned;
  }
  return initial;
}

function groupedLayers(graph: FlowGraph): MethodNode[][] {
  const layer = layerMap(graph);
  const max = Math.max(0, ...layer.values());
  const groups: MethodNode[][] = Array.from({ length: max + 1 }, () => []);
  for (const node of graph.nodes) groups[layer.get(node.id) ?? 0].push(node);
  for (const group of groups) {
    group.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key));
  }
  return groups;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function spread(values: number[], gap: number): number[] {
  if (values.length < 2) return values;
  const sorted = values.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = sorted.map((v) => v.y);
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] - out[i - 1] < gap) out[i] = out[i - 1] + gap;
  }
  const shift = sorted[0].y - out[0];
  const result = new Array(values.length).fill(0);
  sorted.forEach((v, i) => {
    result[v.i] = out[i] + shift;
  });
  return result;
}

export interface LayoutOptions {
  orientation?: FlowOrientation;
  width?: number;
  height?: number;
  layerGap?: number;
  rowGap?: number;
  originX?: number;
  originY?: number;
}

function placeHorizontal(graph: FlowGraph, groups: MethodNode[][], options: LayoutOptions): void {
  const targetW = options.width ?? 0;
  const targetH = options.height ?? 0;
  const methods = new Set(graph.nodes.map((node) => node.id));
  const hasIntermediateValue = graph.values.some((value) => {
    const incoming = graph.edges.some((edge) => edge.to.node === value.id && methods.has(edge.from.node));
    const outgoing = graph.edges.some((edge) => edge.from.node === value.id && methods.has(edge.to.node));
    return incoming && outgoing;
  });
  const minGap = hasIntermediateValue ? H_GAP_MIN + VALUE_WIDTH + 30 : H_GAP_MIN;
  const layerGap = options.layerGap ?? (() => {
    if (groups.length <= 1 || !targetW) return minGap;
    const usable = targetW - 120 - VALUE_WIDTH * 2 - 60;
    return clamp((usable - NODE_WIDTH * groups.length) / (groups.length - 1), minGap, H_GAP_MAX);
  })();

  groups.forEach((nodes, layer) => {
    const total = nodes.reduce((sum, n) => sum + nodeHeight(n), 0) + Math.max(0, nodes.length - 1) * ROW_GAP;
    let y = targetH ? (targetH - total) / 2 : -total / 2;
    for (const node of nodes) {
      node.position = { x: 60 + layer * layerGap, y };
      y += nodeHeight(node) + ROW_GAP;
    }
  });
}

function flowOrder(graph: FlowGraph): MethodNode[] {
  const map = deps(graph);
  const indegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    adj.set(node.id, new Set());
  }
  for (const node of graph.nodes) {
    for (const dependency of map.get(node.id) ?? []) {
      if (!adj.has(dependency)) continue;
      if (!adj.get(dependency)!.has(node.id)) {
        adj.get(dependency)!.add(node.id);
        indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      }
    }
  }
  const rank = (node: MethodNode) =>
    node.order !== undefined ? node.order : 1_000_000 + node.position.y * 1000 + node.position.x;
  const ready = graph.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).sort((a, b) => rank(a) - rank(b));
  const result: MethodNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    result.push(node);
    for (const next of adj.get(node.id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if (indegree.get(next) === 0) {
        const found = graph.nodes.find((n) => n.id === next);
        if (found) {
          ready.push(found);
          ready.sort((a, b) => rank(a) - rank(b));
        }
      }
    }
  }
  if (result.length < graph.nodes.length) {
    const rest = graph.nodes.filter((n) => !result.includes(n)).sort((a, b) => rank(a) - rank(b));
    result.push(...rest);
  }
  return result;
}

function placeVertical(graph: FlowGraph, groups: MethodNode[][], options: LayoutOptions): void {
  void groups;
  const targetW = options.width ?? 0;
  const targetH = options.height ?? 0;
  const nodes = flowOrder(graph);
  const sum = nodes.reduce((total, node) => total + nodeHeight(node), 0);
  let gap = options.layerGap ?? V_GAP_MIN;
  if (!options.layerGap && targetH && nodes.length > 1) {
    gap = clamp((targetH - 140 - sum) / (nodes.length - 1), V_GAP_MIN, V_GAP_MAX);
  }
  const total = sum + gap * Math.max(0, nodes.length - 1);
  let y = targetH ? Math.max(40, (targetH - total) / 2) : 60;
  const x = targetW ? Math.max(60, (targetW - NODE_WIDTH) / 2) : 60;
  for (const node of nodes) {
    node.position = { x, y };
    y += nodeHeight(node) + gap;
  }
}

function placeValues(graph: FlowGraph): void {
  const maxRight = Math.max(0, ...graph.nodes.map((n) => n.position.x + NODE_WIDTH));
  const methods = new Set(graph.nodes.map((node) => node.id));
  const groups = new Map<string, { value: ValueNode; portY: number }[]>();
  const outputValues: ValueNode[] = [];

  for (const value of graph.values) {
    if (value.hidden) continue;
    const incomingMethods = graph.edges.filter(
      (edge) => edge.to.node === value.id && methods.has(edge.from.node),
    );
    const outgoingMethods = graph.edges.filter(
      (edge) => edge.from.node === value.id && methods.has(edge.to.node),
    );

    if (incomingMethods.length && outgoingMethods.length === 0) {
      const source = incomingMethods[incomingMethods.length - 1];
      value.position.y = portPosition(graph, source.from).y - VALUE_HEIGHT / 2;
      outputValues.push(value);
      continue;
    }

    if (incomingMethods.length) {
      // Intermediate value: sit just after its producer, not just before its
      // consumer, so the edge always travels left-to-right.
      const producerEdge = incomingMethods[incomingMethods.length - 1];
      const producer = graph.nodes.find((node) => node.id === producerEdge.from.node);
      if (producer) {
        const portY = portPosition(graph, producerEdge.from).y;
        const x = producer.position.x + NODE_WIDTH + 18;
        value.position = { x, y: portY - VALUE_HEIGHT / 2 };
        const key = `${Math.round(x)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ value, portY });
        continue;
      }
    }

    const outgoing = graph.edges.filter((edge) => edge.from.node === value.id);
    const targets = outgoing
      .map((edge) => ({
        node: graph.nodes.find((node) => node.id === edge.to.node),
        port: edge.to.port,
      }))
      .filter((target): target is { node: MethodNode; port: string } => Boolean(target.node));
    targets.sort((a, b) => a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y);
    const first = targets[0];
    if (!first) {
      value.position = { x: 60, y: 0 };
      continue;
    }
    const index = first.node.inputs.findIndex((port) => port.id === first.port);
    const portY = first.node.position.y + NODE_HEADER + Math.max(0, index) * NODE_ROW + NODE_ROW / 2;
    const gx = first.node.position.x - VALUE_WIDTH - VALUE_GAP;
    value.position = { x: gx, y: portY - VALUE_HEIGHT / 2 };
    const key = `${Math.round(gx)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ value, portY });
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.portY - b.portY || a.value.id.localeCompare(b.value.id));
    const ys = spread(group.map((entry) => entry.portY), PILL_GAP);
    group.forEach((entry, index) => {
      entry.value.position.y = ys[index] - VALUE_HEIGHT / 2;
    });
  }

  if (outputValues.length) {
    outputValues.sort((a, b) => a.position.y - b.position.y);
    const mean = outputValues.reduce((sum, value) => sum + value.position.y, 0) / outputValues.length;
    const start = mean - ((outputValues.length - 1) * OUTPUT_GAP) / 2;
    outputValues.forEach((value, index) => {
      value.position.x = maxRight + 90;
      value.position.y = start + index * OUTPUT_GAP;
    });
  }
}

function centerIn(graph: FlowGraph, options: LayoutOptions): void {
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
  if (!Number.isFinite(minX)) return;
  const width = maxX - minX;
  const height = maxY - minY;
  let dx: number;
  let dy: number;
  if (options.width || options.height) {
    dx = options.width ? (options.width - width) / 2 - minX : 60 - minX;
    dy = options.height ? (options.height - height) / 2 - minY : 60 - minY;
  } else {
    dx = 72 - minX;
    dy = 92 - minY;
  }
  for (const n of [...graph.nodes, ...graph.values]) {
    n.position.x += dx;
    n.position.y += dy;
  }
}

/**
 * Layered data-flow layout. In landscape the layers run left-to-right; in a
 * portrait window they run top-to-bottom and the gaps expand so the diagram
 * uses the available window instead of clustering in one corner.
 */
export function layoutGraph(graph: FlowGraph, options: LayoutOptions = {}): FlowGraph {
  const orientation = options.orientation ?? 'horizontal';
  const groups = groupedLayers(graph);
  if (orientation === 'vertical') placeVertical(graph, groups, options);
  else placeHorizontal(graph, groups, options);
  placeValues(graph);
  centerIn(graph, options);
  return graph;
}

export function centerOf(graph: FlowGraph): Point {
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
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
