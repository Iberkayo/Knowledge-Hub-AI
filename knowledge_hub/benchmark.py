"""Offline smoke benchmark or explicitly authorized paid OpenAI-compatible run."""
from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import time

from knowledge_hub.cli import PROMPT
from knowledge_hub.core import chunks, translate
from knowledge_hub.qa import inspect_segment


def build_reference_lookup(cases) -> dict[str, str]:
    """Map full cases and aligned paragraph chunks so multi-paragraph smoke tests resolve cleanly."""
    lookup: dict[str, str] = {}
    for c in cases:
        src = c["source"]
        ref = c["reference"]
        lookup[src] = ref
        src_parts = chunks(src)
        ref_parts = chunks(ref)
        if len(src_parts) == len(ref_parts):
            for sp, rp in zip(src_parts, ref_parts):
                lookup[sp] = rp
    return lookup

RUBRIC_WEIGHTS = {
    "semantic_fidelity": 0.35,
    "technical_terminology": 0.25,
    "completeness": 0.20,
    "turkish_fluency": 0.10,
    "math_numeric_integrity": 0.10,
}


def evaluate(cases, provider):
    rows = []
    for case in cases:
        started = time.monotonic()
        segments = translate(case["source"], provider)
        qa_reports = [inspect_segment(s.original, s.translated, mode="faithful") for s in segments]
        rows.append(
            {
                "id": case["id"],
                "category": case.get("category", "general"),
                "reference": case["reference"],
                "segments": [asdict(s) for s in segments],
                "seconds": time.monotonic() - started,
                "numeric_warning": any(s.warnings for s in segments),
                "qa_warnings": [w for r in qa_reports for w in r.warnings],
                "qa_critical": [c for r in qa_reports for c in r.critical_errors],
                "passed_deterministic_qa": all(r.passed for r in qa_reports),
            }
        )
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
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "system", "content": PROMPT}, {"role": "user", "content": source}],
                )
                if response.usage:
                    usage.append(response.usage.model_dump())
                return response.choices[0].message.content or ""

            results.append(
                {
                    "model": model,
                    "mode": "live",
                    "rubric_weights": RUBRIC_WEIGHTS,
                    "rows": evaluate(cases, provider),
                    "usage": usage,
                }
            )
    else:
        lookup = build_reference_lookup(cases)
        results.append(
            {
                "model": "reference-echo",
                "mode": "smoke-only",
                "rubric_weights": RUBRIC_WEIGHTS,
                "rows": evaluate(cases, lookup.__getitem__),
            }
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
