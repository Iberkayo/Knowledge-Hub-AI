"""Offline smoke benchmark or explicitly authorized paid OpenAI-compatible run."""
import argparse
import json
import os
import time
from pathlib import Path
from dataclasses import asdict
from knowledge_hub.core import translate
from knowledge_hub.cli import PROMPT

def evaluate(cases, provider):
    rows = []
    for case in cases:
        started = time.monotonic()
        segments = translate(case["source"], provider)
        rows.append({"id": case["id"], "reference": case["reference"],
                     "segments": [asdict(s) for s in segments],
                     "seconds": time.monotonic() - started,
                     "numeric_warning": any(s.warnings for s in segments)})
    return rows

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cases", type=Path, default=Path("benchmarks/cases.json"))
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--model", action="append")
    p.add_argument("--allow-paid", action="store_true")
    args = p.parse_args()
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    results = []
    if args.model:
        if not args.allow_paid:
            p.error("Paid models require --allow-paid")
        from openai import OpenAI
        client = OpenAI(timeout=90, max_retries=1)
        for model in args.model:
            usage = []
            def provider(source):
                response = client.chat.completions.create(model=model, messages=[
                    {"role":"system","content":PROMPT},{"role":"user","content":source}])
                if response.usage:
                    usage.append(response.usage.model_dump())
                return response.choices[0].message.content or ""
            results.append({"model": model, "mode":"live", "rows":evaluate(cases, provider), "usage":usage})
    else:
        lookup = {c["source"]:c["reference"] for c in cases}
        results.append({"model":"reference-echo", "mode":"smoke-only", "rows":evaluate(cases, lookup.__getitem__)})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
