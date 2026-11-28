"""HTML and document extraction with rich metadata and structure preservation."""
from __future__ import annotations

import argparse
from dataclasses import dataclass, asdict
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit


@dataclass
class ExtractedArticle:
    title: str
    author: str
    published_at: str
    text: str
    blocks: list[dict[str, object]]
    language_hint: str = "en"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class ArticleParser(HTMLParser):
    """Backward-compatible plain text extractor used by existing CLI/tests."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = 0
        self.skip = 0
        self.parts = []
        self.found = False

    def handle_starttag(self, tag, attrs):
        if tag in {"article", "main"}:
            self.active += 1
            self.found = True
        if tag in {"script", "style", "nav", "footer", "aside"}:
            self.skip += 1
        if self.active and not self.skip and tag in {"p", "h1", "h2", "h3", "li", "pre", "br"}:
            self.parts.append("\n\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "footer", "aside"}:
            self.skip = max(0, self.skip - 1)
        if tag in {"article", "main"}:
            self.active = max(0, self.active - 1)
        if self.active and not self.skip and tag in {"p", "h1", "h2", "h3", "pre"}:
            self.parts.append("\n\n")

    def handle_data(self, data):
        if self.active and not self.skip:
            self.parts.append(data)


def extract(html: str) -> str:
    """Preserve existing simple API contract for HTML extraction."""
    parser = ArticleParser()
    parser.feed(html)
    result = "\n\n".join(p.strip() for p in "".join(parser.parts).split("\n\n") if p.strip())
    if not parser.found or not result:
        raise ValueError("No nonempty article/main; provide a manually extracted text file")
    return result


class RichArticleParser(HTMLParser):
    """Extracts metadata, headings, paragraphs, code blocks, lists, quotes, and tables."""

    _SKIP_TAGS = {"script", "style", "nav", "footer", "aside", "noscript", "svg", "button", "form"}
    _HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4}

    def __init__(self, base_url: str = ""):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.meta: dict[str, str] = {}
        self.json_ld_raw: list[str] = []
        self._in_title = False
        self.doc_title_parts: list[str] = []
        self._in_json_ld = False
        self._json_ld_buf: list[str] = []
        self.html_lang = ""

        self._container_depth = 0
        self.found_main = False
        self._body_depth = 0
        self._skip_depth = 0

        self._current_block_type: str | None = None
        self._current_heading_level = 2
        self._current_code_lang = ""
        self._current_buf: list[str] = []
        self._in_pre = False
        self._in_code = False
        self._in_li = False
        self._list_ordered = False
        self._list_index = 0
        self._in_link_href = ""
        self._in_link_buf: list[str] = []

        self._table_rows: list[list[str]] = []
        self._current_row: list[str] = []
        self._current_cell: list[str] = []
        self._in_table = False
        self._in_cell = False

        self.blocks_main: list[dict[str, object]] = []
        self.blocks_body: list[dict[str, object]] = []

    def _active_target(self) -> list[dict[str, object]] | None:
        if self._skip_depth > 0:
            return None
        if self._container_depth > 0:
            return self.blocks_main
        if self._body_depth > 0:
            return self.blocks_body
        return None

    def _flush_block(self) -> None:
        target = self._active_target()
        if not self._current_block_type or target is None:
            self._current_block_type = None
            self._current_buf.clear()
            return
        raw = "".join(self._current_buf)
        self._current_buf.clear()
        btype = self._current_block_type
        self._current_block_type = None

        if btype == "code":
            code_text = raw.strip("\n")
            if code_text.strip():
                target.append({"type": "code", "language": self._current_code_lang, "text": code_text})
            return

        cleaned = re.sub(r"[ \t\r\n]+", " ", raw).strip()
        if not cleaned:
            return
        if btype == "heading":
            target.append({"type": "heading", "level": self._current_heading_level, "text": cleaned})
        elif btype == "blockquote":
            target.append({"type": "blockquote", "text": cleaned})
        elif btype == "list_item":
            prefix = f"{self._list_index}. " if self._list_ordered else "- "
            target.append({"type": "list_item", "ordered": self._list_ordered, "text": cleaned, "prefix": prefix})
        else:
            target.append({"type": "paragraph", "text": cleaned})

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): (v or "") for k, v in attrs}

        if tag == "html" and attr_map.get("lang"):
            self.html_lang = attr_map["lang"].split("-")[0].lower()

        if tag == "meta":
            key = (attr_map.get("property") or attr_map.get("name") or "").lower()
            content = attr_map.get("content", "").strip()
            if key and content and key not in self.meta:
                self.meta[key] = content
            return

        if tag == "title":
            self._in_title = True
            return

        if tag == "script":
            if attr_map.get("type", "").lower() == "application/ld+json":
                self._in_json_ld = True
                self._json_ld_buf.clear()
            self._skip_depth += 1
            return

        if tag == "body":
            self._body_depth += 1
            return

        if tag in {"article", "main"}:
            self._flush_block()
            self._container_depth += 1
            self.found_main = True
            return

        if tag in self._SKIP_TAGS:
            self._flush_block()
            self._skip_depth += 1
            return

        if self._active_target() is None:
            return

        if tag in self._HEADING_TAGS:
            self._flush_block()
            self._current_block_type = "heading"
            self._current_heading_level = self._HEADING_TAGS[tag]
        elif tag == "pre":
            self._flush_block()
            self._in_pre = True
            self._current_block_type = "code"
            cls = attr_map.get("class", "")
            m = re.search(r"language-([A-Za-z0-9_+-]+)", cls)
            self._current_code_lang = m.group(1) if m else ""
        elif tag == "code":
            self._in_code = True
            if self._in_pre and not self._current_code_lang:
                cls = attr_map.get("class", "")
                m = re.search(r"(?:language-|sourceCode\s+)([A-Za-z0-9_+-]+)", cls)
                if m and m.group(1) not in {"sourceCode"}:
                    self._current_code_lang = m.group(1)
            elif not self._in_pre:
                if self._current_block_type is None:
                    self._current_block_type = "paragraph"
                self._current_buf.append("`")
        elif tag == "blockquote":
            self._flush_block()
            self._current_block_type = "blockquote"
        elif tag in {"ul", "ol"}:
            self._flush_block()
            self._list_ordered = tag == "ol"
            self._list_index = 0
        elif tag == "li":
            self._flush_block()
            self._in_li = True
            self._list_index += 1
            self._current_block_type = "list_item"
        elif tag == "p":
            if not self._in_pre and not self._in_table:
                self._flush_block()
                self._current_block_type = "paragraph"
        elif tag == "br":
            if self._current_block_type == "code":
                self._current_buf.append("\n")
            elif self._current_block_type:
                self._current_buf.append(" ")
        elif tag == "a" and not self._in_pre:
            href = attr_map.get("href", "").strip()
            if href and not href.startswith("#") and not href.lower().startswith("javascript:"):
                self._in_link_href = urljoin(self.base_url, href) if self.base_url else href
                self._in_link_buf.clear()
        elif tag == "table":
            self._flush_block()
            self._in_table = True
            self._table_rows = []
        elif tag == "tr" and self._in_table:
            self._current_row = []
        elif tag in {"td", "th"} and self._in_table:
            self._in_cell = True
            self._current_cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
            return
        if tag == "script":
            if self._in_json_ld:
                self._in_json_ld = False
                self.json_ld_raw.append("".join(self._json_ld_buf))
                self._json_ld_buf.clear()
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag in self._SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag in {"article", "main"}:
            self._flush_block()
            self._container_depth = max(0, self._container_depth - 1)
            return
        if tag == "body":
            self._flush_block()
            self._body_depth = max(0, self._body_depth - 1)
            return

        if self._active_target() is None:
            return

        if tag == "a" and self._in_link_href:
            link_text = re.sub(r"\s+", " ", "".join(self._in_link_buf)).strip()
            href = self._in_link_href
            self._in_link_href = ""
            self._in_link_buf.clear()
            if link_text:
                formatted = f"[{link_text}]({href})" if href.startswith(("http://", "https://")) else link_text
                if self._in_cell:
                    self._current_cell.append(formatted)
                else:
                    if self._current_block_type is None:
                        self._current_block_type = "paragraph"
                    self._current_buf.append(formatted)
            return

        if tag == "code":
            self._in_code = False
            if not self._in_pre:
                self._current_buf.append("`")
        elif tag == "pre":
            self._flush_block()
            self._in_pre = False
            self._current_code_lang = ""
        elif tag in self._HEADING_TAGS or tag in {"p", "blockquote"}:
            if not self._in_table and not self._in_li:
                self._flush_block()
        elif tag == "li":
            self._flush_block()
            self._in_li = False
        elif tag in {"td", "th"} and self._in_table:
            self._in_cell = False
            cell_text = re.sub(r"\s+", " ", "".join(self._current_cell)).strip()
            self._current_row.append(cell_text)
        elif tag == "tr" and self._in_table:
            if any(self._current_row):
                self._table_rows.append(self._current_row)
        elif tag == "table" and self._in_table:
            self._in_table = False
            target = self._active_target()
            if target is not None and self._table_rows:
                target.append({"type": "table", "rows": self._table_rows})
            self._table_rows = []

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.doc_title_parts.append(data)
            return
        if self._in_json_ld:
            self._json_ld_buf.append(data)
            return
        if self._active_target() is None:
            return
        if self._in_cell:
            self._current_cell.append(data)
            return
        if self._in_link_href:
            self._in_link_buf.append(data)
            return
        if self._current_block_type is None:
            if data.strip():
                self._current_block_type = "paragraph"
            else:
                return
        self._current_buf.append(data)


def _extract_json_ld_meta(raw_blocks: list[str]) -> tuple[str, str, str]:
    title, author, date = "", "", ""
    for raw in raw_blocks:
        try:
            data = json.loads(raw)
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for obj in items:
            if not isinstance(obj, dict):
                continue
            title = title or str(obj.get("headline") or obj.get("name") or "").strip()
            date = date or str(obj.get("datePublished") or obj.get("dateCreated") or "").strip()
            a = obj.get("author")
            if isinstance(a, dict):
                author = author or str(a.get("name") or "").strip()
            elif isinstance(a, list) and a and isinstance(a[0], dict):
                author = author or str(a[0].get("name") or "").strip()
            elif isinstance(a, str):
                author = author or a.strip()
    return title, author, date


def _blocks_to_markdown(blocks: list[dict[str, object]]) -> str:
    parts: list[str] = []
    for blk in blocks:
        btype = blk["type"]
        if btype == "heading":
            lvl = int(blk.get("level", 2))
            parts.append(f"{'#' * lvl} {blk['text']}")
        elif btype == "code":
            lang = blk.get("language") or ""
            parts.append(f"```{lang}\n{blk['text']}\n```")
        elif btype == "blockquote":
            parts.append(f"> {blk['text']}")
        elif btype == "list_item":
            parts.append(f"{blk.get('prefix', '- ')}{blk['text']}")
        elif btype == "table":
            rows = blk.get("rows") or []
            if rows:
                header = "| " + " | ".join(rows[0]) + " |"
                sep = "| " + " | ".join("---" for _ in rows[0]) + " |"
                body = ["| " + " | ".join(r) + " |" for r in rows[1:]]
                parts.append("\n".join([header, sep, *body]))
        else:
            parts.append(str(blk["text"]))
    return "\n\n".join(parts)


def extract_rich(html: str, url: str = "") -> ExtractedArticle:
    """Extract structured article content, real title, author, and publication date."""
    parser = RichArticleParser(base_url=url)
    parser.feed(html)
    parser._flush_block()

    blocks = parser.blocks_main if (parser.found_main and parser.blocks_main) else parser.blocks_body
    if not blocks:
        raise ValueError("No extractable article content found in HTML")

    ld_title, ld_author, ld_date = _extract_json_ld_meta(parser.json_ld_raw)
    h1_title = next((str(b["text"]) for b in blocks if b["type"] == "heading" and b.get("level") == 1), "")
    doc_title = re.sub(r"\s+", " ", "".join(parser.doc_title_parts)).strip()

    raw_title = (
        parser.meta.get("og:title")
        or parser.meta.get("twitter:title")
        or h1_title
        or ld_title
        or doc_title
        or (urlsplit(url).hostname if url else "")
        or "Başlıksız Makale"
    )
    title = raw_title.strip()
    if h1_title and len(h1_title) > 6 and title != h1_title and h1_title.lower() in title.lower():
        title = h1_title

    author = (
        parser.meta.get("author")
        or parser.meta.get("article:author")
        or ld_author
        or ""
    ).strip()

    published_at = (
        parser.meta.get("article:published_time")
        or parser.meta.get("dcterms.date")
        or parser.meta.get("date")
        or parser.meta.get("pubdate")
        or ld_date
        or ""
    ).strip()

    text = _blocks_to_markdown(blocks)
    if not text.strip():
        raise ValueError("Extracted article text is empty")

    return ExtractedArticle(
        title=title[:300],
        author=author[:200],
        published_at=published_at[:64],
        text=text,
        blocks=blocks,
        language_hint=parser.html_lang or "en",
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("html", type=Path)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    if args.html.stat().st_size > 5_000_000:
        p.error("HTML exceeds 5 MB")
    result = extract(args.html.read_text(encoding="utf-8"))
    with args.output.open("x", encoding="utf-8") as f:
        f.write(result)


if __name__ == "__main__":
    main()
