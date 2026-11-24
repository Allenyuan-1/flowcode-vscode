import type { FlowGraph, MethodSpec, PortType } from '../../src/core/types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function methodGlyph(method: MethodSpec): string {
  if (method.kind === 'operator' && method.op) {
    if (['and', 'or', 'not', 'in', 'not in', 'is', 'is not'].includes(method.op)) return method.op.slice(0, 2).toUpperCase();
    return method.op;
  }
  if (method.name === 'print') return 'P';
  return method.name.slice(0, 1).toUpperCase();
}

export function kindLabel(method: MethodSpec): string {
  if (method.origin === 'user') return '本地';
  if (method.kind === 'operator') return '运算';
  if (method.kind === 'method') return '方法';
  return '内置';
}

export function uniqueName(graph: FlowGraph, base: string): string {
  const used = new Set<string>([
    ...graph.values.map((v) => v.name),
    ...graph.params.map((p) => p.name),
    ...graph.returns.map((r) => r.name),
  ]);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}${i}`)) i += 1;
  return `${base}${i}`;
}

export function typeShort(type: PortType): string {
  switch (type) {
    case 'number':
      return 'num';
    case 'boolean':
      return 'bool';
    case 'string':
      return 'str';
    default:
      return type;
  }
}

export function formatTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
