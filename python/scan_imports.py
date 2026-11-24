#!/usr/bin/env python3
"""Scan Python imports for FlowCode's file relationship view."""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path


def module_name(rel: str) -> str:
    parts = rel.replace("\\", "/").split("/")
    if parts and parts[-1] == "__init__.py":
        parts = parts[:-1]
    else:
        parts[-1] = parts[-1][:-3] if parts[-1].endswith(".py") else parts[-1]
    return ".".join(part for part in parts if part)


def base_package(rel: str) -> list[str]:
    parts = rel.replace("\\", "/").split("/")[:-1]
    return [part for part in parts if part]


def resolve_relative(rel: str, level: int, module: str | None) -> str:
    parts = base_package(rel)
    if level > 0:
        drop = level - 1
        if drop:
            parts = parts[:-drop] if drop <= len(parts) else []
    if module:
        parts.extend(module.split("."))
    return ".".join(parts)


def analyze(payload: dict) -> dict:
    root = payload.get("root", "")
    files = payload.get("files") or []
    modules: dict[str, dict] = {}
    for item in files:
        rel = item.get("relPath", "")
        mod = module_name(rel)
        if mod:
            modules[mod] = item

    nodes = []
    edges = []
    externals = []
    warnings = []
    seen_edges = set()
    for item in files:
        rel = item.get("relPath", "")
        source = item.get("source", "").lstrip("\ufeff")
        functions: list[str] = []
        classes: list[str] = []
        try:
            tree = ast.parse(source)
        except SyntaxError as exc:
            warnings.append(f"{rel}: {exc.msg}（第 {exc.lineno} 行）")
            continue
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                functions.append(node.name)
            elif isinstance(node, ast.ClassDef):
                classes.append(node.name)
        nodes.append({
            "id": rel,
            "path": str(Path(root) / rel) if root else rel,
            "relPath": rel,
            "name": Path(rel).name,
            "dir": str(Path(rel).parent).replace("\\", "/"),
            "functions": functions,
            "classes": classes,
            "position": {"x": 0, "y": 0},
        })
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target = alias.name
                    label = f"import {target}"
                    item = modules.get(target)
                    if item:
                        key = (rel, item["relPath"], label)
                        if key not in seen_edges:
                            seen_edges.add(key)
                            edges.append({
                                "id": f"e{len(edges) + 1}",
                                "from": rel,
                                "to": item["relPath"],
                                "label": label,
                                "kind": "import",
                            })
                    else:
                        externals.append({"name": target.split(".")[0], "from": rel})
            elif isinstance(node, ast.ImportFrom):
                level = node.level or 0
                module = node.module
                target = resolve_relative(rel, level, module) if level else (module or "")
                symbols = [alias.name for alias in node.names if alias.name != "*"]
                label = f"from {target} import {', '.join(symbols)}" if target else f"from . import {', '.join(symbols)}"
                item = modules.get(target)
                if not item and target:
                    for alias in node.names:
                        candidate = f"{target}.{alias.name}" if target else alias.name
                        if candidate in modules:
                            target = candidate
                            item = modules[candidate]
                            break
                if item:
                    key = (rel, item["relPath"], label)
                    if key not in seen_edges:
                        seen_edges.add(key)
                        edges.append({
                            "id": f"e{len(edges) + 1}",
                            "from": rel,
                            "to": item["relPath"],
                            "label": label,
                            "kind": "from",
                        })
                elif target:
                    externals.append({"name": target.split(".")[0], "from": rel})
                elif symbols:
                    externals.append({"name": symbols[0], "from": rel})

    # Deduplicate external pairs; keep at most 30 to avoid clutter.
    unique_external = []
    seen_external = set()
    for item in externals:
        key = (item["name"], item["from"])
        if key not in seen_external:
            seen_external.add(key)
            unique_external.append(item)
    return {
        "root": root,
        "nodes": nodes,
        "edges": edges,
        "externals": unique_external[:30],
        "warnings": warnings,
    }


def main() -> None:
    try:
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8")
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        payload = json.load(sys.stdin)
        result = analyze(payload)
    except Exception as exc:  # pragma: no cover
        result = {"root": "", "nodes": [], "edges": [], "externals": [], "warnings": [f"扫描失败：{exc}"]}
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
