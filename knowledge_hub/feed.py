"""Parse saved RSS/Atom feeds safely using defusedxml."""
from __future__ import annotations

import re
from defusedxml import ElementTree as ET

_TAG_STRIP_RE = re.compile(r"<[^>]+>")


def _clean_text(raw: str | None, limit: int = 500) -> str:
    if not raw:
        return ""
    stripped = _TAG_STRIP_RE.sub(" ", raw)
    return re.sub(r"\s+", " ", stripped).strip()[:limit]


def parse_feed(xml: str) -> list[dict[str, str]]:
    if len(xml) > 2_500_000:
        raise ValueError("Feed too large")
    root = ET.fromstring(xml)
    entries: list[dict[str, str]] = []
    for e in root.findall(".//item") + root.findall(".//{*}entry"):
        title = _clean_text(e.findtext("{*}title"), 300)
        link = e.find("{*}link")
        if link is None:
            for cand in e.findall("{*}link"):
                if cand.get("rel", "alternate") == "alternate":
                    link = cand
                    break
        url = ((link.get("href") or link.text or "").strip()) if link is not None else ""
        enclosure = e.find("{*}enclosure")
        audio = (enclosure.get("url", "").strip()) if enclosure is not None else ""
        if not audio:
            for cand in e.findall("{*}link"):
                if cand.get("rel") == "enclosure" or str(cand.get("type", "")).startswith("audio/"):
                    audio = (cand.get("href") or "").strip()
                    break
        author = _clean_text(
            e.findtext("{*}author/{*}name")
            or e.findtext("{*}author")
            or e.findtext("{http://purl.org/dc/elements/1.1/}creator"),
            200,
        )
        published_at = _clean_text(
            e.findtext("{*}pubDate") or e.findtext("{*}published") or e.findtext("{*}updated"),
            64,
        )
        summary = _clean_text(
            e.findtext("{*}description") or e.findtext("{*}summary") or e.findtext("{*}content"),
            500,
        )
        guid = _clean_text(e.findtext("{*}guid") or e.findtext("{*}id") or url or title, 500)
        entries.append(
            {
                "title": title,
                "url": url,
                "audio": audio,
                "author": author,
                "published_at": published_at,
                "summary": summary,
                "guid": guid,
            }
        )
    return entries[:500]
