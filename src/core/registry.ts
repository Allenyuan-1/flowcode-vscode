import type { MethodSpec, ParamSpec, PortType, ReturnSpec } from './types';

function p(name: string, type: PortType = 'any', extra: Partial<ParamSpec> = {}): ParamSpec {
  return { name, type, ...extra };
}

function paramSignature(param: ParamSpec): string {
  return `${param.name}${param.defaultValue !== undefined ? `=${param.defaultValue}` : ''}`;
}

function r(name: string, type: PortType = 'any', annotation?: string): ReturnSpec {
  return { name, type, annotation };
}

function op(
  id: string,
  name: string,
  symbol: string,
  effect: string,
  params: [string, PortType][],
  returns: [string, PortType],
  category = '运算符',
): MethodSpec {
  return {
    id: `op.${id}`,
    name,
    kind: 'operator',
    op: symbol,
    category,
    signature: `${name}(${params.map((x) => x[0]).join(', ')}) → ${returns[0]}`,
    effect,
    params: params.map(([n, t]) => p(n, t)),
    returns: [r(returns[0], returns[1])],
    origin: 'builtin',
  };
}

function fn(
  id: string,
  name: string,
  category: string,
  effect: string,
  params: ParamSpec[],
  returns: ReturnSpec[],
  callee = name,
): MethodSpec {
  return {
    id: `fn.${id}`,
    name,
    qualifiedName: callee,
    kind: 'function',
    category,
    signature: `${name}(${params.map(paramSignature).join(', ')})${returns.length ? ` → ${returns.map((x) => x.name).join(', ')}` : ''}`,
    effect,
    params,
    returns,
    origin: 'builtin',
  };
}

function method(
  id: string,
  name: string,
  qualifiedName: string,
  category: string,
  effect: string,
  params: ParamSpec[],
  returns: ReturnSpec[],
): MethodSpec {
  return {
    id,
    name,
    qualifiedName,
    kind: 'method',
    category,
    signature: `.${name}(${params.map(paramSignature).join(', ')})${returns.length ? ` → ${returns.map((x) => x.name).join(', ')}` : ''}`,
    effect,
    params,
    returns,
    origin: 'builtin',
  };
}

const math: MethodSpec[] = [
  fn('sqrt', 'sqrt', '数学', '求 x 的平方根为 y', [p('x', 'number')], [r('y', 'number')], 'math.sqrt'),
  fn('pow', 'pow', '数学', '求 x 的 y 次方为 z', [p('x', 'number'), p('y', 'number')], [r('z', 'number')], 'math.pow'),
  fn('floor', 'floor', '数学', '向下取整 x 为 n', [p('x', 'number')], [r('n', 'int')], 'math.floor'),
  fn('ceil', 'ceil', '数学', '向上取整 x 为 n', [p('x', 'number')], [r('n', 'int')], 'math.ceil'),
  fn('log', 'log', '数学', '求 x 的自然对数为 y', [p('x', 'number'), p('base', 'number', { defaultValue: 'math.e' })], [r('y', 'number')], 'math.log'),
  fn('exp', 'exp', '数学', '求 e 的 x 次方为 y', [p('x', 'number')], [r('y', 'number')], 'math.exp'),
  fn('sin', 'sin', '数学', '求 x 的正弦值为 y', [p('x', 'number')], [r('y', 'number')], 'math.sin'),
  fn('cos', 'cos', '数学', '求 x 的余弦值为 y', [p('x', 'number')], [r('y', 'number')], 'math.cos'),
  fn('abs', 'abs', '数学', '取 x 的绝对值为 y', [p('x', 'number')], [r('y', 'number')], 'abs'),
  fn('round', 'round', '数学', '把 x 保留 ndigits 位小数为 y', [p('x', 'number'), p('ndigits', 'int', { defaultValue: '0' })], [r('y', 'number')], 'round'),
  fn('min', 'min', '数学', '取 a、b 中较小的值为 m', [p('a', 'number'), p('b', 'number')], [r('m', 'number')], 'min'),
  fn('max', 'max', '数学', '取 a、b 中较大的值为 m', [p('a', 'number'), p('b', 'number')], [r('m', 'number')], 'max'),
  fn('sum', 'sum', '数学', '把 values 中所有数相加为 total', [p('values', 'list')], [r('total', 'number')], 'sum'),
];

const scientific: MethodSpec[] = [
  fn('np-array', 'array', '数据 / AI', '把 data 转成 NumPy 数组 arr', [p('data', 'list')], [r('arr', 'list')], 'numpy.array'),
  fn('np-mean', 'mean', '数据 / AI', '求 a 的平均值为 m', [p('a', 'list')], [r('m', 'number')], 'numpy.mean'),
  fn('np-dot', 'dot', '数据 / AI', '求 a 与 b 的点积为 c', [p('a', 'list'), p('b', 'list')], [r('c', 'number')], 'numpy.dot'),
  fn('pd-dataframe', 'DataFrame', '数据 / AI', '把 data 转成表格 df', [p('data', 'dict')], [r('df', 'any')], 'pandas.DataFrame'),
  fn('torch-tensor', 'tensor', '数据 / AI', '把 data 转成张量 t', [p('data', 'list')], [r('t', 'any')], 'torch.tensor'),
];

const text: MethodSpec[] = [
  method('str.upper', 'upper', 'upper', '文本', '把 s 转成大写为 out', [p('s', 'string')], [r('out', 'string')]),
  method('str.lower', 'lower', 'lower', '文本', '把 s 转成小写为 out', [p('s', 'string')], [r('out', 'string')]),
  method('str.strip', 'strip', 'strip', '文本', '去掉 s 首尾空白为 out', [p('s', 'string')], [r('out', 'string')]),
  method('str.split', 'split', 'split', '文本', '按 sep 切分 s 为 parts', [p('s', 'string'), p('sep', 'string', { defaultValue: "None" })], [r('parts', 'list')]),
  method('str.replace', 'replace', 'replace', '文本', '把 s 中的 old 换成 new 为 out', [p('s', 'string'), p('old', 'string'), p('new', 'string')], [r('out', 'string')]),
  method('str.startswith', 'startswith', 'startswith', '文本', '判断 s 是否以 prefix 开头为 ok', [p('s', 'string'), p('prefix', 'string')], [r('ok', 'boolean')]),
  method('str.endswith', 'endswith', 'endswith', '文本', '判断 s 是否以 suffix 结尾为 ok', [p('s', 'string'), p('suffix', 'string')], [r('ok', 'boolean')]),
  method('str.join', 'join', 'join', '文本', '用 sep 连接 items 为 text', [p('sep', 'string'), p('items', 'list')], [r('text', 'string')]),
  fn('len', 'len', '文本', '求 s 的长度为 n', [p('s', 'any')], [r('n', 'int')], 'len'),
];

const lists: MethodSpec[] = [
  method('list.append', 'append', 'append', '列表', '向 items 末尾追加 item', [p('items', 'list'), p('item', 'any')], []),
  method('list.extend', 'extend', 'extend', '列表', '把 other 中的元素追加到 items', [p('items', 'list'), p('other', 'list')], []),
  method('list.pop', 'pop', 'pop', '列表', '从 items 弹出 index 处的元素为 item', [p('items', 'list'), p('index', 'int', { defaultValue: '-1' })], [r('item', 'any')]),
  method('list.sort', 'sort', 'sort', '列表', '把 items 原地升序排列', [p('items', 'list')], []),
  method('list.reverse', 'reverse', 'reverse', '列表', '把 items 原地反转', [p('items', 'list')], []),
  method('list.copy', 'copy', 'copy', '列表', '复制 items 为 out', [p('items', 'list')], [r('out', 'list')]),
  fn('sorted', 'sorted', '列表', '把 items 排序为 out', [p('items', 'list')], [r('out', 'list')], 'sorted'),
  fn('range', 'range', '列表', '生成 stop 以内的整数序列为 nums', [p('stop', 'int')], [r('nums', 'list')], 'range'),
  fn('enumerate', 'enumerate', '列表', '为 items 附加序号为 pairs', [p('items', 'list')], [r('pairs', 'list')], 'enumerate'),
  fn('list', 'list', '列表', '把 items 转为列表 out', [p('items', 'list')], [r('out', 'list')], 'list'),
];

const io: MethodSpec[] = [
  fn('print', 'print', '输入输出', '把 values 打印到控制台', [p('values', 'any', { description: '可传入多个值' })], [], 'print'),
  fn('input', 'input', '输入输出', '显示 prompt 并读取一行输入为 text', [p('prompt', 'string', { defaultValue: "''" })], [r('text', 'string')], 'input'),
  fn('json.dumps', 'dumps', '输入输出', '把 obj 序列化为 JSON 字符串 s', [p('obj', 'any')], [r('s', 'string')], 'json.dumps'),
  fn('json.loads', 'loads', '输入输出', '把字符串 s 解析为对象 obj', [p('s', 'string')], [r('obj', 'dict')], 'json.loads'),
  fn('open', 'open', '输入输出', '按 path 打开文件为 f', [p('path', 'string'), p('mode', 'string', { defaultValue: "'r'" })], [r('f', 'any')], 'open'),
];

const operators: MethodSpec[] = [
  op('add', 'add', '+', '加和 a、b 为 c', [['a', 'number'], ['b', 'number']], ['c', 'number']),
  op('sub', 'sub', '-', '从 a 减去 b 得 c', [['a', 'number'], ['b', 'number']], ['c', 'number']),
  op('mul', 'mul', '*', '把 a 与 b 相乘得 c', [['a', 'number'], ['b', 'number']], ['c', 'number']),
  op('truediv', 'div', '/', '用 a 除以 b 得 c', [['a', 'number'], ['b', 'number']], ['c', 'number']),
  op('floordiv', 'floordiv', '//', 'a 整除 b 得 c', [['a', 'number'], ['b', 'number']], ['c', 'number']),
  op('mod', 'mod', '%', '取 a 除以 b 的余数为 c', [['a', 'number'], ['b', 'number']], ['c', 'number']),
  op('pow', 'pow', '**', '求 a 的 b 次方为 c', [['a', 'number'], ['b', 'number']], ['c', 'number']),
  op('matmul', 'matmul', '@', '矩阵相乘 a、b 得 c', [['a', 'list'], ['b', 'list']], ['c', 'list']),
  op('eq', 'eq', '==', '判断 a 是否等于 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('ne', 'ne', '!=', '判断 a 是否不等于 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('lt', 'lt', '<', '判断 a 是否小于 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('le', 'le', '<=', '判断 a 是否小于等于 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('gt', 'gt', '>', '判断 a 是否大于 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('ge', 'ge', '>=', '判断 a 是否大于等于 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('and', 'and', 'and', '逻辑与：a 且 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('or', 'or', 'or', '逻辑或：a 或 b 为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('not', 'not', 'not', '逻辑非：对 a 取反为 c', [['a', 'any']], ['c', 'boolean']),
  op('neg', 'neg', '-', '取 a 的相反数为 c', [['a', 'number']], ['c', 'number']),
  op('pos', 'pos', '+', '取 a 本身为 c', [['a', 'number']], ['c', 'number']),
  op('invert', 'invert', '~', '按位取反 a 为 c', [['a', 'int']], ['c', 'int']),
  op('contains', 'in', 'in', '判断 a 是否在 b 中为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('not_in', 'not in', 'not in', '判断 a 是否不在 b 中为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('is', 'is', 'is', '判断 a 与 b 是否同一对象为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
  op('is_not', 'is not', 'is not', '判断 a 与 b 是否非同一对象为 c', [['a', 'any'], ['b', 'any']], ['c', 'boolean']),
];

export const BUILTIN_METHODS: MethodSpec[] = [...operators, ...math, ...scientific, ...text, ...lists, ...io];

export const METHOD_BY_ID = new Map<string, MethodSpec>(BUILTIN_METHODS.map((m) => [m.id, m]));

export const CATEGORY_ORDER = ['当前文件', '运算符', '数学', '数据 / AI', '文本', '列表', '输入输出'];

export const CATEGORY_COLOR: Record<string, string> = {
  当前文件: 'var(--fc-cat-user)',
  运算符: 'var(--fc-cat-op)',
  数学: 'var(--fc-cat-math)',
  '数据 / AI': 'var(--fc-cat-ai)',
  文本: 'var(--fc-cat-text)',
  列表: 'var(--fc-cat-list)',
  输入输出: 'var(--fc-cat-io)',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? 'var(--fc-cat-op)';
}

/** Resolve an operator token to its builtin spec. */
export function operatorSpec(op: string): MethodSpec | undefined {
  return BUILTIN_METHODS.find((m) => m.kind === 'operator' && m.op === op);
}

/**
 * Resolve a call. `callee` may be `sqrt`, `math.sqrt`, `np.mean`, `s.upper`.
 * Prefer an exact qualified match, then an exact user method, then a unique
 * builtin suffix match.
 */
export function resolveCall(callee: string, userMethods: MethodSpec[] = []): MethodSpec | undefined {
  const exactUser = userMethods.find((m) => m.name === callee || m.qualifiedName === callee);
  if (exactUser) return exactUser;
  const exactBuiltin = BUILTIN_METHODS.find((m) => m.id === callee || m.qualifiedName === callee);
  if (exactBuiltin) return exactBuiltin;
  const last = callee.split('.').pop() ?? callee;
  const user = userMethods.find((m) => m.name === last);
  if (user) return user;
  const builtins = BUILTIN_METHODS.filter((m) => m.name === last);
  if (builtins.length === 1) return builtins[0];
  const qualified = BUILTIN_METHODS.filter((m) => m.qualifiedName === callee);
  if (qualified.length === 1) return qualified[0];
  return builtins[0];
}

export function makeUserSpec(input: {
  name: string;
  qualifiedName?: string;
  params: ParamSpec[];
  returns: ReturnSpec[];
  effect: string;
  doc?: string;
  sourceRange?: MethodSpec['sourceRange'];
}): MethodSpec {
  return {
    id: `user.${input.qualifiedName ?? input.name}`,
    name: input.name,
    qualifiedName: input.qualifiedName ?? input.name,
    kind: 'function',
    category: '当前文件',
    signature: `${input.name}(${input.params.map(paramSignature).join(', ')})${input.returns.length ? ` → ${input.returns.map((r) => r.name).join(', ')}` : ''}`,
    effect: input.effect,
    params: input.params,
    returns: input.returns,
    origin: 'user',
    doc: input.doc,
    sourceRange: input.sourceRange,
  };
}
