export type PortType =
  | 'number'
  | 'int'
  | 'string'
  | 'boolean'
  | 'list'
  | 'dict'
  | 'any'
  | 'none';

export interface Point {
  x: number;
  y: number;
}

export interface SourceRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface ParamSpec {
  name: string;
  type: PortType;
  annotation?: string;
  defaultValue?: string;
  description?: string;
  keywordOnly?: boolean;
}

export interface ReturnSpec {
  name: string;
  type: PortType;
  annotation?: string;
}

export interface MethodSpec {
  id: string;
  name: string;
  qualifiedName?: string;
  kind: 'operator' | 'function' | 'method';
  op?: string;
  callee?: string;
  category: string;
  signature: string;
  effect: string;
  params: ParamSpec[];
  returns: ReturnSpec[];
  origin: 'builtin' | 'user';
  doc?: string;
  sourceRange?: SourceRange;
  color?: string;
}

export interface Port {
  id: string;
  name: string;
  type: PortType;
  annotation?: string;
  keyword?: boolean;
  optional?: boolean;
  defaultValue?: string;
  description?: string;
}

export interface MethodNode {
  id: string;
  key: string;
  methodId: string;
  name: string;
  qualifiedName?: string;
  kind: 'operator' | 'function' | 'method';
  op?: string;
  callee?: string;
  effect: string;
  category: string;
  origin: 'builtin' | 'user';
  inputs: Port[];
  outputs: Port[];
  position: Point;
  sourceRange?: SourceRange;
  order?: number;
  note?: string;
  cellIndex?: number;
}

export type ValueKind = 'input' | 'literal' | 'global' | 'output';

export interface ValueNode {
  id: string;
  key: string;
  kind: ValueKind;
  name: string;
  type: PortType;
  annotation?: string;
  value?: string;
  position: Point;
  sourceRange?: SourceRange;
  order?: number;
  /** True for parameter pills created automatically when a method is dropped. */
  auto?: boolean;
  /** Folded into a method port as a default; kept for signature inputs, not drawn. */
  hidden?: boolean;
  cellIndex?: number;
}

export interface Endpoint {
  node: string;
  port: string;
}

export interface FlowEdge {
  id: string;
  from: Endpoint;
  to: Endpoint;
}

export type WarningCode =
  | 'control-flow'
  | 'unsupported'
  | 'unconnected'
  | 'cycle'
  | 'parse'
  | 'type';

export interface FlowWarning {
  code: WarningCode;
  message: string;
  line?: number;
  nodeId?: string;
}

export interface CellInfo {
  index: number;
  label: string;
  startLine: number;
  endLine: number;
}

export interface FlowGraph {
  version: 1;
  id: string;
  name: string;
  doc?: string;
  language: 'python';
  entryKind: 'function' | 'module';
  params: ParamSpec[];
  returns: ReturnSpec[];
  returnType?: string;
  nodes: MethodNode[];
  values: ValueNode[];
  edges: FlowEdge[];
  warnings: FlowWarning[];
  sourceRange?: SourceRange;
  fileName?: string;
  /** Notebook metadata when the graph came from .ipynb cells. */
  cells?: CellInfo[];
  cellIndex?: number;
  sourceKind?: 'text' | 'notebook';
}

export interface FileNode {
  id: string;
  path: string;
  relPath: string;
  name: string;
  dir: string;
  functions: string[];
  classes: string[];
  position: Point;
}

export interface FileEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: 'import' | 'from';
}

export interface FileGraph {
  root: string;
  nodes: FileNode[];
  edges: FileEdge[];
  externals: { name: string; from: string }[];
  warnings: string[];
}

export interface ParseResult {
  ok: boolean;
  graph: FlowGraph;
  methods: MethodSpec[];
  pythonVersion?: string;
  error?: { message: string; line?: number; column?: number };
}

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
  rowHeight: number;
}

export function portColor(type: PortType | string): string {
  switch (type) {
    case 'number':
    case 'int':
    case 'float':
      return 'var(--fc-type-number)';
    case 'string':
      return 'var(--fc-type-string)';
    case 'boolean':
      return 'var(--fc-type-bool)';
    case 'list':
      return 'var(--fc-type-list)';
    case 'dict':
      return 'var(--fc-type-dict)';
    default:
      return 'var(--fc-type-any)';
  }
}

export function typeLabel(type: PortType, annotation?: string): string {
  if (annotation) return annotation;
  switch (type) {
    case 'number':
      return 'number';
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
      return 'any';
  }
}
