#!/usr/bin/env python3
"""FlowCode Python bridge.

Reads a JSON request on stdin, parses Python source with the standard ``ast``
module, and writes a FlowGraph JSON document on stdout.  The graph is a
data-flow view of one function (or a module): method blocks, input/literal
values, output values and the edges that connect them.

The script intentionally has no third-party dependencies so it can run with any
Python 3.9+ interpreter that VS Code can find.
"""

from __future__ import annotations

import ast
import hashlib
import json
import platform
import sys
from pathlib import Path

MODULE_ROOTS = {
    "math", "np", "numpy", "pd", "pandas", "torch", "json", "os", "sys",
    "random", "time", "datetime", "re", "collections", "itertools", "functools",
}

OPERATOR_NAMES = {
    ast.Add: "add", ast.Sub: "sub", ast.Mult: "mul", ast.Div: "div",
    ast.FloorDiv: "floordiv", ast.Mod: "mod", ast.Pow: "pow", ast.MatMult: "matmul",
    ast.LShift: "lshift", ast.RShift: "rshift", ast.BitOr: "bitor",
    ast.BitXor: "bitxor", ast.BitAnd: "bitand",
}

CMP_NAMES = {
    ast.Eq: "eq", ast.NotEq: "ne", ast.Lt: "lt", ast.LtE: "le",
    ast.Gt: "gt", ast.GtE: "ge", ast.In: "contains", ast.NotIn: "not_in",
    ast.Is: "is", ast.IsNot: "is_not",
}

NO_RETURN = {
    "print", "append", "extend", "sort", "reverse", "close", "write",
    "seek", "flush", "insert", "remove", "clear", "update",
}

BUILTIN_PARAMS = {
    "len": ["s"], "abs": ["x"], "round": ["x", "ndigits"], "min": ["a", "b"],
    "max": ["a", "b"], "sum": ["values"], "sorted": ["items"], "range": ["stop"],
    "print": ["values"], "input": ["prompt"], "int": ["x"], "float": ["x"],
    "str": ["x"], "bool": ["x"], "list": ["items"], "dict": ["items"],
    "sqrt": ["x"], "pow": ["x", "y"], "floor": ["x"], "ceil": ["x"],
    "log": ["x", "base"], "exp": ["x"], "sin": ["x"], "cos": ["x"],
    "mean": ["a"], "dot": ["a", "b"], "array": ["data"], "tensor": ["data"],
    "dumps": ["obj"], "loads": ["s"], "open": ["path", "mode"],
}

BUILTIN_RETURNS = {
    "len": [("n", "int")], "abs": [("y", "number")], "round": [("y", "number")],
    "min": [("m", "number")], "max": [("m", "number")], "sum": [("total", "number")],
    "sorted": [("out", "list")], "range": [("nums", "list")],
    "input": [("text", "string")], "int": [("y", "int")], "float": [("y", "number")],
    "str": [("s", "string")], "bool": [("ok", "boolean")], "list": [("out", "list")],
    "dict": [("out", "dict")], "sqrt": [("y", "number")], "pow": [("z", "number")],
    "floor": [("n", "int")], "ceil": [("n", "int")], "log": [("y", "number")],
    "exp": [("y", "number")], "sin": [("y", "number")], "cos": [("y", "number")],
    "mean": [("m", "number")], "dot": [("c", "number")], "array": [("arr", "list")],
    "tensor": [("t", "any")], "dumps": [("s", "string")], "loads": [("obj", "dict")],
    "open": [("f", "any")], "DataFrame": [("df", "any")],
}

ANNOTATION_TYPES = {
    "int": "int", "float": "number", "complex": "number", "number": "number",
    "str": "string", "string": "string", "bool": "boolean", "boolean": "boolean",
    "list": "list", "List": "list", "tuple": "list", "Tuple": "list",
    "set": "list", "Set": "list", "dict": "dict", "Dict": "dict",
    "None": "none", "NoneType": "none",
}


def ann_type(text: str | None) -> str:
    if not text:
        return "any"
    base = text.split("[")[0].strip()
    return ANNOTATION_TYPES.get(base, "any")


def unparse(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:  # pragma: no cover - very old Python
        if isinstance(node, ast.Constant):
            return repr(node.value)
        return "<expr>"


def source_range(node: ast.AST) -> dict:
    return {
        "start": {"line": getattr(node, "lineno", 1), "character": getattr(node, "col_offset", 0)},
        "end": {
            "line": getattr(node, "end_lineno", getattr(node, "lineno", 1)),
            "character": getattr(node, "end_col_offset", 0),
        },
    }


def safe_ident(name: str) -> bool:
    return name.isidentifier() and not name.startswith("__")


def first_doc_line(node: ast.AST) -> str:
    doc = ast.get_docstring(node) or ""
    for line in doc.splitlines():
        if line.strip():
            return line.strip()[:160]
    return ""


def code_body(node: ast.AST) -> list[ast.stmt]:
    """函数体去掉首行 docstring。

    数据流图与块视图必须用同一份 body：图会跳过 docstring，
    块若不过滤就会得到一个没有任何节点的"0 段空块"。
    """
    body = list(getattr(node, "body", []) or [])
    if (body and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)):
        return body[1:]
    return body


class Source:
    __slots__ = ("node", "port", "name", "type", "annotation")

    def __init__(self, node: str, port: str, name: str, typ: str, annotation: str | None = None):
        self.node = node
        self.port = port
        self.name = name
        self.type = typ
        self.annotation = annotation

    def ref(self) -> dict:
        return {"node": self.node, "port": self.port}


class Builder:
    def __init__(self, filename: str, entry_name: str, entry_kind: str, user_specs: dict, doc: str, src_range: dict, return_type: str | None):
        self.filename = filename
        self.entry_name = entry_name
        self.entry_kind = entry_kind
        self.user_specs = user_specs
        self.doc = doc
        self.src_range = src_range
        self.return_type = return_type
        self.nodes: list[dict] = []
        self.values: list[dict] = []
        self.edges: list[dict] = []
        self.warnings: list[dict] = []
        self.env: dict[str, Source] = {}
        self.inputs: list[dict] = []
        self.outputs: list[dict] = []
        self.returns: list[dict] = []
        self._n = 0
        self._v = 0
        self._e = 0
        self._order = 0
        self._literal_cache: dict[str, Source] = {}
        self._warned_globals: set[str] = set()
        self._output_names: set[str] = set()

    # ------------------------------------------------------------------ ids
    def nid(self) -> str:
        self._n += 1
        return f"n{self._n}"

    def vid(self) -> str:
        self._v += 1
        return f"v{self._v}"

    def eid(self) -> str:
        self._e += 1
        return f"e{self._e}"

    # --------------------------------------------------------------- values
    def add_value(self, kind: str, name: str, typ: str, annotation: str | None = None,
                  value: str | None = None, line: int | None = None) -> Source:
        vid = self.vid()
        node = {
            "id": vid, "key": vid, "kind": kind, "name": name, "type": typ,
            "position": {"x": 0, "y": 0},
        }
        if annotation:
            node["annotation"] = annotation
        if value is not None:
            node["value"] = value
        if line:
            node["sourceRange"] = {"start": {"line": line, "character": 0}, "end": {"line": line, "character": 0}}
        self.values.append(node)
        port = f"{vid}:out" if kind != "output" else f"{vid}:in"
        return Source(vid, port, name, typ, annotation)

    def literal(self, value: ast.AST, name: str | None = None) -> Source:
        text = unparse(value)
        typ = self.infer_type(value)
        if name and safe_ident(name):
            # A named constant: c = 10. Keep the target name for codegen.
            existing = next((v for v in self.values if v["kind"] == "literal" and v["name"] == name), None)
            if existing:
                src = Source(existing["id"], f"{existing['id']}:out", name, typ)
                self.env[name] = src
                return src
            src = self.add_value("literal", name, typ, value=text, line=getattr(value, "lineno", None))
            self.env[name] = src
            return src
        cached = self._literal_cache.get(text)
        if cached:
            return cached
        display = text if len(text) <= 34 else text[:31] + "…"
        src = self.add_value("literal", display, typ, value=text, line=getattr(value, "lineno", None))
        self._literal_cache[text] = src
        return src

    def global_value(self, name: str, line: int | None = None) -> Source:
        existing = next((v for v in self.values if v["kind"] == "global" and v["name"] == name), None)
        if existing:
            return Source(existing["id"], f"{existing['id']}:out", name, existing.get("type", "any"))
        src = self.add_value("global", name, "any", line=line)
        if name not in self._warned_globals and name not in ("self", "cls"):
            self._warned_globals.add(name)
            self.warn("unsupported", f"“{name}” 不在当前作用域内，按外部变量处理", line)
        return src

    def input_value(self, name: str, typ: str, annotation: str | None = None,
                    default: str | None = None, line: int | None = None) -> Source:
        src = self.add_value("input", name, typ, annotation=annotation, line=line)
        self.inputs.append({"name": name, "type": typ, "annotation": annotation, "defaultValue": default})
        self.env[name] = src
        return src

    # ---------------------------------------------------------------- nodes
    def add_node(self, *, kind: str, name: str, effect: str, category: str,
                 inputs: list[tuple[Source | None, str, str, str | None, bool, str | None]],
                 outputs: list[tuple[str, str, str | None]],
                 callee: str | None = None, op: str | None = None,
                 qualified: str | None = None, origin: str = "builtin",
                 source: ast.AST | None = None) -> list[Source]:
        nid = self.nid()
        in_ports = []
        for i, (src, pname, ptype, pann, keyword, default) in enumerate(inputs):
            port = {
                "id": f"{nid}:in:{i}", "name": pname, "type": ptype,
            }
            if pann:
                port["annotation"] = pann
            if keyword:
                port["keyword"] = True
            if default is not None:
                port["defaultValue"] = default
                port["optional"] = True
            in_ports.append(port)
        out_ports = []
        for i, (oname, otype, oann) in enumerate(outputs):
            port = {"id": f"{nid}:out:{i}", "name": oname, "type": otype}
            if oann:
                port["annotation"] = oann
            out_ports.append(port)
        node = {
            "id": nid, "key": nid, "methodId": f"builtin:{callee or op or name}",
            "name": name, "kind": kind, "effect": effect, "category": category,
            "origin": origin, "inputs": in_ports, "outputs": out_ports,
            "position": {"x": 0, "y": 0}, "order": self._order,
        }
        self._order += 1
        if callee:
            node["callee"] = callee
        if qualified:
            node["qualifiedName"] = qualified
        if op:
            node["op"] = op
        if source is not None:
            node["sourceRange"] = source_range(source)
        self.nodes.append(node)
        for i, (src, *_rest) in enumerate(inputs):
            if src is not None:
                self.edges.append({
                    "id": self.eid(),
                    "from": src.ref(),
                    "to": {"node": nid, "port": f"{nid}:in:{i}"},
                })
        return [Source(nid, f"{nid}:out:{i}", oname, otype, oann) for i, (oname, otype, oann) in enumerate(outputs)]

    # ------------------------------------------------------------- warnings
    def warn(self, code: str, message: str, line: int | None = None, node_id: str | None = None) -> None:
        item = {"code": code, "message": message}
        if line:
            item["line"] = line
        if node_id:
            item["nodeId"] = node_id
        self.warnings.append(item)

    # ------------------------------------------------------------ type help
    def infer_type(self, expr: ast.AST | None) -> str:
        if expr is None:
            return "none"
        if isinstance(expr, ast.Constant):
            if isinstance(expr.value, bool):
                return "boolean"
            if isinstance(expr.value, (int, float, complex)):
                return "number"
            if isinstance(expr.value, str):
                return "string"
            if expr.value is None:
                return "none"
            return "any"
        if isinstance(expr, ast.BinOp):
            if isinstance(expr.op, ast.Add):
                lt, rt = self.infer_type(expr.left), self.infer_type(expr.right)
                return "string" if "string" in (lt, rt) else "number"
            if isinstance(expr.op, (ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod)):
                return "number"
            if isinstance(expr.op, ast.FloorDiv):
                return "int"
            return "any"
        if isinstance(expr, (ast.Compare, ast.BoolOp)):
            return "boolean"
        if isinstance(expr, ast.UnaryOp):
            if isinstance(expr.op, ast.Not):
                return "boolean"
            if isinstance(expr.op, (ast.USub, ast.UAdd)):
                return "number"
            return "int"
        if isinstance(expr, (ast.List, ast.Tuple, ast.Set)):
            return "list"
        if isinstance(expr, ast.Dict):
            return "dict"
        if isinstance(expr, ast.JoinedStr):
            return "string"
        if isinstance(expr, ast.Call):
            callee = self.callee_of(expr)
            spec = self.user_specs.get(callee) or self.user_specs.get(callee.split(".")[-1])
            if spec and spec.get("returns"):
                return spec["returns"][0].get("type", "any")
            returns = BUILTIN_RETURNS.get(callee.split(".")[-1])
            if returns:
                return returns[0][1]
            return "any"
        if isinstance(expr, ast.Name):
            src = self.env.get(expr.id)
            if src:
                return src.type
            return "any"
        if isinstance(expr, ast.Subscript):
            return "any"
        if isinstance(expr, ast.IfExp):
            return self.infer_type(expr.body)
        if isinstance(expr, ast.NamedExpr):
            return self.infer_type(expr.value)
        return "any"

    def callee_of(self, call: ast.Call) -> str:
        if isinstance(call.func, ast.Name):
            return call.func.id
        if isinstance(call.func, ast.Attribute):
            return unparse(call.func)
        return unparse(call.func)

    def user_spec_for(self, callee: str) -> dict | None:
        if callee in self.user_specs:
            return self.user_specs[callee]
        last = callee.split(".")[-1]
        return self.user_specs.get(last)

    # ------------------------------------------------------------- expression
    def eval_expr(self, expr: ast.AST | None, out_names: list[str] | None = None) -> list[Source]:
        if expr is None:
            return []
        if isinstance(expr, ast.Constant):
            return [self.literal(expr, out_names[0] if out_names else None)]
        if isinstance(expr, ast.Name):
            src = self.env.get(expr.id)
            if src is None:
                if expr.id in ("True", "False", "None"):
                    return [self.literal(expr, out_names[0] if out_names else None)]
                src = self.global_value(expr.id, expr.lineno)
            return [src]
        if isinstance(expr, ast.BinOp):
            op_name = OPERATOR_NAMES.get(type(expr.op), "binop")
            symbol = {
                "add": "+", "sub": "-", "mul": "*", "div": "/", "floordiv": "//",
                "mod": "%", "pow": "**", "matmul": "@", "lshift": "<<", "rshift": ">>",
                "bitor": "|", "bitxor": "^", "bitand": "&",
            }.get(op_name, "+")
            left = self.one(expr.left)
            right = self.one(expr.right)
            out = out_names[0] if out_names else "result"
            return self.add_node(
                kind="operator", name=op_name, op=symbol, effect=f"计算 {unparse(expr.left)} {symbol} {unparse(expr.right)} 为 {out}",
                category="运算符",
                inputs=[(left, "a", left.type, None, False, None), (right, "b", right.type, None, False, None)],
                outputs=[(out, self.infer_type(expr), None)],
                callee=op_name, source=expr,
            )
        if isinstance(expr, ast.UnaryOp):
            if isinstance(expr.op, ast.Not):
                name, symbol = "not", "not"
            elif isinstance(expr.op, ast.USub):
                name, symbol = "neg", "-"
            elif isinstance(expr.op, ast.UAdd):
                name, symbol = "pos", "+"
            else:
                name, symbol = "invert", "~"
            src = self.one(expr.operand)
            out = out_names[0] if out_names else "result"
            inputs = [(src, "a", src.type, None, False, None)]
            return self.add_node(
                kind="operator", name=name, op=symbol,
                effect=f"对 {src.name} 执行 {symbol} 运算为 {out}", category="运算符",
                inputs=inputs, outputs=[(out, self.infer_type(expr), None)], source=expr,
            )
        if isinstance(expr, ast.BoolOp):
            current = self.one(expr.values[0])
            symbol = "and" if isinstance(expr.op, ast.And) else "or"
            for i, value in enumerate(expr.values[1:]):
                right = self.one(value)
                last = i == len(expr.values) - 2
                out = out_names[0] if (out_names and last) else "result"
                result = self.add_node(
                    kind="operator", name=symbol, op=symbol,
                    effect=f"逻辑 {symbol}：{current.name} 与 {right.name} 为 {out}", category="运算符",
                    inputs=[(current, "a", current.type, None, False, None), (right, "b", right.type, None, False, None)],
                    outputs=[(out, "boolean", None)], source=expr,
                )[0]
                current = result
            return [current]
        if isinstance(expr, ast.Compare):
            left = self.one(expr.left)
            pieces: list[Source] = []
            for op, comparator in zip(expr.ops, expr.comparators):
                right = self.one(comparator)
                name = CMP_NAMES.get(type(op), "cmp")
                symbol = {
                    "eq": "==", "ne": "!=", "lt": "<", "le": "<=", "gt": ">", "ge": ">=",
                    "contains": "in", "not_in": "not in", "is": "is", "is_not": "is not",
                }.get(name, "==")
                result = self.add_node(
                    kind="operator", name=name, op=symbol,
                    effect=f"判断 {left.name} {symbol} {right.name} 为 result", category="运算符",
                    inputs=[(left, "a", left.type, None, False, None), (right, "b", right.type, None, False, None)],
                    outputs=[("result", "boolean", None)], source=expr,
                )[0]
                pieces.append(result)
                left = right
            current = pieces[0]
            for nxt in pieces[1:]:
                out = out_names[0] if out_names else "result"
                current = self.add_node(
                    kind="operator", name="and", op="and",
                    effect="把多个比较结果合并为条件", category="运算符",
                    inputs=[(current, "a", "boolean", None, False, None), (nxt, "b", "boolean", None, False, None)],
                    outputs=[(out, "boolean", None)], source=expr,
                )[0]
            return [current]
        if isinstance(expr, ast.Call):
            return self.make_call(expr, out_names)
        if isinstance(expr, (ast.Tuple, ast.List)):
            if out_names and len(out_names) == len(expr.elts):
                result = []
                for element, name in zip(expr.elts, out_names):
                    values = self.eval_expr(element, [name])
                    result.append(values[0] if values else self.one(element))
                return result
            if all(isinstance(e, ast.Constant) for e in expr.elts):
                return [self.literal(expr, out_names[0] if out_names else None)]
            srcs = [self.one(e) for e in expr.elts]
            out = out_names[0] if out_names else "result"
            return self.add_node(
                kind="operator", name="tuple", op=",", effect=f"把 {', '.join(s.name for s in srcs)} 组成元组 {out}",
                category="运算符",
                inputs=[(srcs[i], chr(97 + i), srcs[i].type, None, False, None) for i in range(len(srcs))],
                outputs=[(out, "list", None)], source=expr,
            )
        if isinstance(expr, ast.Dict):
            return [self.literal(expr, out_names[0] if out_names else None)]
        if isinstance(expr, ast.IfExp):
            test = self.one(expr.test)
            body = self.one(expr.body)
            orelse = self.one(expr.orelse)
            out = out_names[0] if out_names else "result"
            return self.add_node(
                kind="operator", name="ifelse", op="ifelse",
                effect=f"条件为真取 {body.name}，否则取 {orelse.name}", category="运算符",
                inputs=[(test, "cond", "boolean", None, False, None), (body, "a", body.type, None, False, None), (orelse, "b", orelse.type, None, False, None)],
                outputs=[(out, body.type, None)], source=expr,
            )
        if isinstance(expr, ast.Subscript):
            base = self.one(expr.value)
            index = self.one(expr.slice)
            out = out_names[0] if out_names else "result"
            return self.add_node(
                kind="operator", name="index", op="[]",
                effect=f"取 {base.name} 的第 {index.name} 项为 {out}", category="运算符",
                inputs=[(base, "a", base.type, None, False, None), (index, "b", index.type, None, False, None)],
                outputs=[(out, "any", None)], source=expr,
            )
        if isinstance(expr, ast.Attribute):
            # A bare attribute read is kept as a small expression value.
            src = self.add_value("literal", unparse(expr), "any", value=unparse(expr), line=getattr(expr, "lineno", None))
            return [src]
        if isinstance(expr, ast.JoinedStr):
            return [self.add_value("literal", unparse(expr), "string", value=unparse(expr), line=getattr(expr, "lineno", None))]
        if isinstance(expr, ast.Lambda):
            self.warn("unsupported", "lambda 表达式以文本形式保留", getattr(expr, "lineno", None))
            return [self.add_value("literal", unparse(expr), "any", value=unparse(expr), line=getattr(expr, "lineno", None))]
        self.warn("unsupported", f"{type(expr).__name__} 表达式暂不支持可视化", getattr(expr, "lineno", None))
        return [self.add_value("literal", unparse(expr), "any", value=unparse(expr), line=getattr(expr, "lineno", None))]

    def one(self, expr: ast.AST, name: str | None = None) -> Source:
        result = self.eval_expr(expr, [name] if name else None)
        if result:
            return result[0]
        return self.add_value("literal", "None", "none", value="None")

    # ------------------------------------------------------------------ calls
    def make_call(self, call: ast.Call, out_names: list[str] | None) -> list[Source]:
        kind = "function"
        receiver: Source | None = None
        qualified: str | None = None
        if isinstance(call.func, ast.Name):
            callee = call.func.id
            name = callee
        elif isinstance(call.func, ast.Attribute):
            full = unparse(call.func)
            root = full.split(".")[0]
            if root in MODULE_ROOTS:
                callee = full
                name = call.func.attr
                qualified = full
            else:
                receiver = self.one(call.func.value)
                callee = call.func.attr
                name = callee
                kind = "method"
                qualified = full
        else:
            src = self.one(call.func)
            callee = src.name
            name = callee

        spec = self.user_spec_for(callee)
        params = BUILTIN_PARAMS.get(callee.split(".")[-1], [])
        inputs: list[tuple[Source | None, str, str, str | None, bool, str | None]] = []
        if receiver is not None:
            inputs.append((receiver, receiver.name if safe_ident(receiver.name) else "self", receiver.type, None, False, None))
        for i, arg in enumerate(call.args):
            if isinstance(arg, ast.Starred):
                self.warn("unsupported", "*args 展开暂不支持单个端口展示", getattr(arg, "lineno", None))
                src = self.one(arg.value)
            else:
                src = self.one(arg)
            pname = None
            if spec and i < len(spec.get("params", [])):
                pname = spec["params"][i]["name"]
            elif i < len(params):
                pname = params[i]
            elif isinstance(arg, ast.Name):
                pname = arg.id
            else:
                pname = f"arg{i + 1}"
            inputs.append((src, pname, src.type, None, False, None))
        for kw in call.keywords:
            if kw.arg is None:
                self.warn("unsupported", "**kwargs 展开暂不支持", getattr(kw, "lineno", None))
                continue
            src = self.one(kw.value)
            inputs.append((src, kw.arg, src.type, None, True, None))

        # Outputs
        if out_names:
            output_names = list(out_names)
        elif callee.split(".")[-1] in NO_RETURN:
            output_names = []
        elif spec:
            output_names = [r["name"] for r in spec.get("returns", [])]
        else:
            builtin_returns = BUILTIN_RETURNS.get(callee.split(".")[-1])
            output_names = [r[0] for r in builtin_returns] if builtin_returns else ["result"]
        outputs: list[tuple[str, str, str | None]] = []
        for i, oname in enumerate(output_names):
            otype = "any"
            oann = None
            if spec and i < len(spec.get("returns", [])):
                otype = spec["returns"][i].get("type", "any")
                oann = spec["returns"][i].get("annotation")
            elif BUILTIN_RETURNS.get(callee.split(".")[-1]):
                otype = BUILTIN_RETURNS[callee.split(".")[-1]][i][1] if i < len(BUILTIN_RETURNS[callee.split(".")[-1]]) else "any"
            outputs.append((oname, otype, oann))

        arg_names = [inp[1] for inp in inputs]
        if spec:
            effect = spec.get("effect") or f"调用 {name}，输入 {', '.join(arg_names)}"
        else:
            effect = f"调用 {callee}（{', '.join(arg_names)}）"
        result = self.add_node(
            kind=kind, name=name, callee=callee, qualified=qualified,
            effect=effect, category="当前文件" if spec else "内置",
            inputs=inputs, outputs=outputs, origin="user" if spec else "builtin",
            source=call,
        )
        return result

    # ------------------------------------------------------------- statements
    def block(self, body: list[ast.stmt]) -> None:
        for stmt in body:
            self.stmt(stmt)

    def assign_target(self, target: ast.AST, source: Source | None) -> None:
        if isinstance(target, ast.Name):
            if source is not None:
                self.env[target.id] = source
        elif isinstance(target, (ast.Tuple, ast.List)):
            self.warn("unsupported", "解构赋值的目标结构暂不完整支持", getattr(target, "lineno", None))
        elif isinstance(target, (ast.Attribute, ast.Subscript)):
            self.warn("unsupported", "属性 / 下标赋值以副作用保留，不绘制连线", getattr(target, "lineno", None))

    def stmt(self, node: ast.stmt) -> None:
        if isinstance(node, ast.Assign):
            if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                name = node.targets[0].id
                srcs = self.eval_expr(node.value, [name])
                if srcs:
                    self.env[name] = srcs[0]
                else:
                    self.env.pop(name, None)
            elif len(node.targets) == 1 and isinstance(node.targets[0], (ast.Tuple, ast.List)):
                targets = node.targets[0].elts
                names = [t.id if isinstance(t, ast.Name) else f"result{i + 1}" for i, t in enumerate(targets)]
                srcs = self.eval_expr(node.value, names)
                for i, t in enumerate(targets):
                    if isinstance(t, ast.Name) and i < len(srcs):
                        self.env[t.id] = srcs[i]
                    elif i >= len(srcs):
                        self.warn("unsupported", "解构赋值元素数量与返回值不一致", getattr(node, "lineno", None))
            else:
                for target in node.targets:
                    self.eval_expr(node.value)
                    self.assign_target(target, None)
            return
        if isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name):
                srcs = self.eval_expr(node.value, [node.target.id])
                if srcs:
                    srcs[0].annotation = unparse(node.annotation) if node.annotation else None
                    self.env[node.target.id] = srcs[0]
            return
        if isinstance(node, ast.AugAssign):
            if isinstance(node.target, ast.Name):
                left = self.env.get(node.target.id)
                if left is None:
                    left = self.global_value(node.target.id, node.lineno)
                right = self.one(node.value)
                op_name = OPERATOR_NAMES.get(type(node.op), "add")
                symbol = {"add": "+", "sub": "-", "mul": "*", "div": "/", "floordiv": "//", "mod": "%", "pow": "**"}.get(op_name, "+")
                result = self.add_node(
                    kind="operator", name=op_name, op=symbol,
                    effect=f"把 {left.name} 与 {right.name} 相加后写回 {node.target.id}", category="运算符",
                    inputs=[(left, "a", left.type, None, False, None), (right, "b", right.type, None, False, None)],
                    outputs=[(node.target.id, left.type, None)], source=node,
                )[0]
                self.env[node.target.id] = result
            return
        if isinstance(node, ast.Expr):
            self.eval_expr(node.value)
            return
        if isinstance(node, ast.Return):
            if node.value is None:
                return
            if isinstance(node.value, ast.Tuple):
                srcs = [self.one(e) for e in node.value.elts]
                for i, src in enumerate(srcs):
                    self.add_output(src, f"result{i + 1}" if len(srcs) > 1 else "result")
            else:
                src = self.one(node.value)
                base = src.name if safe_ident(src.name) and src.name not in ("result",) else "result"
                self.add_output(src, base)
            return
        if isinstance(node, ast.If):
            self.one(node.test)
            self.warn("control-flow", "if 分支按顺序展开为数据流；应用代码前请检查条件结构", node.lineno)
            self.block(node.body)
            self.block(node.orelse)
            return
        if isinstance(node, ast.For):
            iterable = self.one(node.iter)
            target_name = node.target.id if isinstance(node.target, ast.Name) else "item"
            item = self.add_value("global", target_name, "any", line=node.lineno)
            self.env[target_name] = item
            self.warn("control-flow", f"for 循环只展开一次（遍历 {iterable.name}），循环结构不会被生成", node.lineno)
            self.block(node.body)
            self.block(node.orelse)
            return
        if isinstance(node, ast.While):
            self.one(node.test)
            self.warn("control-flow", "while 循环只展开一次，循环结构不会被生成", node.lineno)
            self.block(node.body)
            self.block(node.orelse)
            return
        if isinstance(node, ast.Try):
            self.warn("control-flow", "try/except 按顺序展开，异常结构不会被生成", node.lineno)
            self.block(node.body)
            for handler in node.handlers:
                self.block(handler.body)
            self.block(node.orelse)
            self.block(node.finalbody)
            return
        if isinstance(node, ast.With):
            for item in node.items:
                self.eval_expr(item.context_expr)
            self.warn("control-flow", "with 语句按顺序展开，资源管理结构不会被生成", node.lineno)
            self.block(node.body)
            return
        match_type = getattr(ast, "Match", None)
        if match_type is not None and isinstance(node, match_type):
            self.one(node.subject)
            self.warn("control-flow", "match 分支按顺序展开，分支结构不会被生成", node.lineno)
            for case in node.cases:
                self.block(case.body)
            return
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal, ast.Pass, ast.Break, ast.Continue)):
            return
        if isinstance(node, ast.Raise):
            self.eval_expr(node.exc)
            self.warn("unsupported", "raise 语句以诊断形式保留", node.lineno)
            return
        if isinstance(node, ast.Assert):
            self.one(node.test)
            self.warn("unsupported", "assert 语句不参与数据流生成", node.lineno)
            return
        if isinstance(node, ast.Delete):
            self.warn("unsupported", "del 语句不参与数据流生成", node.lineno)
            return
        self.warn("unsupported", f"{type(node).__name__} 语句暂不支持可视化", getattr(node, "lineno", None))

    def add_output(self, src: Source, base: str) -> None:
        name = base if safe_ident(base) else "result"
        if name in self._output_names:
            i = 2
            while f"{name}_{i}" in self._output_names:
                i += 1
            name = f"{name}_{i}"
        self._output_names.add(name)
        vid = self.vid()
        self.values.append({
            "id": vid, "key": vid, "kind": "output", "name": name,
            "type": src.type, "position": {"x": 0, "y": 0},
        })
        self.edges.append({
            "id": self.eid(),
            "from": src.ref(),
            "to": {"node": vid, "port": f"{vid}:in"},
        })

    # ------------------------------------------------------------------ build
    def build(self, fn: ast.FunctionDef | None, module: ast.Module) -> dict:
        if fn is not None:
            args = fn.args
            positional = list(args.posonlyargs) + list(args.args)
            defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
            for arg, default in zip(positional, defaults):
                annotation = unparse(arg.annotation) if arg.annotation else None
                self.input_value(
                    arg.arg, ann_type(annotation), annotation,
                    unparse(default) if default is not None else None, arg.lineno,
                )
            for arg, default in zip(args.kwonlyargs, args.kw_defaults):
                annotation = unparse(arg.annotation) if arg.annotation else None
                self.input_value(
                    arg.arg, ann_type(annotation), annotation,
                    unparse(default) if default is not None else None, arg.lineno,
                )
            self.block(code_body(fn))
        else:
            for stmt in code_body(module):
                if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom)):
                    continue
                self.stmt(stmt)

        returns = [
            {"name": v["name"], "type": v["type"], "annotation": v.get("annotation")}
            for v in self.values if v["kind"] == "output"
        ]
        graph = {
            "version": 1,
            "id": f"flow:{self.entry_name}",
            "name": self.entry_name,
            "language": "python",
            "entryKind": self.entry_kind,
            "params": self.inputs,
            "returns": returns,
            "nodes": self.nodes,
            "values": self.values,
            "edges": self.edges,
            "warnings": self.warnings,
            "fileName": self.filename,
        }
        if self.doc:
            graph["doc"] = self.doc
        if self.return_type:
            graph["returnType"] = self.return_type
        if self.src_range:
            graph["sourceRange"] = self.src_range
        return graph


# ------------------------------------------------------------------ metadata
def tuple_names(value: ast.AST) -> list[str] | None:
    if isinstance(value, (ast.Tuple, ast.List)):
        names = []
        for i, elt in enumerate(value.elts):
            names.append(elt.id if isinstance(elt, ast.Name) else f"result{i + 1}")
        return names
    if isinstance(value, ast.Name):
        return [value.id]
    return None


class ReturnCollector(ast.NodeVisitor):
    """Collect returns that belong to the function itself, not nested defs."""

    def __init__(self) -> None:
        self.values: list[ast.AST] = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return

    def visit_Return(self, node: ast.Return) -> None:
        if node.value is not None:
            self.values.append(node.value)


def function_returns(fn: ast.FunctionDef) -> list[tuple[str, str]]:
    shapes: list[list[str]] = []
    collector = ReturnCollector()
    for stmt in fn.body:
        collector.visit(stmt)
    for value in collector.values:
        names = tuple_names(value)
        shapes.append(names if names else ["result"])
    if not shapes:
        return []
    first = shapes[0]
    if any(s != first for s in shapes[1:]):
        if any(len(s) > 1 for s in shapes):
            return [(f"result{i + 1}", "any") for i in range(max(len(s) for s in shapes))]
        return [("result", "any")]
    return [(name, "any") for name in first]


def function_specs(tree: ast.Module) -> list[dict]:
    specs = []

    def add(fn: ast.FunctionDef, qual: str | None = None, skip_first: bool = False) -> None:
        params = []
        args = fn.args
        positional = list(args.posonlyargs) + list(args.args)
        defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
        if skip_first and positional and positional[0].arg in ("self", "cls"):
            positional = positional[1:]
            defaults = defaults[1:]
        for arg, default in zip(positional, defaults):
            annotation = unparse(arg.annotation) if arg.annotation else None
            params.append({
                "name": arg.arg,
                "type": ann_type(annotation),
                "annotation": annotation,
                "defaultValue": unparse(default) if default is not None else None,
            })
        for arg, default in zip(args.kwonlyargs, args.kw_defaults):
            annotation = unparse(arg.annotation) if arg.annotation else None
            params.append({
                "name": arg.arg,
                "type": ann_type(annotation),
                "annotation": annotation,
                "defaultValue": unparse(default) if default is not None else None,
                "keywordOnly": True,
            })
        returns = function_returns(fn)
        annotation = unparse(fn.returns) if fn.returns else None
        ret_list = [{"name": n, "type": "any", "annotation": None} for n, _t in returns]
        if annotation and ret_list:
            ret_list[0]["annotation"] = annotation
            ret_list[0]["type"] = ann_type(annotation)
        doc = first_doc_line(fn)
        if doc:
            effect = doc
        elif params and ret_list:
            effect = f"输入 {', '.join(p['name'] for p in params)}，返回 {', '.join(r['name'] for r in ret_list)}"
        elif ret_list:
            effect = f"返回 {', '.join(r['name'] for r in ret_list)}"
        else:
            effect = f"执行 {fn.name}({', '.join(p['name'] for p in params)})"
        spec = {
            "name": fn.name,
            "qualifiedName": qual or fn.name,
            "kind": "function",
            "category": "当前文件",
            "signature": f"{fn.name}({', '.join(p['name'] + ('=' + p['defaultValue'] if p.get('defaultValue') is not None else '') for p in params)})" + (f" → {', '.join(r['name'] for r in ret_list)}" if ret_list else ""),
            "effect": effect,
            "params": params,
            "returns": ret_list,
            "origin": "user",
            "doc": doc,
            "sourceRange": source_range(fn),
        }
        specs.append(spec)

    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            add(node)
        elif isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    add(item, f"{node.name}.{item.name}", skip_first=True)
    return specs


def make_spec_map(specs: list[dict]) -> dict:
    result = {}
    for spec in specs:
        result[spec["name"]] = spec
        result[spec["qualifiedName"]] = spec
        result[spec["qualifiedName"].split(".")[-1]] = spec
    return result


def find_entry(tree: ast.Module, cursor_line: int | None, requested: str | None) -> ast.FunctionDef | None:
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    if requested:
        for fn in functions:
            if fn.name == requested:
                return fn
    if cursor_line:
        for fn in functions:
            if fn.lineno <= cursor_line <= (fn.end_lineno or fn.lineno):
                return fn
    for fn in functions:
        if fn.name == "main":
            return fn
    if len(functions) == 1:
        return functions[0]
    return None


def sanitize_notebook_source(source: str) -> str:
    """Remove Jupyter magics / shell escapes while preserving line numbers."""
    source = source.lstrip("\ufeff")
    lines = source.splitlines()
    cleaned = []
    for line in lines:
        if line.lstrip().startswith(("%", "!", "?")):
            cleaned.append("")
        else:
            cleaned.append(line)
    return "\n".join(cleaned)


def attach_cell_metadata(graph: dict, cells: list[dict], mode: str, selected: int) -> None:
    graph["cells"] = cells
    graph["sourceKind"] = "notebook"
    graph["cellIndex"] = selected if mode == "cell" else -1
    for item in list(graph.get("nodes", [])) + list(graph.get("values", [])):
        if mode == "cell":
            item["cellIndex"] = selected
            continue
        line = (item.get("sourceRange") or {}).get("start", {}).get("line")
        if not line:
            continue
        for cell in cells:
            if cell["startLine"] <= line <= cell["endLine"]:
                item["cellIndex"] = cell["index"]
                break


def analyze_notebook(payload: dict) -> dict:
    filename = payload.get("filename", "<notebook>")
    raw_cells = payload.get("cells") or []
    selected = payload.get("cellIndex", -1)
    mode = "cell" if isinstance(selected, int) and selected >= 0 else "all"
    cleaned = [sanitize_notebook_source(str(cell.get("source", ""))) for cell in raw_cells]
    if not cleaned:
        return {"ok": False, "error": {"message": "当前 Notebook 没有 Python 代码单元。"}}

    parts = []
    line = 1
    cells_meta = []
    for index, source in enumerate(cleaned):
        count = source.count("\n") + 1
        cells_meta.append({
            "index": index,
            "label": f"Cell {index + 1}",
            "startLine": line,
            "endLine": line + count - 1,
        })
        line += count + 1
        parts.append(source)
    all_source = "\n".join(parts)
    source = cleaned[selected] if mode == "cell" else all_source
    try:
        tree = ast.parse(source, filename=filename)
        library_tree = ast.parse(all_source, filename=filename)
    except SyntaxError as exc:
        return {
            "ok": False,
            "error": {
                "message": f"{exc.msg}（第 {exc.lineno} 行）",
                "line": exc.lineno,
                "column": exc.offset,
            },
        }

    specs = function_specs(library_tree)
    seen = {spec["qualifiedName"] for spec in specs}
    for spec in function_specs(tree):
        if spec["qualifiedName"] not in seen:
            specs.append(spec)
            seen.add(spec["qualifiedName"])
    spec_map = make_spec_map(specs)
    name = f"Cell {selected + 1}" if mode == "cell" else "Notebook"
    builder = Builder(filename, name, "module", spec_map, "", None, None)
    graph = builder.build(None, tree)
    graph["name"] = name
    attach_cell_metadata(graph, cells_meta, mode, selected)
    if mode == "cell" and not cleaned[selected].strip():
        graph["warnings"].append({"code": "unsupported", "message": "当前 Cell 是空的。"})
    return {"ok": True, "graph": graph, "methods": specs, "pythonVersion": platform.python_version()}


# ============================================================== block regions
# 视图层：把扁平的数据流图按 AST 结构折叠成"块"。不参与代码生成，
# 只影响渲染与导航。全部确定性规则，无模型、无网络。

def _r_span(node: ast.AST) -> tuple[int, int]:
    return (getattr(node, "lineno", 1),
            getattr(node, "end_lineno", getattr(node, "lineno", 1)))


def _r_names(node: ast.AST, ctx) -> set[str]:
    return {n.id for n in ast.walk(node)
            if isinstance(n, ast.Name) and isinstance(n.ctx, ctx)}


def _r_label_for_stmt(st: ast.stmt) -> str:
    """简单语句块的规则名。"""
    got = []
    for n in ast.walk(st):
        if isinstance(n, ast.Return):
            got.append("return")
        elif isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
            if n.id not in got:
                got.append(n.id)
    if got:
        return "计算 " + "、".join(got[:3])
    text = unparse(st).replace("\n", " ")
    return text[:26] + ("…" if len(text) > 26 else "")


def _r_case_label(test: ast.AST) -> str:
    """if/elif 条件压成人能一眼扫过的块名。"""
    if (isinstance(test, ast.Call) and isinstance(test.func, ast.Name)
            and test.func.id == "isinstance" and len(test.args) == 2):
        subj = unparse(test.args[0])
        targets = test.args[1]
        parts = targets.elts if isinstance(targets, (ast.Tuple, ast.List)) else [targets]
        names = [t.attr if isinstance(t, ast.Attribute) else getattr(t, "id", "?")
                 for t in parts]
        return f"{subj} 是 {'/'.join(names)}"
    text = unparse(test).replace("\n", " ")
    return text if len(text) <= 28 else text[:27] + "…"


def _r_cluster(stmts: list[ast.stmt], max_len: int = 5) -> list[list[ast.stmt]]:
    """连续简单语句按 def-use 局部性聚成语义段落。"""
    groups: list[list[ast.stmt]] = []
    cur: list[ast.stmt] = []
    cur_defs: set[str] = set()
    for st in stmts:
        if cur and (not (_r_names(st, ast.Load) & cur_defs) or len(cur) >= max_len):
            groups.append(cur)
            cur, cur_defs = [], set()
        cur.append(st)
        cur_defs |= _r_names(st, ast.Store) | _r_names(st, ast.Load)
    if cur:
        groups.append(cur)
    return groups


def build_regions(body: list[ast.stmt], graph: dict, lines: list[str]) -> list[dict]:
    raw: list[dict] = []
    linear: list[ast.stmt] = []
    chain = 0

    def flush_linear() -> None:
        nonlocal linear
        for group in _r_cluster(linear):
            raw.append({
                "kind": "linear",
                "label": _r_label_for_stmt(group[0]),
                "startLine": _r_span(group[0])[0],
                "endLine": _r_span(group[-1])[1],
            })
        linear = []

    def add_if_chain(st: ast.If) -> None:
        nonlocal chain
        chain += 1
        cur = st
        while True:
            end = _r_span(cur.body[-1])[1] if cur.body else _r_span(cur)[1]
            raw.append({"kind": "case", "label": _r_case_label(cur.test),
                        "condition": unparse(cur.test),
                        "startLine": _r_span(cur)[0], "endLine": end, "chain": chain})
            if len(cur.orelse) == 1 and isinstance(cur.orelse[0], ast.If):
                cur = cur.orelse[0]
                continue
            if cur.orelse:
                raw.append({"kind": "case", "label": "否则",
                            "startLine": _r_span(cur.orelse[0])[0],
                            "endLine": _r_span(cur.orelse[-1])[1], "chain": chain})
            break

    for st in body:
        if isinstance(st, ast.If):
            flush_linear()
            add_if_chain(st)
        elif isinstance(st, (ast.For, ast.While, ast.Try, ast.With)) or \
                type(st).__name__ == "Match":
            flush_linear()
            raw.append({"kind": type(st).__name__.lower(),
                        "label": unparse(st).split("\n")[0][:26],
                        "startLine": _r_span(st)[0], "endLine": _r_span(st)[1]})
        elif isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef,
                             ast.Import, ast.ImportFrom)):
            flush_linear()
        else:
            linear.append(st)
    flush_linear()

    raw.sort(key=lambda r: (r["startLine"], r["endLine"]))
    for i in range(1, len(raw)):                     # 去重叠
        if raw[i]["startLine"] <= raw[i - 1]["endLine"]:
            raw[i]["startLine"] = raw[i - 1]["endLine"] + 1
    raw = [r for r in raw if r["startLine"] <= r["endLine"]]

    # ---- 投影：图元素按 sourceRange.start.line 落到 region
    for i, r in enumerate(raw):
        r["id"] = f"r{i + 1}"
        r["nodes"], r["values"] = [], []
    for item in graph["nodes"]:
        line = (item.get("sourceRange") or {}).get("start", {}).get("line")
        if not line:
            continue
        for r in raw:
            if r["startLine"] <= line <= r["endLine"]:
                r["nodes"].append(item["id"])
                break
    for item in graph.get("values", []):
        line = (item.get("sourceRange") or {}).get("start", {}).get("line")
        if not line:
            continue
        for r in raw:
            if r["startLine"] <= line <= r["endLine"]:
                r["values"].append(item["id"])
                break

    # ---- 碎片合并：小且无跨块连线的相邻块
    owner: dict[str, str] = {}
    for r in raw:
        for m in r["nodes"] + r["values"]:
            owner[m] = r["id"]
    degree: dict[str, int] = {}
    for e in graph["edges"]:
        a, b = owner.get(e["from"]["node"]), owner.get(e["to"]["node"])
        if a and b and a != b:
            degree[a] = degree.get(a, 0) + 1
            degree[b] = degree.get(b, 0) + 1

    merged: list[dict] = []
    buf: list[dict] = []

    def flush_buf() -> None:
        nonlocal buf
        if len(buf) == 1:
            merged.append(buf[0])
        elif buf:
            merged.append({
                "kind": "misc",
                "label": f"其余 {len(buf)} 个小分支",
                "startLine": buf[0]["startLine"],
                "endLine": buf[-1]["endLine"],
                "nodes": [m for r in buf for m in r["nodes"]],
                "values": [m for r in buf for m in r["values"]],
            })
        buf = []

    for r in raw:
        if len(r["nodes"]) < 3 and degree.get(r["id"], 0) <= 1:
            buf.append(r)
        else:
            flush_buf()
            merged.append(r)
    flush_buf()
    # 块太少时不要合并：小函数本来就没几个块，合并只会把结构抹平
    if len(raw) < 8:
        merged = list(raw)

    # 丢掉不承载任何图元素的块：docstring、pass 这类语句不产出节点，
    # 留着只会在块视图里显示成"0 段"的空壳
    merged = [r for r in merged if r["nodes"] or r["values"]]

    # ---- 端口：跨块传递的变量
    out_name = {n["id"]: n["outputs"][0]["name"]
                for n in graph["nodes"] if n.get("outputs")}
    for i, r in enumerate(merged):
        r["id"] = f"r{i + 1}"
        r["inputs"], r["outputs"] = [], []
    owner = {}
    for r in merged:
        for m in r["nodes"] + r["values"]:
            owner[m] = r["id"]
    pins: dict[str, set[str]] = {r["id"]: set() for r in merged}
    pouts: dict[str, set[str]] = {r["id"]: set() for r in merged}
    pairs: set[tuple[str, str]] = set()
    for e in graph["edges"]:
        a, b = owner.get(e["from"]["node"]), owner.get(e["to"]["node"])
        if not a or not b or a == b:
            continue
        var = out_name.get(e["from"]["node"])
        if var:
            pouts[a].add(var)
            pins[b].add(var)
        pairs.add((a, b))
    for r in merged:
        r["inputs"] = sorted(pins[r["id"]])
        r["outputs"] = sorted(pouts[r["id"]])
        r["size"] = len(r["nodes"])
        r["edgesOut"] = sorted({b for a, b in pairs if a == r["id"]})
        # 块内容指纹：给"离线命名缓存"当 key
        chunk = "\n".join(lines[r["startLine"] - 1:r["endLine"]])
        r["hash"] = hashlib.sha1(chunk.encode("utf-8")).hexdigest()[:12]
    return merged


def load_block_names(filename: str) -> dict:
    """读取 .flowcode/names.json（由离线命名工具生成，可选）。"""
    try:
        d = Path(filename).resolve().parent
        for _ in range(8):
            p = d / ".flowcode" / "names.json"
            if p.is_file():
                data = json.loads(p.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else {}
            if d.parent == d:
                break
            d = d.parent
    except Exception:
        pass
    return {}


def attach_regions(graph: dict, body: list[ast.stmt], source: str, filename: str) -> None:
    if not source.strip():
        return
    try:
        regions = build_regions(body, graph, source.splitlines())
        names = load_block_names(filename)
        for r in regions:
            hit = names.get(r.get("hash") or "")
            if isinstance(hit, str) and hit.strip():
                r["name"] = hit.strip()[:24]
        if regions:
            graph["regions"] = regions
    except Exception as exc:      # 分块失败绝不能影响主流程
        graph.setdefault("warnings", []).append(
            {"code": "unsupported", "message": f"块视图生成失败：{exc}"})


def analyze(payload: dict) -> dict:
    if payload.get("cells") is not None:
        return analyze_notebook(payload)
    source = payload.get("source", "").lstrip("\ufeff")
    filename = payload.get("filename", "<editor>")
    cursor_line = payload.get("cursorLine")
    requested = payload.get("entry")
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as exc:
        return {
            "ok": False,
            "error": {
                "message": f"{exc.msg}（第 {exc.lineno} 行）",
                "line": exc.lineno,
                "column": exc.offset,
            },
        }
    specs = function_specs(tree)
    spec_map = make_spec_map(specs)
    fn = find_entry(tree, cursor_line, requested)
    if fn is not None:
        doc = first_doc_line(fn)
        ret = unparse(fn.returns) if fn.returns else None
        b = Builder(filename, fn.name, "function", spec_map, doc, source_range(fn), ret)
        graph = b.build(fn, tree)
        attach_regions(graph, code_body(fn), source, filename)
    else:
        stem = Path(filename).stem or "module"
        b = Builder(filename, stem, "module", spec_map, "", None, None)
        graph = b.build(None, tree)
        attach_regions(graph, [
            s for s in code_body(tree)
            if not isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef,
                                  ast.Import, ast.ImportFrom))
        ], source, filename)
    return {"ok": True, "graph": graph, "methods": specs, "pythonVersion": platform.python_version()}


def main() -> None:
    try:
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8")
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        payload = json.load(sys.stdin)
        result = analyze(payload)
    except Exception as exc:  # pragma: no cover - defensive
        result = {
            "ok": False,
            "error": {"message": f"解析器内部错误：{exc}"},
        }
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
