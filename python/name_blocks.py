#!/usr/bin/env python3
"""FlowCode 块命名工具（离线、可选、可插拔）。

FlowCode 本体永远不联网：块名由规则生成，只有当仓库里存在
``.flowcode/names.json`` 时才会用缓存的"人话"覆盖规则名。

这个脚本负责生成那个缓存：
  1. 用 parse_flow.py 拿到当前函数的所有块及其源码片段；
  2. 没有缓存名字的块，交给一个 OpenAI 兼容的接口（本地 llama.cpp /
     Ollama / vLLM / 任何兼容网关都行）；
  3. 结果按"块内容指纹"写回 ``.flowcode/names.json``。

用法：
    # 只看规则名，不联网
    python name_blocks.py demo.py --entry main --dry-run

    # 用本地 Ollama 生成块名
    python name_blocks.py demo.py --entry main \\
        --endpoint http://localhost:11434/v1 --model qwen2.5-coder:7b

    # 没有模型也能验证整条链路
    python name_blocks.py demo.py --entry main --stub

环境变量：
    OPENAI_API_KEY  接口密钥（本地服务通常随便填）
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _find_parser() -> Path:
    for cand in (HERE / "parse_flow.py", HERE.parent / "dist" / "parse_flow.py"):
        if cand.is_file():
            return cand
    raise SystemExit("找不到 parse_flow.py：请把它和本脚本放在同一目录，或在 dist/ 下。")


PARSER = _find_parser()

SYSTEM = (
    "你在给一份 Python 代码的结构块起标签。标签会显示在流程图的块上，"
    "必须是 2–8 个汉字，动宾短语，说清这段代码在做什么，不要复述变量名。"
    "只输出标签本身，不要标点、不要解释。"
)


def load_parser():
    spec = importlib.util.spec_from_file_location("flowcode_parse", PARSER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def blocks_of(parser, path: Path, entry: str | None) -> list[dict]:
    source = path.read_text(encoding="utf-8")
    res = parser.analyze({
        "source": source,
        "filename": str(path),
        "entry": entry,
        "cursorLine": 1,
    })
    if not res.get("ok"):
        raise SystemExit(f"解析失败：{res['error']['message']}")
    lines = source.splitlines()
    regions = res["graph"].get("regions") or []
    for r in regions:
        r["source"] = "\n".join(lines[r["startLine"] - 1:r["endLine"]])
    return regions


def rule_name(r: dict) -> str:
    return r.get("label") or r.get("id")


def call_model(r: dict, endpoint: str, model: str, api_key: str, timeout: int) -> str:
    prompt = (
        f"代码块（第 {r['startLine']}–{r['endLine']} 行，结构类型：{r['kind']}）：\n"
        f"```python\n{r['source'][:2000]}\n```\n"
        f"它输出的变量：{', '.join(r.get('outputs') or []) or '无'}\n"
        f"它接收的变量：{', '.join(r.get('inputs') or []) or '无'}\n"
        "给这段代码一个 2–8 字的中文标签。"
    )
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "max_tokens": 32,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(
        endpoint.rstrip("/") + "/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"].strip()
    return clean(text)


def clean(text: str) -> str:
    text = text.strip().strip("`'\"「」《》 ")
    text = re.sub(r"^(标签|名字)[:：]\s*", "", text)
    text = text.splitlines()[0] if text else ""
    return text[:24]


def stub_name(r: dict) -> str:
    """没有模型时用的确定性假名字，用来验证缓存链路是否打通。"""
    rng = ("校验", "归一化", "计算", "解析", "写回", "聚合", "分派", "兜底")
    h = sum(ord(c) for c in (r.get("hash") or r["id"]))
    return f"{rng[h % len(rng)]}{r['kind']}块"


def main() -> None:
    ap = argparse.ArgumentParser(description="为 FlowCode 的结构块生成人类可读的标签")
    ap.add_argument("file", help="目标 .py 文件")
    ap.add_argument("--entry", default=None, help="入口函数名（默认按光标/唯一函数自动选）")
    ap.add_argument("--endpoint", default=os.environ.get("FLOWCODE_LLM_ENDPOINT", ""),
                    help="OpenAI 兼容接口，例如 http://localhost:11434/v1")
    ap.add_argument("--model", default=os.environ.get("FLOWCODE_LLM_MODEL", "qwen2.5-coder:7b"))
    ap.add_argument("--api-key", default=os.environ.get("OPENAI_API_KEY", "local"))
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--out", default=None, help="输出路径（默认 <文件目录>/.flowcode/names.json）")
    ap.add_argument("--dry-run", action="store_true", help="只打印规则名，不调用模型也不写文件")
    ap.add_argument("--stub", action="store_true", help="用假名字验证链路（不联网）")
    args = ap.parse_args()

    path = Path(args.file).resolve()
    if not path.is_file():
        raise SystemExit(f"找不到文件：{path}")

    parser = load_parser()
    regions = blocks_of(parser, path, args.entry)
    if not regions:
        raise SystemExit("这个函数没有产出块（可能是模块级代码或 Notebook）。")

    out = Path(args.out) if args.out else path.parent / ".flowcode" / "names.json"
    cache: dict[str, str] = {}
    if out.is_file():
        try:
            cache = json.loads(out.read_text(encoding="utf-8"))
        except Exception:
            cache = {}

    print(f"{path.name}: {len(regions)} 个块" + (f"（已有 {len(cache)} 条缓存）" if cache else ""))
    print("-" * 68)

    todo = []
    for r in regions:
        h = r.get("hash") or r["id"]
        if h in cache:
            print(f"  [缓存] {r['id']:4} L{r['startLine']:<4}-{r['endLine']:<4} {cache[h]}")
        elif args.dry_run:
            print(f"  [规则] {r['id']:4} L{r['startLine']:<4}-{r['endLine']:<4} {rule_name(r)}")
        else:
            todo.append((h, r))

    if args.dry_run or not todo:
        if not args.dry_run:
            print(f"\n全部命中缓存，无需调用模型。缓存：{out}")
        return

    use_stub = args.stub or not args.endpoint
    if use_stub and not args.stub:
        print("\n没有指定 --endpoint，退化为 --stub（只验证链路，不联网）")

    for h, r in todo:
        if use_stub:
            name = stub_name(r)
        else:
            try:
                name = call_model(r, args.endpoint, args.model, args.api_key, args.timeout)
            except Exception as exc:
                print(f"  [失败] {r['id']}: {exc} → 保留规则名")
                continue
        if not name:
            continue
        cache[h] = name
        print(f"  [生成] {r['id']:4} L{r['startLine']:<4}-{r['endLine']:<4} {name}")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n已写入 {out}（{len(cache)} 条）")


if __name__ == "__main__":
    main()
