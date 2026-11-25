import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoGraph, demoMethods } from '../src/core/sample';
import { generatePython } from '../src/core/generate';
import { hydrateGraph } from '../src/core/enrich';
import {
  connect, connectionError, createMethodNode, createValueNode, findFreeSpot, graphBounds, nodeHeight, NODE_WIDTH, portPosition,
} from '../src/core/graph';
import { layoutGraph } from '../src/core/layout';
import type { FlowGraph, MethodSpec, ParseResult } from '../src/core/types';

const root = process.cwd();

describe('code generation', () => {
  it('round-trips the demo flow into readable Python', () => {
    const graph = demoGraph();
    const result = generatePython(graph);
    expect(result.ok).toBe(true);
    expect(result.code).toContain('def main(x: float, y: float) -> float:');
    expect(result.code).toContain('s = add(x, y)');
    expect(result.code).toContain('n = normalize(s, 2.0)');
    expect(result.code).toContain('return n');
  });

  it('renders operators as infix expressions and keeps output names', () => {
    const graph: FlowGraph = {
      version: 1,
      id: 'g',
      name: 'sum',
      language: 'python',
      entryKind: 'function',
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      returns: [{ name: 'c', type: 'number' }],
      nodes: [],
      values: [],
      edges: [],
      warnings: [],
    };
    const a = createValueNode({ kind: 'input', name: 'a', type: 'number', position: { x: 0, y: 0 } });
    const b = createValueNode({ kind: 'input', name: 'b', type: 'number', position: { x: 0, y: 80 } });
    const node = createMethodNode({ ...demoMethods()[0], id: 'op.add', name: 'add', kind: 'operator', op: '+', origin: 'builtin', category: '运算符' }, { x: 300, y: 0 });
    const c = createValueNode({ kind: 'output', name: 'c', type: 'number', position: { x: 620, y: 0 } });
    graph.values.push(a, b, c);
    graph.nodes.push(node);
    connect(graph, { node: a.id, port: `${a.id}:out` }, { node: node.id, port: node.inputs[0].id });
    connect(graph, { node: b.id, port: `${b.id}:out` }, { node: node.id, port: node.inputs[1].id });
    connect(graph, { node: node.id, port: node.outputs[0].id }, { node: c.id, port: `${c.id}:in` });
    layoutGraph(graph);
    const result = generatePython(graph);
    expect(result.ok).toBe(true);
    expect(result.code).toContain('c = (a + b)');
    expect(result.code).toContain('return c');
  });

  it('rejects a connection that would create a cycle', () => {
    const graph = demoGraph();
    const a = graph.nodes[0];
    const b = graph.nodes[1];
    const result = connectionError(graph, { node: b.id, port: b.outputs[0].id }, { node: a.id, port: a.inputs[0].id });
    expect(result).toContain('环');
  });

  it('generates valid syntax for conditional expressions and subscripts', () => {
    const source = [
      'def pick(a, b, flag):',
      '    x = a if flag else b',
      '    return x[0]',
    ].join('\n');
    const payload = JSON.stringify({ source, filename: 'pick.py', entry: 'pick' });
    const output = execFileSync('python', [path.join(root, 'python/parse_flow.py')], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const parsed = JSON.parse(output) as ParseResult;
    const result = generatePython(hydrateGraph(parsed.graph, parsed.methods));
    expect(result.ok).toBe(true);
    expect(result.code).toContain('if');
    expect(result.code).toContain('[0]');
  });

  it('refuses to generate an empty module', () => {
    const graph: FlowGraph = {
      version: 1,
      id: 'empty',
      name: 'empty',
      language: 'python',
      entryKind: 'module',
      params: [],
      returns: [],
      nodes: [],
      values: [],
      edges: [],
      warnings: [],
    };
    const result = generatePython(graph);
    expect(result.ok).toBe(false);
  });
});

describe('layout and placement', () => {
  it('folds non-inherited values into method interface defaults', () => {
    const graph = demoGraph();
    const add = graph.nodes.find((node) => node.name === 'add')!;
    const normalize = graph.nodes.find((node) => node.name === 'normalize')!;
    expect(add.inputs.map((port) => port.defaultValue)).toEqual(['x', 'y']);
    expect(normalize.inputs[1].defaultValue).toBe('2.0');
    expect(graph.values.filter((value) => value.kind === 'input').every((value) => value.hidden)).toBe(true);
    expect(graph.values.some((value) => value.kind === 'literal')).toBe(false);
    expect(graph.params.map((param) => param.name)).toEqual(['x', 'y']);
  });

  it('aligns front-parallel children and end-parallel parents', () => {
    const spec = (name: string): MethodSpec => ({
      id: name,
      name,
      kind: 'function',
      category: 'test',
      signature: `${name}()`,
      effect: name,
      params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
      returns: [{ name: 'c', type: 'number' }],
      origin: 'user',
    });
    const graph: FlowGraph = {
      version: 1,
      id: 'parallel',
      name: 'main',
      language: 'python',
      entryKind: 'module',
      params: [],
      returns: [],
      nodes: [],
      values: [],
      edges: [],
      warnings: [],
    };
    const add = (id: string) => {
      const node = createMethodNode(spec(id), { x: 0, y: 0 }, id);
      graph.nodes.push(node);
      return node;
    };
    const a = add('a');
    const f = add('f');
    const e = add('e');
    const b = add('b');
    const c = add('c');
    const d = add('d');
    const edge = (id: string, fromId: string, to: typeof a, toIndex: number) => ({
      id,
      from: { node: fromId, port: `${fromId}:out:0` },
      to: { node: to.id, port: to.inputs[toIndex].id },
    });
    // front: a -> b, c; f -> e -> b (b deeper than c)
    graph.edges.push(
      edge('e1', f.id, e, 0),
      edge('e2', e.id, b, 0),
      edge('e3', a.id, b, 1),
      edge('e4', a.id, c, 0),
      // end: b and c both feed d
      edge('e5', b.id, d, 0),
      edge('e6', c.id, d, 1),
    );
    layoutGraph(graph, { orientation: 'horizontal', width: 1200, height: 800 });
    expect(b.position.x).toBe(c.position.x);
    expect(d.position.x).toBeGreaterThan(b.position.x);
  });

  it('does not put unrelated methods in the same column', () => {
    const spec = (name: string): MethodSpec => ({
      id: name,
      name,
      kind: 'function',
      category: 'test',
      signature: `${name}()`,
      effect: name,
      params: [],
      returns: [{ name: 'result', type: 'number' }],
      origin: 'user',
    });
    const a = createMethodNode(spec('a'), { x: 0, y: 0 }, 'a');
    const b = createMethodNode(spec('b'), { x: 0, y: 0 }, 'b');
    const graph: FlowGraph = {
      version: 1,
      id: 'unrelated',
      name: 'main',
      language: 'python',
      entryKind: 'module',
      params: [],
      returns: [],
      nodes: [a, b],
      values: [],
      edges: [],
      warnings: [],
    };
    layoutGraph(graph, { orientation: 'horizontal', width: 1200, height: 800 });
    expect(a.position.x).not.toBe(b.position.x);
  });

  it('puts vertical inputs on top and outputs on bottom', () => {
    const graph = demoGraph();
    layoutGraph(graph, { orientation: 'vertical', width: 900, height: 1200 });
    const add = graph.nodes.find((node) => node.name === 'add')!;
    const normalize = graph.nodes.find((node) => node.name === 'normalize')!;
    expect(add.position.y).toBeLessThan(normalize.position.y);
    const input = portPosition(graph, { node: add.id, port: add.inputs[0].id }, 'vertical');
    const output = portPosition(graph, { node: add.id, port: add.outputs[0].id }, 'vertical');
    expect(input.y).toBeCloseTo(add.position.y);
    expect(output.y).toBeCloseTo(add.position.y + nodeHeight(add));
    expect(input.x).toBeGreaterThan(add.position.x);
    expect(input.x).toBeLessThan(add.position.x + NODE_WIDTH);
  });

  it('keeps parallel methods on the same row in vertical mode', () => {
    const spec = (name: string): MethodSpec => ({
      id: name,
      name,
      kind: 'function',
      category: 'test',
      signature: `${name}(a, b)`,
      effect: name,
      params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
      returns: [{ name: 'c', type: 'number' }],
      origin: 'user',
    });
    const add = createMethodNode(spec('add'), { x: 0, y: 0 }, 'add');
    const menos = createMethodNode(spec('menos'), { x: 0, y: 0 }, 'menos');
    const xiangjia = createMethodNode(spec('xiangjia'), { x: 0, y: 0 }, 'xiangjia');
    const edge = (id: string, from: typeof add, to: typeof add, toIndex: number) => ({
      id,
      from: { node: from.id, port: from.outputs[0].id },
      to: { node: to.id, port: to.inputs[toIndex].id },
    });
    const graph: FlowGraph = {
      version: 1,
      id: 'vertical-parallel',
      name: 'main',
      language: 'python',
      entryKind: 'module',
      params: [],
      returns: [],
      nodes: [add, menos, xiangjia],
      values: [],
      edges: [
        edge('e1', add, xiangjia, 0),
        edge('e2', menos, xiangjia, 1),
      ],
      warnings: [],
    };
    layoutGraph(graph, { orientation: 'vertical', width: 1000, height: 1200 });
    expect(add.position.y).toBe(menos.position.y);
    expect(add.position.x).not.toBe(menos.position.x);
    expect(xiangjia.position.y).toBeGreaterThan(add.position.y);
  });

  it('wraps a row that is wider than the window instead of pushing blocks off-screen', () => {
    const spec = (name: string): MethodSpec => ({
      id: name,
      name,
      kind: 'function',
      category: 'test',
      signature: `${name}(a, b)`,
      effect: name,
      params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
      returns: [{ name: 'c', type: 'number' }],
      origin: 'user',
    });
    // six parallel producers feed one consumer: one row would be ~1900px wide
    const producers = Array.from({ length: 6 }, (_, i) =>
      createMethodNode(spec(`p${i}`), { x: 0, y: 0 }, `p${i}`));
    const sink = createMethodNode(
      { ...spec('sink'), params: Array.from({ length: 6 }, (_, i) => ({ name: `a${i}`, type: 'number' })) },
      { x: 0, y: 0 },
      'sink',
    );
    const edges = producers.map((producer, i) => ({
      id: `e${i}`,
      from: { node: producer.id, port: producer.outputs[0].id },
      to: { node: sink.id, port: sink.inputs[i].id },
    }));
    const graph: FlowGraph = {
      version: 1,
      id: 'vertical-wrap',
      name: 'main',
      language: 'python',
      entryKind: 'module',
      params: [],
      returns: [],
      nodes: [...producers, sink],
      values: [],
      edges,
      warnings: [],
    };
    const width = 900;
    layoutGraph(graph, { orientation: 'vertical', width, height: 1400 });
    // nothing may stick out horizontally: every block stays inside the canvas
    for (const node of graph.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.x + NODE_WIDTH).toBeLessThanOrEqual(width);
    }
    // the producers no longer share a single line
    const rows = new Set(producers.map((node) => Math.round(node.position.y)));
    expect(rows.size).toBeGreaterThan(1);
    expect(sink.position.y).toBeGreaterThan(Math.max(...producers.map((node) => node.position.y)));
  });

  it('places a new block without overlapping existing blocks', () => {
    const graph = demoGraph();
    const candidate = { x: graph.nodes[0].position.x, y: graph.nodes[0].position.y };
    const spot = findFreeSpot(graph, candidate, 230, 120);
    const bounds = graphBounds(graph);
    const overlaps = graph.nodes.some((n) => {
      return !(
        spot.x + 230 + 10 <= n.position.x ||
        n.position.x + 230 + 10 <= spot.x ||
        spot.y + 120 + 10 <= n.position.y ||
        n.position.y + nodeHeight(n) + 10 <= spot.y
      );
    });
    expect(overlaps).toBe(false);
    expect(bounds.width).toBeGreaterThan(0);
  });

  it('layers independent producers together and their consumer one step later', () => {
    const spec = (name: string): MethodSpec => ({
      id: name,
      name,
      kind: 'function',
      category: 'test',
      signature: `${name}(a, b)`,
      effect: name,
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      returns: [{ name: 'c', type: 'number' }],
      origin: 'user',
    });
    const add = createMethodNode(spec('add'), { x: 0, y: 0 }, 'add');
    const menos = createMethodNode(spec('menos'), { x: 0, y: 0 }, 'menos');
    const xiangjia = createMethodNode(spec('xiangjia'), { x: 0, y: 0 }, 'xiangjia');
    const value = (id: string, name: string, kind: 'input' | 'output') =>
      createValueNode({ id, kind, name, type: 'number', position: { x: 0, y: 0 } });
    const x = value('x', 'x', 'input');
    const y = value('y', 'y', 'input');
    const a = value('a', 'a', 'output');
    const b = value('b', 'b', 'output');
    const c = value('c', 'c', 'output');
    const edge = (id: string, from: { node: string; port: string }, to: { node: string; port: string }) => ({ id, from, to });
    const graph: FlowGraph = {
      version: 1,
      id: 'layers',
      name: 'main',
      language: 'python',
      entryKind: 'function',
      params: [],
      returns: [],
      nodes: [add, menos, xiangjia],
      values: [x, y, a, b, c],
      edges: [
        edge('e1', { node: x.id, port: `${x.id}:out` }, { node: add.id, port: add.inputs[0].id }),
        edge('e2', { node: y.id, port: `${y.id}:out` }, { node: add.id, port: add.inputs[1].id }),
        edge('e3', { node: x.id, port: `${x.id}:out` }, { node: menos.id, port: menos.inputs[0].id }),
        edge('e4', { node: y.id, port: `${y.id}:out` }, { node: menos.id, port: menos.inputs[1].id }),
        edge('e5', { node: add.id, port: add.outputs[0].id }, { node: a.id, port: `${a.id}:in` }),
        edge('e6', { node: menos.id, port: menos.outputs[0].id }, { node: b.id, port: `${b.id}:in` }),
        edge('e7', { node: a.id, port: `${a.id}:out` }, { node: xiangjia.id, port: xiangjia.inputs[0].id }),
        edge('e8', { node: b.id, port: `${b.id}:out` }, { node: xiangjia.id, port: xiangjia.inputs[1].id }),
        edge('e9', { node: xiangjia.id, port: xiangjia.outputs[0].id }, { node: c.id, port: `${c.id}:in` }),
      ],
      warnings: [],
    };

    layoutGraph(graph, { orientation: 'horizontal', width: 1400, height: 900 });
    expect(add.position.x).toBe(menos.position.x);
    expect(xiangjia.position.x).toBeGreaterThan(add.position.x);
    expect(a.position.x).toBeGreaterThan(add.position.x + NODE_WIDTH);
    expect(b.position.x).toBeGreaterThan(menos.position.x + NODE_WIDTH);
    expect(c.position.x).toBeGreaterThan(xiangjia.position.x + NODE_WIDTH);
  });
});

describe('python bridge', () => {
  it('parses the sample file into the expected data-flow chain', () => {
    const source = [
      'def add(a: float, b: float) -> float:',
      '    """加和 a、b 为 c"""',
      '    c = a + b',
      '    return c',
      '',
      'def normalize(x: float, scale: float) -> float:',
      '    """按 scale 缩放 x"""',
      '    return x / scale',
      '',
      'def main(x: float, y: float) -> float:',
      '    s = add(x, y)',
      '    n = normalize(s, 2.0)',
      '    return n',
    ].join('\n');
    const payload = JSON.stringify({ source, filename: 'sample.py', entry: 'main' });
    const output = execFileSync('python', [path.join(root, 'python/parse_flow.py')], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const parsed = JSON.parse(output) as ParseResult;
    expect(parsed.ok).toBe(true);
    expect(parsed.graph.nodes).toHaveLength(2);
    expect(parsed.graph.values.filter((v) => v.kind === 'input').map((v) => v.name)).toEqual(['x', 'y']);
    expect(parsed.graph.values.filter((v) => v.kind === 'output').map((v) => v.name)).toEqual(['n']);
    const graph = hydrateGraph(parsed.graph, parsed.methods);
    const add = graph.nodes.find((node) => node.name === 'add')!;
    const normalize = graph.nodes.find((node) => node.name === 'normalize')!;
    expect(add.inputs.map((port) => port.defaultValue)).toEqual(['x', 'y']);
    expect(normalize.inputs[1].defaultValue).toBe('2.0');
    expect(graph.values.filter((value) => value.kind === 'input').every((value) => value.hidden)).toBe(true);
    const result = generatePython(graph);
    expect(result.ok).toBe(true);
    expect(result.code).toContain('s = add(x, y)');
    expect(result.code).toContain('n = normalize(s, 2.0)');
    expect(result.code).toContain('return n');
  });

  it('parses notebook cells as a combined graph and as a single cell', () => {
    const cells = [
      { source: 'def scale(x, k=2):\n    return x * k\n' },
      { source: '%matplotlib inline\ny = scale(3)\nprint(y)\n' },
    ];
    const run = (cellIndex: number) => {
      const payload = JSON.stringify({ filename: 'demo.ipynb', cells, cellIndex });
      const output = execFileSync('python', [path.join(root, 'python/parse_flow.py')], {
        input: payload,
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      return JSON.parse(output) as ParseResult;
    };
    const all = run(-1);
    expect(all.ok).toBe(true);
    expect(all.graph.cells).toHaveLength(2);
    expect(all.graph.nodes.map((node) => node.cellIndex)).toContain(1);
    expect(all.methods.map((method) => method.name)).toContain('scale');
    const cell = run(1);
    expect(cell.ok).toBe(true);
    expect(cell.graph.name).toBe('Cell 2');
    expect(cell.graph.cellIndex).toBe(1);
    expect(cell.graph.nodes.every((node) => node.cellIndex === 1)).toBe(true);
  });
});

describe('block regions', () => {
  const parse = (source: string, entry: string): ParseResult => {
    const payload = JSON.stringify({ source, filename: 'blocks.py', entry });
    const output = execFileSync('python', [path.join(root, 'python/parse_flow.py')], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    return JSON.parse(output) as ParseResult;
  };

  const dispatch = [
    'def dispatch(expr):',
    '    if expr is None:',
    '        return []',
    '    if isinstance(expr, int):',
    '        out = str(expr)',
    '    elif isinstance(expr, str):',
    '        out = expr.strip()',
    '    elif isinstance(expr, (list, tuple)):',
    '        out = len(expr)',
    '    else:',
    '        out = repr(expr)',
    '    return out',
  ].join('\n');

  it('partitions every node into exactly one block', () => {
    const parsed = parse(dispatch, 'dispatch');
    expect(parsed.ok).toBe(true);
    const regions = parsed.graph.regions ?? [];
    expect(regions.length).toBeGreaterThan(1);
    const seen = new Set<string>();
    for (const region of regions) {
      for (const id of region.nodes) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(parsed.graph.nodes.length);
  });

  it('turns an if/elif chain into one named block per branch', () => {
    const parsed = parse(dispatch, 'dispatch');
    const labels = (parsed.graph.regions ?? []).map((region) => region.label);
    // isinstance(...) guards collapse to "<subject> 是 <Type>"
    expect(labels).toContain('expr 是 int');
    expect(labels).toContain('expr 是 str');
    expect(labels).toContain('expr 是 list/tuple');
    expect(labels).toContain('否则');
  });

  it('keeps small functions intact instead of merging them into one lump', () => {
    const source = [
      'def small(a, b):',
      '    if a > b:',
      '        return a - b',
      '    return a + b',
    ].join('\n');
    const parsed = parse(source, 'small');
    const regions = parsed.graph.regions ?? [];
    expect(regions).toHaveLength(2);
    expect(regions[0].kind).toBe('case');
    expect(regions[1].kind).toBe('linear');
  });

  it('never emits a zero-size block for a docstring', () => {
    const source = [
      'def load(path):',
      '    """读表：附件1 代表日 电价/负载/光伏。"""',
      '    df = read_excel(path)',
      '    return df',
    ].join('\n');
    const parsed = parse(source, 'load');
    expect(parsed.ok).toBe(true);
    const regions = parsed.graph.regions ?? [];
    expect(regions.length).toBeGreaterThan(0);
    // docstring 不产出图节点，若块视图不对齐 body 就会留下 "0 段" 空块
    expect(regions.filter((region) => region.size === 0)).toEqual([]);
    expect(regions[0].startLine).toBeGreaterThan(1);
  });

  it('survives hydrate and does not perturb code generation', () => {
    const parsed = parse(dispatch, 'dispatch');
    const before = generatePython(hydrateGraph(parsed.graph, parsed.methods));
    const graph = hydrateGraph(parsed.graph, parsed.methods);
    expect(graph.regions).toHaveLength(parsed.graph.regions!.length);
    const after = generatePython(graph);
    expect(after.code).toBe(before.code);
  });
});

describe('workspace import scanner', () => {
  it('resolves local import and from-import edges', () => {
    const files = [
      { relPath: 'main.py', source: 'import util\nfrom pkg.math import dot\n' },
      { relPath: 'util.py', source: 'from pkg.math import dot\n' },
      { relPath: 'pkg/math.py', source: 'def dot(a, b):\n    return a * b\n' },
    ];
    const payload = JSON.stringify({ root: '.', files });
    const output = execFileSync('python', [path.join(root, 'python/scan_imports.py')], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const graph = JSON.parse(output) as {
      nodes: unknown[];
      edges: { from: string; to: string; label: string }[];
    };
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'main.py', to: 'util.py', label: 'import util' }),
        expect.objectContaining({ from: 'main.py', to: 'pkg/math.py' }),
        expect.objectContaining({ from: 'util.py', to: 'pkg/math.py' }),
      ]),
    );
  });
});
