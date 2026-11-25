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
const V_GAP_MIN = 92;
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

/**
 * Upstream/downstream layer model. Every method block has an upstream layer
 * (input side) and a downstream layer (output side); normally
 * upstream = downstream + 1, and a child's upstream equals its parent's
 * downstream. Methods without dependencies therefore share a layer, and when
 * several parents feed one child their downstream layers are unified to the
 * larger one — which aligns the parents on the same layer. Values stay
 * transparent: they never own a layer, they sit on the layer line between a
 * producer's downstream and a consumer's upstream.
 */
function layersOf(graph: FlowGraph): MethodNode[][] {
  const depsMap = deps(graph);
  const nodes = graph.nodes;
  const up = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const limit = nodes.length;
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of depsMap.get(current) ?? []) stack.push(next);
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      const parents = depsMap.get(node.id) ?? new Set<string>();
      if (!parents.size) continue;
      let maxUp = 0;
      for (const parent of parents) {
        const candidate = Math.min(limit, (up.get(parent) ?? 0) + 1);
        if (candidate > maxUp) maxUp = candidate;
      }
      if ((up.get(node.id) ?? 0) < maxUp) {
        up.set(node.id, maxUp);
        changed = true;
      }
      // Parents sharing a child take the larger downstream layer
      // (downstream = upstream + 1), so they end up on the same layer.
      // A parent that is also an ancestor of another parent must stay
      // upstream: forcing both onto one layer would demand
      // parent.up = descendant.up + 1 at the same time, and the iteration
      // would ratchet forever (e.g. tuple consuming x and x/y).
      // depsMap walks upstream (child -> parent), so "parent is an ancestor
      // of other" reads as: walking upstream from other reaches parent.
      const aligned = maxUp - 1;
      for (const parent of parents) {
        if ((up.get(parent) ?? 0) >= aligned) continue;
        const related = [...parents].some((other) => other !== parent && reaches(other, parent));
        if (related) continue;
        up.set(parent, aligned);
        changed = true;
      }
    }
  }
  const rank = (node: MethodNode) =>
    node.order !== undefined ? node.order : 1_000_000 + node.position.y * 1000 + node.position.x;
  const byLayer = new Map<number, MethodNode[]>();
  for (const node of graph.nodes) {
    const layer = up.get(node.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(node);
  }
  return [...byLayer.keys()]
    .sort((a, b) => a - b)
    .map((layer) => byLayer.get(layer)!.sort((a, b) => rank(a) - rank(b)));
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

type PlacedRow = { nodes: MethodNode[]; continuation: boolean };

const SIDE_MARGIN = 36;
const WRAP_GAP = 26;

/**
 * A row of parallel methods can be wider than the window. Keeping it on one
 * line pushes the outer blocks past the canvas edge, so wrap the row into
 * chunks that fit the available width.
 */
function wrapRow(row: MethodNode[], maxWidth: number): MethodNode[][] {
  if (!maxWidth) return [row];
  const room = Math.max(NODE_WIDTH, maxWidth - SIDE_MARGIN * 2);
  const perRow = Math.max(1, Math.floor((room + ROW_GAP) / (NODE_WIDTH + ROW_GAP)));
  if (row.length <= perRow) return [row];
  const chunks: MethodNode[][] = [];
  for (let i = 0; i < row.length; i += perRow) chunks.push(row.slice(i, i + perRow));
  return chunks;
}

function placeVertical(graph: FlowGraph, groups: MethodNode[][], options: LayoutOptions): void {
  const targetW = options.width ?? 0;
  const targetH = options.height ?? 0;
  const rows: PlacedRow[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    wrapRow(group, targetW).forEach((chunk, index) => {
      rows.push({ nodes: chunk, continuation: index > 0 });
    });
  }
  const rowHeights = rows.map((row) => Math.max(...row.nodes.map((node) => nodeHeight(node))));
  const sum = rowHeights.reduce((total, height) => total + height, 0);
  const wrapGaps = rows.reduce(
    (total, row, index) => (index > 0 && row.continuation ? total + WRAP_GAP : total),
    0,
  );
  const boundaries = rows.filter((row, index) => index > 0 && !row.continuation).length;
  let gap = options.layerGap ?? V_GAP_MIN;
  if (!options.layerGap && targetH && boundaries > 0) {
    gap = clamp((targetH - 140 - sum - wrapGaps) / boundaries, V_GAP_MIN, V_GAP_MAX);
  }
  const total = sum + wrapGaps + gap * boundaries;
  let y = targetH ? Math.max(40, (targetH - total) / 2) : 60;
  rows.forEach((row, rowIndex) => {
    const rowWidth = row.nodes.length * NODE_WIDTH + Math.max(0, row.nodes.length - 1) * ROW_GAP;
    let x = targetW ? Math.max(SIDE_MARGIN, (targetW - rowWidth) / 2) : 60;
    const rowHeight = rowHeights[rowIndex];
    for (const node of row.nodes) {
      node.position = {
        x,
        y: y + (rowHeight - nodeHeight(node)) / 2,
      };
      x += NODE_WIDTH + ROW_GAP;
    }
    y += rowHeight + (rows[rowIndex + 1]?.continuation ? WRAP_GAP : gap);
  });
}

/**
 * Values with no method on either side (parser noise like unconnected list
 * literals) still need a deterministic home. Without this they keep stale
 * positions across reflows and drift onto nodes via centerIn.
 */
function placeOrphanValues(orphans: ValueNode[], y: number): void {
  orphans.forEach((value, index) => {
    value.position = { x: 60 + index * (VALUE_WIDTH + 18), y };
  });
}

function placeValuesVertical(graph: FlowGraph): void {
  const methods = new Set(graph.nodes.map((node) => node.id));
  const outputs: ValueNode[] = [];
  const orphans: ValueNode[] = [];
  for (const value of graph.values) {
    if (value.hidden) continue;
    const incomingMethods = graph.edges.filter(
      (edge) => edge.to.node === value.id && methods.has(edge.from.node),
    );
    const outgoingMethods = graph.edges.filter(
      (edge) => edge.from.node === value.id && methods.has(edge.to.node),
    );

    if (incomingMethods.length && outgoingMethods.length === 0) {
      outputs.push(value);
      continue;
    }
    if (incomingMethods.length) {
      const edge = incomingMethods[incomingMethods.length - 1];
      const producer = graph.nodes.find((node) => node.id === edge.from.node);
      if (producer) {
        const port = portPosition(graph, edge.from, 'vertical');
        value.position = {
          x: port.x - VALUE_WIDTH / 2,
          y: producer.position.y + nodeHeight(producer) + VALUE_GAP,
        };
        continue;
      }
    }
    const targets = graph.edges
      .filter((edge) => edge.from.node === value.id)
      .map((edge) => ({
        node: graph.nodes.find((node) => node.id === edge.to.node),
        port: edge.to.port,
      }))
      .filter((target): target is { node: MethodNode; port: string } => Boolean(target.node));
    const first = targets[0];
    if (first) {
      const port = portPosition(graph, { node: first.node.id, port: first.port }, 'vertical');
      value.position = {
        x: port.x - VALUE_WIDTH / 2,
        y: first.node.position.y - VALUE_HEIGHT - VALUE_GAP,
      };
    } else {
      orphans.push(value);
    }
  }

  if (orphans.length) {
    const top = graph.nodes.length ? Math.min(...graph.nodes.map((node) => node.position.y)) : 60;
    placeOrphanValues(orphans, top - VALUE_HEIGHT - 10);
  }

  if (outputs.length) {
    const sourceYs = outputs.map((value) => {
      const edge = graph.edges.find((item) => item.to.node === value.id && methods.has(item.from.node));
      const source = edge ? graph.nodes.find((node) => node.id === edge.from.node) : undefined;
      return source ? source.position.y + nodeHeight(source) : 0;
    });
    const startY = Math.max(...sourceYs) + VALUE_GAP + 10;
    outputs.sort((a, b) => a.name.localeCompare(b.name));
    const minX = Math.min(...graph.nodes.map((node) => node.position.x));
    const maxX = Math.max(...graph.nodes.map((node) => node.position.x + NODE_WIDTH));
    const center = graph.nodes.length ? (minX + maxX) / 2 : 60;
    outputs.forEach((value, index) => {
      value.position = {
        x: center - VALUE_WIDTH / 2 + (index - (outputs.length - 1) / 2) * (VALUE_WIDTH + 18),
        y: startY,
      };
    });
  }
}

function placeValues(graph: FlowGraph, orientation: FlowOrientation): void {
  if (orientation === 'vertical') {
    placeValuesVertical(graph);
    return;
  }
  const maxRight = Math.max(0, ...graph.nodes.map((n) => n.position.x + NODE_WIDTH));
  const methods = new Set(graph.nodes.map((node) => node.id));
  const groups = new Map<string, { value: ValueNode; portY: number }[]>();
  const outputValues: ValueNode[] = [];
  const orphans: ValueNode[] = [];

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
      orphans.push(value);
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

  if (orphans.length) placeOrphanValues(orphans, 0);
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
  const groups = layersOf(graph);
  if (orientation === 'vertical') placeVertical(graph, groups, options);
  else placeHorizontal(graph, groups, options);
  placeValues(graph, orientation);
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
