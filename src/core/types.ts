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
  /** 合并视图块节点的执行阶段编号（1 起）。 */
  stage?: number;
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
  /** 边上的变量名（合并视图的块间边会标注流转的数据）。 */
  label?: string;
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

/**
 * A structural block of the entry function, produced by the Python bridge.
 *
 * Blocks are a *view* concept: they never take part in code generation.
 * `parse_flow.py` derives them from the AST (one block per if/elif case,
 * one per loop/try/with, and def-use clusters for linear runs), so they
 * stay meaningful even though the data-flow graph itself is flat.
 */
export interface BlockRegion {
  id: string;
  /** 'case' | 'linear' | 'misc' | 'for' | 'while' | 'try' | 'with' | 'match' */
  kind: string;
  /** Rule-based name, e.g. "expr 是 BinOp" or "计算 gross、tax". */
  label: string;
  /** Human name from .flowcode/names.json when available (LLM-generated). */
  name?: string;
  /** Full source text of the guard, for 'case' blocks. */
  condition?: string;
  startLine: number;
  endLine: number;
  /** Number of data-flow nodes in this block. */
  size: number;
  /** Content fingerprint, used as the lookup key for cached names. */
  hash?: string;
  nodes: string[];
  values: string[];
  /** Variables flowing into this block from other blocks. */
  inputs: string[];
  /** Variables leaving this block. */
  outputs: string[];
  /** Ids of blocks this one feeds. */
  edgesOut: string[];
}

export interface PortSpec {
  name: string;
  type: string;
}

/** A semantic merge block: one or more method nodes folded into a single card. */
export interface Segment {
  id: string;
  /** 'init' | 'io' | 'morph' | 'index' | 'shape' | 'calc' */
  kind: string;
  label: string;
  /** Ids of the method nodes folded into this block. */
  members: string[];
  names: string[];
  startLine: number;
  endLine: number;
  size: number;
  inputs: PortSpec[];
  outputs: PortSpec[];
}

/**
 * AI 解读的块语义注释：不是"简单计算"，而是
 * "将 xxx 通过 xxx 算法转化为 xxx，适用于 xxx，xxx 时不可用会出现 xxx 问题"。
 */
export interface SegmentNote {
  /** 块卡片上的一行摘要（≤ 24 字）。 */
  brief: string;
  /** 完整描述：转化 / 算法 / 适用 / 限制。 */
  full: string;
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
  /** Structural blocks for the block view; absent when unavailable. */
  regions?: BlockRegion[];
  /** Semantic merge blocks (B tier); absent when unavailable. */
  segments?: Segment[];
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
