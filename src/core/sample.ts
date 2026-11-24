import { connect, createMethodNode, createValueNode, foldSourceValues, nodeHeight, NODE_WIDTH, VALUE_WIDTH } from './graph';
import { layoutGraph } from './layout';
import { makeUserSpec } from './registry';
import type { FlowGraph, MethodSpec, ParamSpec, ReturnSpec } from './types';

export const DEMO_SOURCE = `def add(a: float, b: float) -> float:
    """加和 a、b 为 c"""
    c = a + b
    return c


def normalize(x: float, scale: float) -> float:
    """按 scale 缩放 x"""
    return x / scale


def main(x: float, y: float) -> float:
    """把两个数加和后缩放"""
    s = add(x, y)
    n = normalize(s, 2.0)
    return n
`;

function spec(name: string, effect: string, params: ParamSpec[], returns: ReturnSpec[]): MethodSpec {
  return makeUserSpec({ name, effect, params, returns, doc: effect });
}

export function demoMethods(): MethodSpec[] {
  return [
    spec('add', '加和 a、b 为 c', [
      { name: 'a', type: 'number', annotation: 'float' },
      { name: 'b', type: 'number', annotation: 'float' },
    ], [{ name: 'c', type: 'number', annotation: 'float' }]),
    spec('normalize', '按 scale 缩放 x', [
      { name: 'x', type: 'number', annotation: 'float' },
      { name: 'scale', type: 'number', annotation: 'float' },
    ], [{ name: 'result', type: 'number', annotation: 'float' }]),
  ];
}

export function demoGraph(): FlowGraph {
  const add = createMethodNode(demoMethods()[0], { x: 0, y: 0 }, 'demo-add');
  add.name = 'add';
  add.effect = '加和 a、b 为 s';
  add.outputs[0].name = 's';
  const normalize = createMethodNode(demoMethods()[1], { x: 0, y: 0 }, 'demo-normalize');
  normalize.name = 'normalize';
  normalize.effect = '按 scale 缩放 s';
  normalize.outputs[0].name = 'n';

  const values = [
    createValueNode({ kind: 'input', name: 'x', type: 'number', annotation: 'float', position: { x: 0, y: 0 }, id: 'demo-x' }),
    createValueNode({ kind: 'input', name: 'y', type: 'number', annotation: 'float', position: { x: 0, y: 0 }, id: 'demo-y' }),
    createValueNode({ kind: 'literal', name: '2.0', type: 'number', value: '2.0', position: { x: 0, y: 0 }, id: 'demo-lit' }),
    createValueNode({ kind: 'output', name: 'n', type: 'number', annotation: 'float', position: { x: 0, y: 0 }, id: 'demo-out' }),
  ];
  const [x, y, two, out] = values;
  const graph: FlowGraph = {
    version: 1,
    id: 'demo',
    name: 'main',
    doc: '把两个数加和后缩放',
    language: 'python',
    entryKind: 'function',
    params: [
      { name: 'x', type: 'number', annotation: 'float' },
      { name: 'y', type: 'number', annotation: 'float' },
    ],
    returns: [{ name: 'n', type: 'number', annotation: 'float' }],
    returnType: 'float',
    nodes: [add, normalize],
    values,
    edges: [],
    warnings: [],
    fileName: 'demo.py',
  };
  const inPort = (node: typeof add, i: number) => ({ node: node.id, port: node.inputs[i].id });
  const outPort = (node: typeof add, i = 0) => ({ node: node.id, port: node.outputs[i].id });
  connect(graph, { node: x.id, port: `${x.id}:out` }, inPort(add, 0));
  connect(graph, { node: y.id, port: `${y.id}:out` }, inPort(add, 1));
  connect(graph, outPort(add), inPort(normalize, 0));
  connect(graph, { node: two.id, port: `${two.id}:out` }, inPort(normalize, 1));
  connect(graph, outPort(normalize), { node: out.id, port: `${out.id}:in` });
  foldSourceValues(graph);
  layoutGraph(graph);
  const shift = { x: 56, y: 40 };
  for (const n of [...graph.nodes, ...graph.values]) {
    n.position.x += shift.x;
    n.position.y += shift.y;
  }
  return graph;
}

export function demoStats(graph: FlowGraph): { width: number; height: number } {
  let w = 0;
  let h = 0;
  for (const n of graph.nodes) {
    w = Math.max(w, n.position.x + NODE_WIDTH);
    h = Math.max(h, n.position.y + nodeHeight(n));
  }
  for (const v of graph.values) {
    if (v.hidden) continue;
    w = Math.max(w, v.position.x + VALUE_WIDTH);
    h = Math.max(h, v.position.y + 46);
  }
  return { width: w, height: h };
}
