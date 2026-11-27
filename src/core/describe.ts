import type { FlowGraph, MethodNode, Segment, SegmentNote } from './types';

function membersOf(graph: FlowGraph, segment: Segment): MethodNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return segment.members.map((id) => byId.get(id)).filter((node): node is MethodNode => Boolean(node));
}

const ALGO_BY_NAME: [string[], string][] = [
  [['read_excel', 'read_csv', 'read_json', 'read_sql', 'read_table', 'loadtxt', 'imread', 'urlopen', 'open'], '文件读取'],
  [['to_csv', 'to_excel', 'to_json', 'to_pickle', 'savefig', 'imwrite', 'print'], '结果写出'],
  [['astype', 'to_datetime', 'to_numeric', 'to_numpy', 'values', 'array', 'reshape', 'transpose'], '类型与形状转换'],
  [['set_index', 'reset_index', 'reindex', 'rename', 'rename_axis', 'sort_index', 'sort_values', 'ffill', 'bfill', 'dropna', 'fillna'], '索引整理与缺失值处理'],
  [['merge', 'join', 'concat', 'pivot', 'pivot_table', 'melt', 'groupby', 'resample', 'drop', 'drop_duplicates', 'apply', 'map'], '表格形状重构'],
  [['min', 'max', 'mean', 'sum', 'nunique', 'median', 'std', 'var', 'quantile', 'count'], '统计聚合'],
  [['get_level_values', 'index', 'tolist', 'list', 'tuple', 'append'], '序列与容器整理'],
];

const UTIL_MODULES = ['os', 'sys', 'math', 'json', 'time', 'datetime', 're', 'itertools'];

const APPLICABLE: Record<string, string> = {
  lib: '环境配置与路径解析',
  read: '外部数据文件的统一加载',
  morph: '统一数据类型与数值格式',
  index: '表格数据的规范化整理',
  shape: '数据表结构重组',
  write: '结果输出与持久化',
  calc: '数值与序列的加工计算',
};

const LIMITATION: Record<string, string> = {
  lib: '依赖的环境变量或路径缺失时不可用，会出现 KeyError / FileNotFoundError',
  read: '文件缺失或格式不符时不可用，会出现 IO 异常',
  morph: '值无法解析为目标类型时不可用，会出现 ValueError',
  index: '列名/索引不存在时不可用，会出现 KeyError',
  shape: '键不匹配或形状不一致时不可用，会出现空表或数据丢失',
  write: '目标路径不可写或数据为空时不可用，会出现写入失败',
  calc: '输入缺失或类型不符时不可用，会出现异常或空结果',
};

function algorithmOf(graph: FlowGraph, segment: Segment): string {
  const members = membersOf(graph, segment);
  const names = new Set(members.map((node) => node.name));
  const callees = members.map((node) => node.callee ?? '');
  const anyModule = (module: string) =>
    callees.some((callee) => callee.startsWith(`${module}.`) || callee === module);

  if (segment.kind === 'lib') {
    const modules = callees.map((callee) => callee.split('.')[0]).filter(Boolean);
    const dominant = modules.sort((a, b) =>
      modules.filter((m) => m === b).length - modules.filter((m) => m === a).length)[0];
    return dominant ? `${dominant} 标准库调用` : '标准库调用';
  }
  const comparisons = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'or', 'and', 'not', 'ifelse'];
  if (members.some((node) => comparisons.includes(node.name))) return '条件判断';
  const isOperator = members.every((node) => node.kind === 'operator');
  if (isOperator) return '算术运算';
  if (members.some((node) => /^(load|read|fetch)/.test(node.name))) return '文件读取';
  for (const [list, phrase] of ALGO_BY_NAME) {
    if (members.some((node) => list.includes(node.name))) return phrase;
  }
  if (members.some((node) => UTIL_MODULES.some((module) => (node.callee ?? '').startsWith(`${module}.`)))) {
    return '标准库调用';
  }
  void anyModule;
  const first = members[0];
  return first ? (first.name === first.callee ? `调用 ${first.name}` : first.name) : '计算';
}

/** 块内是否出现某类成员（用于推导限制条件）。 */
function hasName(graph: FlowGraph, segment: Segment, names: string[]): boolean {
  return membersOf(graph, segment).some((node) => names.includes(node.name));
}

/**
 * 从代码本身推导块的语义描述（无需 AI）：
 * 将 {输入} 通过 {算法} 转化为 {输出}，适用于 {场景}；{限制}。
 */
export function describeSegment(graph: FlowGraph, segment: Segment): SegmentNote {
  const inputs = (segment.inputs ?? []).map((port) => port.name);
  const outputs = (segment.outputs ?? []).map((port) => port.name);
  const algorithm = algorithmOf(graph, segment);
  const applicable = APPLICABLE[segment.kind] ?? APPLICABLE.calc;

  let limitation = LIMITATION[segment.kind] ?? LIMITATION.calc;
  if (segment.kind === 'calc' && hasName(graph, segment, ['div', 'floordiv', 'mod', 'truediv'])) {
    limitation = '除数为零时不可用，会出现 ZeroDivisionError';
  } else if (segment.kind === 'calc' && hasName(graph, segment, ['index'])) {
    limitation = '索引越界时不可用，会出现 IndexError';
  } else if (segment.kind === 'read' && hasName(graph, segment, ['urlopen', 'read_sql'])) {
    limitation = '网络不可达或数据库凭据无效时不可用，会出现连接异常';
  }

  const inText = inputs.length ? inputs.join('、') : '外部输入';
  const outText = outputs.length ? outputs.join('、') : '输出结果';
  const brief = outputs.length
    ? `${outText} ← ${inText} · ${algorithm}`
    : `${algorithm} · 输入：${inText}`;
  const full = `将 ${inText} 通过 ${algorithm} 转化为 ${outText}，适用于${applicable}；${limitation}。`;
  return { brief, full };
}
