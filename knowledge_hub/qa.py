"""Deterministic and heuristic quality checks for technical translations."""
from __future__ import annotations

from dataclasses import dataclass
import re

_CODE_FENCE_RE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
_MATH_BLOCK_RE = re.compile(r"\$\$[\s\S]*?\$\$")
_MATH_INLINE_RE = re.compile(r"(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)")
_URL_RE = re.compile(r"https?://[^\s)\]>\"']+")
_NUMBER_RE = re.compile(r"(?<![A-Za-z_])\d+(?:[.,]\d+)?(?![A-Za-z_])")
_NEGATION_EN_RE = re.compile(r"\b(not|never|no|cannot|can't|won't|don't|doesn't|must not|should not|neither|nor)\b", re.I)
_NEGATION_TR_RE = re.compile(r"(değil|yok|hiç|asla|olamaz|yapılmaz|edilmez|me[zm]\b|ma[zm]\b|m[ıiuü]yor|m[ae]meli)", re.I)


@dataclass(frozen=True)
class QAReport:
    warnings: tuple[str, ...]
    critical_errors: tuple[str, ...]
    metrics: dict[str, object]

    @property
    def passed(self) -> bool:
        return not self.critical_errors


def _normalize_numbers(text: str) -> list[str]:
    """Normalize decimal separators so 0.01 and 0,01 compare consistently."""
    cleaned = _CODE_FENCE_RE.sub(" ", text)
    cleaned = _URL_RE.sub(" ", cleaned)
    nums = [n.replace(",", ".") for n in _NUMBER_RE.findall(cleaned)]
    return sorted(nums)


def inspect_segment(source: str, translated: str, mode: str = "faithful") -> QAReport:
    """Run deterministic quality checks between a source segment and Turkish output."""
    warnings: list[str] = []
    critical: list[str] = []

    src = source.strip()
    tgt = translated.strip()

    if not tgt:
        critical.append("empty_translation")
        return QAReport(tuple(warnings), tuple(critical), {"length_ratio": 0.0})

    # 1. Numeric integrity
    src_nums = _normalize_numbers(src)
    tgt_nums = _normalize_numbers(tgt)
    if src_nums != tgt_nums:
        warnings.append("numeric_mismatch")

    # 2. Code block preservation
    src_fences = _CODE_FENCE_RE.findall(src)
    tgt_fences = _CODE_FENCE_RE.findall(tgt)
    if len(src_fences) != len(tgt_fences):
        critical.append("code_block_missing")
    else:
        for sf, tf in zip(src_fences, tgt_fences):
            if sf.strip() != tf.strip():
                warnings.append("code_block_modified")
                break

    src_inline = set(_INLINE_CODE_RE.findall(src))
    tgt_inline = set(_INLINE_CODE_RE.findall(tgt))
    if src_inline - tgt_inline:
        warnings.append("inline_code_changed")

    # 3. Math formula preservation
    src_math = _MATH_BLOCK_RE.findall(src) + _MATH_INLINE_RE.findall(src)
    tgt_math = _MATH_BLOCK_RE.findall(tgt) + _MATH_INLINE_RE.findall(tgt)
    if len(src_math) != len(tgt_math):
        warnings.append("math_expression_mismatch")

    # 4. Link / URL preservation
    src_urls = set(_URL_RE.findall(src))
    tgt_urls = set(_URL_RE.findall(tgt))
    if src_urls - tgt_urls:
        warnings.append("url_missing")

    # 5. Completeness / accidental summarization detection in faithful mode
    ratio = len(tgt) / max(1, len(src))
    if mode == "faithful" and len(src) >= 120 and ratio < 0.35:
        critical.append("suspiciously_short_output")
    elif mode == "faithful" and len(src) >= 80 and ratio < 0.5:
        warnings.append("possible_omission")

    # 6. Negation sanity check (heuristic)
    if len(_NEGATION_EN_RE.findall(src)) > 0 and not _NEGATION_TR_RE.search(tgt):
        warnings.append("negation_check_needed")

    return QAReport(
        warnings=tuple(dict.fromkeys(warnings)),
        critical_errors=tuple(dict.fromkeys(critical)),
        metrics={
            "length_ratio": round(ratio, 3),
            "source_chars": len(src),
            "translated_chars": len(tgt),
            "numbers_matched": src_nums == tgt_nums,
        },
    )
