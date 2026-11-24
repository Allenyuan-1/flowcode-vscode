import { isIdentifier } from './graph';
import { typeLabel } from './types';
import { findNode, isValueNode, portPosition } from './graph';
import type { Endpoint, FlowGraph, FlowWarning, MethodNode, Port, ValueNode } from './types';

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

const BUILTIN_NAMES = new Set([
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float', 'int', 'len', 'list', 'max', 'min',
  'open', 'print', 'range', 'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'zip',
]);

export interface GenerateResult {
  ok: boolean;
  code: string;
  warnings: FlowWarning[];
  imports: string[];
  error?: string;
}

export interface GenerateOptions {
  indent?: string;
  includeImports?: boolean;
}

function pythonAnnotation(type: string): string | undefined {
  switch (type) {
    case 'number':
      return 'float';
    case 'int':
      return 'int';
    case 'string':
      return 'str';
    case 'boolean':
      return 'bool';
    case 'list':
      return 'list';
    case 'dict':
      return 'dict';
    case 'none':
      return 'None';
    default:
      return undefined;
  }
}

function quoteDoc(doc: string): string {
  const clean = doc.replace(/"""/g, "'''").trim();
  if (!clean.includes('\n')) return `"""${clean}"""`;
  return `"""${clean}"""`;
}

function topological(graph: FlowGraph): { order: MethodNode[]; error?: string } {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const indegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, new Set());
  }
  for (const e of graph.edges) {
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) continue;
    if (!adj.get(e.from.node)!.has(e.to.node)) {
      adj.get(e.from.node)!.add(e.to.node);
      indegree.set(e.to.node, (indegree.get(e.to.node) ?? 0) + 1);
    }
  }
  const rank = (n: MethodNode) => n.order ?? n.position.y * 1000 + n.position.x;
  const ready = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).sort((a, b) => rank(a) - rank(b));
  const order: MethodNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    order.push(node);
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
  if (order.length !== graph.nodes.length) {
    const stuck = graph.nodes.filter((n) => !order.includes(n));
    return { order, error: `流程图存在环：${stuck.map((n) => n.name).join('、')}` };
  }
  return { order };
}

function varNameFor(name: string, used: Set<string>, fallback: string): string {
  const base = isIdentifier(name) && !KEYWORDS.has(name) ? name : fallback;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  const result = `${base}_${i}`;
  used.add(result);
  return result;
}

export function generatePython(graph: FlowGraph, options: GenerateOptions = {}): GenerateResult {
  const indent = options.indent ?? '    ';
  const warnings: FlowWarning[] = [];
  const imports = new Set<string>();
  if (graph.entryKind === 'module' && graph.nodes.length === 0) {
    return { ok: false, code: '', warnings, imports: [], error: '画布为空，没有可生成的模块代码。' };
  }
  const { order, error } = topological(graph);
  if (error) return { ok: false, code: '', warnings, imports: [], error };

  const inputs = graph.values.filter((v) => v.kind === 'input');
  const inputNames = new Map(inputs.map((v) => [v.id, v.name]));
  const used = new Set<string>([...inputNames.values()]);
  for (const n of graph.nodes) {
    used.add(n.name);
  }

  // Assign a Python variable to every method output that is consumed or named.
  const outputVar = new Map<string, string>();
  const generatedNames = new Set<string>();
  for (const node of order) {
    node.outputs.forEach((port, idx) => {
      const key = `${node.id}:${port.id}`;
      const consumed = graph.edges.some((e) => e.from.node === node.id && e.from.port === port.id);
      const named = isIdentifier(port.name) && !['result', 'value', 'out'].includes(port.name);
      if (!consumed && !named) {
        generatedNames.add(key);
        return;
      }
      const fallback = `_t${order.indexOf(node) + 1}_${idx + 1}`;
      outputVar.set(key, varNameFor(port.name, used, fallback));
    });
  }

  const consts: string[] = [];
  const constNames = new Set<string>();
  const literalExpr = (v: ValueNode): string => {
    if (v.value === undefined) return isIdentifier(v.name) ? v.name : 'None';
    const root = v.value.match(/^([A-Za-z_]\w*)\s*\./)?.[1];
    if (root) {
      if (['math', 'random', 'json', 'os', 'sys', 'time'].includes(root)) imports.add(root);
      if (['np', 'numpy'].includes(root)) imports.add('numpy as np');
      if (['pd', 'pandas'].includes(root)) imports.add('pandas as pd');
      if (root === 'torch') imports.add('torch');
    }
    if (isIdentifier(v.name) && v.name !== v.value && !KEYWORDS.has(v.name)) {
      if (!constNames.has(v.name)) {
        constNames.add(v.name);
        consts.push(`${v.name} = ${v.value}`);
      }
      return v.name;
    }
    return v.value;
  };

  const expressionFor = (endpoint: Endpoint | undefined, targetNode: MethodNode, port: Port): string => {
    if (!endpoint) {
      if (port.defaultValue !== undefined) return port.defaultValue;
      warnings.push({
        code: 'unconnected',
        message: `${targetNode.name}.${port.name} 没有输入，生成 None`,
        nodeId: targetNode.id,
      });
      return 'None';
    }
    const source = findNode(graph, endpoint.node);
    if (!source) return 'None';
    if (isValueNode(source)) {
      if (source.kind === 'literal') return literalExpr(source);
      if (source.kind === 'output') return 'None';
      return isIdentifier(source.name) ? source.name : literalExpr(source);
    }
    const key = `${source.id}:${endpoint.port}`;
    const name = outputVar.get(key);
    if (name) return name;
    if (isIdentifier(port.name)) {
      const fallback = `_t${source.name}_${port.name}`;
      const generated = varNameFor(fallback, used, fallback);
      outputVar.set(key, generated);
      return generated;
    }
    return 'None';
  };

  const statements: string[] = [];
  for (const node of order) {
    const args = node.inputs.map((port) => {
      const edge = graph.edges.find((e) => e.to.node === node.id && e.to.port === port.id);
      const expr = expressionFor(edge?.from, node, port);
      return port.keyword ? `${port.name}=${expr}` : expr;
    });

    let expr: string;
    if (node.kind === 'operator' && node.op) {
      if (node.op === 'not') expr = `(not ${args[0] ?? 'None'})`;
      else if (node.op === 'neg') expr = `(-${args[0] ?? 'None'})`;
      else if (node.op === 'pos') expr = `(+${args[0] ?? 'None'})`;
      else if (node.op === 'invert') expr = `(~${args[0] ?? 'None'})`;
      else if (node.op === '[]') expr = `(${args[0] ?? 'None'}[${args[1] ?? 'None'}])`;
      else if (node.op === ',') expr = `(${args.join(', ')})`;
      else if (node.op === 'list') expr = `[${args.join(', ')}]`;
      else if (node.op === 'ifelse') expr = `(${args[1] ?? 'None'} if ${args[0] ?? 'None'} else ${args[2] ?? 'None'})`;
      else expr = `(${args[0] ?? 'None'} ${node.op} ${args[1] ?? 'None'})`;
    } else if (node.kind === 'method') {
      const receiver = args[0] ?? 'None';
      const rest = args.slice(1).join(', ');
      expr = `${receiver}.${node.name}(${rest})`;
    } else {
      const callee = node.callee ?? node.qualifiedName ?? node.name;
      if (callee.includes('.')) {
        const root = callee.split('.')[0];
        if (['math', 'random', 'json', 'os', 'sys', 'time'].includes(root)) imports.add(root);
        if (['np', 'numpy'].includes(root)) imports.add('numpy as np');
        if (['pd', 'pandas'].includes(root)) imports.add('pandas as pd');
        if (root === 'torch') imports.add('torch');
      }
      expr = `${callee}(${args.join(', ')})`;
    }

    const assignable = node.outputs
      .map((port, idx) => ({ key: `${node.id}:${port.id}`, idx, name: outputVar.get(`${node.id}:${port.id}`), port }))
      .filter((o) => o.name) as { key: string; idx: number; name: string; port: (typeof node.outputs)[number] }[];
    const hasDownstream = node.outputs.some((port, idx) => graph.edges.some((e) => e.from.node === node.id && e.from.port === port.id));
    if (assignable.length > 1) {
      statements.push(`${assignable.map((o) => o.name).join(', ')} = ${expr}`);
    } else if (assignable.length === 1) {
      statements.push(`${assignable[0].name} = ${expr}`);
    } else if (hasDownstream) {
      const temp = `_t${statements.length + 1}`;
      used.add(temp);
      statements.push(`${temp} = ${expr}`);
      const port = node.outputs[0];
      if (port) outputVar.set(`${node.id}:${port.id}`, temp);
    } else {
      statements.push(expr);
    }
  }

  const outputValues = graph.values.filter((v) => v.kind === 'output');
  const returnExprs: string[] = [];
  for (const output of outputValues) {
    const edge = graph.edges.find((e) => e.to.node === output.id);
    if (!edge) {
      warnings.push({ code: 'unconnected', message: `流程输出 “${output.name}” 没有接入`, nodeId: output.id });
      continue;
    }
    const source = findNode(graph, edge.from.node);
    if (!source) continue;
    if (isValueNode(source)) {
      returnExprs.push(source.kind === 'literal' ? literalExpr(source) : source.name);
    } else {
      const name = outputVar.get(`${source.id}:${edge.from.port}`);
      returnExprs.push(name ?? 'None');
    }
  }

  const lines: string[] = [];
  if (options.includeImports && imports.size) {
    for (const imp of imports) lines.push(imp.startsWith('numpy') || imp.startsWith('pandas') ? `import ${imp}` : `import ${imp}`);
    lines.push('');
  }

  const doc = graph.doc?.trim();
  const isFunction = graph.entryKind === 'function';
  const body: string[] = [];
  if (consts.length) body.push(...consts);
  if (consts.length && statements.length) body.push('');
  body.push(...statements);

  if (isFunction) {
    const params = graph.params
      .map((p) => {
        let text = p.name;
        if (p.annotation) text += `: ${p.annotation}`;
        if (p.defaultValue !== undefined) text += ` = ${p.defaultValue}`;
        return text;
      })
      .join(', ');
    const returnAnnotation = graph.returns.length === 1 ? graph.returnType : undefined;
    lines.push(`def ${graph.name}(${params})${returnAnnotation ? ` -> ${returnAnnotation}` : ''}:`);
    if (doc) lines.push(`${indent}${quoteDoc(doc)}`);
    if (!body.length) body.push('pass');
    for (const line of body) lines.push(`${indent}${line}`);
    if (returnExprs.length === 1) lines.push(`${indent}return ${returnExprs[0]}`);
    else if (returnExprs.length > 1) lines.push(`${indent}return ${returnExprs.join(', ')}`);
  } else {
    lines.push(...body);
  }

  return {
    ok: true,
    code: `${lines.join('\n')}\n`,
    warnings,
    imports: [...imports],
  };
}

export function previewSignature(graph: FlowGraph): string {
  const params = graph.params.map((p) => `${p.name}: ${typeLabel(p.type, p.annotation)}`).join(', ');
  const returns = graph.returns.map((r) => typeLabel(r.type, r.annotation)).join(', ');
  return `${graph.name}(${params})${returns ? ` → ${returns}` : ''}`;
}
