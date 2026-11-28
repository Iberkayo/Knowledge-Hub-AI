from dataclasses import dataclass
import re
from typing import Callable

@dataclass(frozen=True)
class Segment:
    original: str
    translated: str
    warnings: tuple[str, ...]

def chunks(text: str, limit: int = 3000) -> list[str]:
    if limit < 1:
        raise ValueError("limit must be positive")
    result = []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        paragraph = paragraph.strip()
        while len(paragraph) > limit:
            cut = paragraph.rfind(" ", 0, limit + 1)
            if cut <= 0:
                cut = limit
            result.append(paragraph[:cut])
            paragraph = paragraph[cut:].lstrip()
        if paragraph:
            result.append(paragraph)
    return result

def translate(text: str, provider: Callable[[str], str]) -> list[Segment]:
    segments = []
    for original in chunks(text):
        translated = provider(original).strip()
        if not translated:
            raise ValueError("Provider returned empty translation")
        # Heuristic only: punctuation conventions may yield false positives.
        numbers = lambda s: sorted(re.findall(r"\d+", s))
        warnings = () if numbers(original) == numbers(translated) else ("numeric mismatch",)
        segments.append(Segment(original, translated, warnings))
    if not segments:
        raise ValueError("No source text")
    return segments
