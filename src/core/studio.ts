import type { PortType } from './types';

export const STUDIO_TYPES: PortType[] = ['number', 'int', 'string', 'boolean', 'list', 'dict', 'any', 'none'];

export interface StudioInput {
  name: string;
  type: PortType;
  defaultValue?: string;
}

export interface StudioOutput {
  name: string;
  type: PortType;
}

export interface StudioDraft {
  name: string;
  effect: string;
  description: string;
  code: string;
  inputs: StudioInput[];
  outputs: StudioOutput[];
}

export interface StudioGeneration {
  draft: StudioDraft;
  source: 'ai' | 'local';
  error?: string;
}

const PY_TYPES: Record<PortType, string> = {
  number: 'float',
  int: 'int',
  string: 'str',
  boolean: 'bool',
  list: 'list',
  dict: 'dict',
  any: 'object',
  none: 'None',
};

export function studioTypeFromText(text: string | undefined): PortType {
  const value = (text ?? '').trim().toLowerCase();
  if (!value) return 'any';
  if (['float', 'number', 'double', 'int', 'integer', 'str', 'string', 'bool', 'boolean', 'list', 'dict', 'none', 'null'].includes(value)) {
    if (value === 'float' || value === 'double') return 'number';
    if (value === 'integer') return 'int';
    if (value === 'str') return 'string';
    if (value === 'bool') return 'boolean';
    if (value === 'null') return 'none';
    return value as PortType;
  }
  return 'any';
}

export function pythonType(type: PortType): string {
  return PY_TYPES[type] ?? 'object';
}

function safeIdentifier(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\p{L}\p{N}_]/gu, '_')
    .replace(/^(\d)/, '_$1');
  return cleaned || fallback;
}

function splitParams(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if ('([{'.includes(char)) depth += 1;
    if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function parseSignatureFromCode(code: string): {
  name: string;
  inputs: StudioInput[];
  outputs: StudioOutput[];
} | null {
  const match = code.match(/def\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*(?:->\s*([^:]+))?:/);
  if (!match) return null;
  const inputs: StudioInput[] = [];
  for (const raw of splitParams(match[2])) {
    const part = raw.trim();
    if (!part || part === 'self' || part === 'cls') continue;
    const [beforeDefault, ...defaultParts] = part.split('=');
    const defaultValue = defaultParts.length ? defaultParts.join('=').trim() : undefined;
    const [rawName, rawType] = beforeDefault.split(':');
    const name = safeIdentifier(rawName ?? '', `arg${inputs.length + 1}`);
    inputs.push({ name, type: studioTypeFromText(rawType), defaultValue });
  }
  const returnType = match[3]?.trim();
  const returnMatch = code.match(/return\s+([A-Za-z_]\w*)\s*(?:#.*)?$/m);
  const outputs: StudioOutput[] = [{
    name: returnMatch?.[1] ?? 'result',
    type: studioTypeFromText(returnType),
  }];
  return { name: safeIdentifier(match[1], 'new_method'), inputs, outputs };
}

function signatureLine(name: string, inputs: StudioInput[], outputs: StudioOutput[]): string {
  const params = inputs
    .map((input) => {
      const base = `${input.name}: ${pythonType(input.type)}`;
      return input.defaultValue !== undefined && input.defaultValue.trim()
        ? `${base} = ${input.defaultValue.trim()}`
        : base;
    })
    .join(', ');
  return `def ${name}(${params}) -> ${pythonType(outputs[0]?.type ?? 'any')}:`;
}

export function syncSignatureInCode(
  code: string,
  name: string,
  inputs: StudioInput[],
  outputs: StudioOutput[],
): string {
  const signature = signatureLine(name, inputs, outputs);
  if (/def\s+[A-Za-z_]\w*\s*\([\s\S]*?\)\s*(?:->\s*[^:]+)?:/.test(code)) {
    return code.replace(/def\s+[A-Za-z_]\w*\s*\([\s\S]*?\)\s*(?:->\s*[^:]+)?:/, signature);
  }
  return `${signature}\n    """${outputs.length ? '返回结果' : '方法实现'}"""\n    pass`;
}

function templateCode(name: string, inputs: StudioInput[], outputs: StudioOutput[], effect: string): string {
  const params = inputs.map((input) => `${input.name}: ${pythonType(input.type)}`).join(', ');
  const output = outputs[0]?.name ?? 'result';
  const lines = [
    `def ${name}(${params}) -> ${pythonType(outputs[0]?.type ?? 'any')}:`,
    `    """${effect.replace(/"""/g, "'''")}"""`,
  ];
  if (inputs.length >= 2) {
    lines.push(`    ${output} = ${inputs[0].name} + ${inputs[1].name}`);
  } else if (inputs.length === 1) {
    lines.push(`    ${output} = ${inputs[0].name}`);
  } else {
    lines.push(`    ${output} = None`);
  }
  lines.push(`    return ${output}`);
  return lines.join('\n');
}

export function normalizeStudioDraft(raw: Partial<StudioDraft>, requirements: string, fallbackCode?: string): StudioDraft {
  const parsedFromCode = fallbackCode ? parseSignatureFromCode(fallbackCode) : null;
  const parsedFromRaw = raw.code ? parseSignatureFromCode(raw.code) : null;
  const name = safeIdentifier(String(raw.name ?? parsedFromRaw?.name ?? parsedFromCode?.name ?? 'new_method'), 'new_method');
  const effect = String(raw.effect ?? raw.description ?? requirements.split(/\r?\n/).find((line) => line.trim()) ?? '由方法工作室创建').trim();
  const inputs = (Array.isArray(raw.inputs) ? raw.inputs : parsedFromRaw?.inputs ?? parsedFromCode?.inputs ?? [
    { name: 'a', type: 'number' as PortType },
    { name: 'b', type: 'number' as PortType },
  ]).map((input, index) => ({
    name: safeIdentifier(String(input.name ?? `arg${index + 1}`), `arg${index + 1}`),
    type: STUDIO_TYPES.includes(input.type as PortType) ? input.type as PortType : studioTypeFromText(input.type),
    defaultValue: input.defaultValue === undefined || input.defaultValue === null ? undefined : String(input.defaultValue),
  }));
  const outputs = (Array.isArray(raw.outputs) ? raw.outputs : parsedFromRaw?.outputs ?? parsedFromCode?.outputs ?? [
    { name: 'result', type: 'number' as PortType },
  ]).map((output, index) => ({
    name: safeIdentifier(String(output.name ?? `result${index + 1}`), `result${index + 1}`),
    type: STUDIO_TYPES.includes(output.type as PortType) ? output.type as PortType : studioTypeFromText(output.type),
  }));
  const code = String(raw.code ?? fallbackCode ?? templateCode(name, inputs, outputs, effect));
  return {
    name,
    effect,
    description: String(raw.description ?? effect),
    code: syncSignatureInCode(code, name, inputs, outputs),
    inputs,
    outputs: outputs.length ? outputs : [{ name: 'result', type: 'any' }],
  };
}

export function localStudioDraft(requirements: string, code?: string): StudioDraft {
  const fenced = requirements.match(/```(?:python)?\s*([\s\S]*?)```/i)?.[1];
  const source = code?.trim() || fenced?.trim();
  const parsed = source ? parseSignatureFromCode(source) : null;
  const name = parsed?.name ?? (requirements.match(/\b([a-z_][a-z0-9_]{2,})\s*\(/i)?.[1] ?? 'new_method');
  const effect = requirements
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('```')) ?? '由方法工作室创建';
  const inputs = parsed?.inputs ?? [
    { name: 'a', type: 'number' as PortType },
    { name: 'b', type: 'number' as PortType },
  ];
  const outputs = parsed?.outputs ?? [{ name: 'c', type: 'number' as PortType }];
  return {
    name: safeIdentifier(name, 'new_method'),
    effect,
    description: effect,
    code: source && parsed ? syncSignatureInCode(source, name, inputs, outputs) : templateCode(name, inputs, outputs, effect),
    inputs,
    outputs,
  };
}
