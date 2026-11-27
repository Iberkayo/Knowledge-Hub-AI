"""Tests for rich HTML extraction, Quarto/meta-refresh redirects, SSRF protection, and Discover."""
from __future__ import annotations

import socket

from fastapi.testclient import TestClient
import pytest

from knowledge_hub import discover, fetch_public as fp
from knowledge_hub.ingest import extract_rich
from knowledge_hub.library import Library
from knowledge_hub.server import create_app


# --- Rich HTML extraction tests ---


def test_extract_rich_metadata_structure_and_xss_sanitization():
    html = """<!doctype html>
<html lang="en-US">
<head>
  <title>Scaling Laws | Research Blog</title>
  <meta property="og:title" content="Scaling Laws — Research Blog">
  <meta name="author" content="Jane Researcher">
  <meta property="article:published_time" content="2026-03-10T08:00:00Z">
  <script type="application/ld+json">
    {"@type": "Article", "headline": "JSON-LD Headline", "author": {"name": "LD Author"}, "datePublished": "2026-03-09"}
  </script>
</head>
<body>
  <nav><a href="/home">Navigation Link Should Disappear</a></nav>
  <main>
    <article>
      <h1>Scaling Laws</h1>
      <p>Intro paragraph with <code>inline_var</code> and <a href="https://example.com/paper">paper link</a>.</p>
      <script>alert('xss_payload_must_not_leak');</script>
      <style>.hidden { display: none; }</style>
      <pre><code class="language-python">def loss(n):
    return n ** -0.076</code></pre>
      <ul>
        <li>First bullet</li>
        <li>Second bullet</li>
      </ul>
      <table>
        <tr><th>Model</th><th>Score</th></tr>
        <tr><td>Small</td><td>81.2</td></tr>
        <tr><td>Large</td><td>92.4</td></tr>
      </table>
      <aside>Sidebar promo text</aside>
    </article>
  </main>
  <footer>Copyright footer</footer>
</body>
</html>"""

    art = extract_rich(html, url="https://example.com/blog/scaling")
    assert art.title == "Scaling Laws"
    assert art.author == "Jane Researcher"
    assert art.published_at == "2026-03-10T08:00:00Z"
    assert art.language_hint == "en"

    block_types = [b["type"] for b in art.blocks]
    assert "heading" in block_types
    assert "paragraph" in block_types
    assert "code" in block_types
    assert "list_item" in block_types
    assert "table" in block_types

    # Markdown output includes code fence, list, table, and link
    assert "```python\ndef loss(n):\n    return n ** -0.076\n```" in art.text
    assert "- First bullet" in art.text
    assert "| Model | Score |" in art.text
    assert "| Large | 92.4 |" in art.text
    assert "[paper link](https://example.com/paper)" in art.text

    # Nav, footer, aside, style, and XSS script content must never leak
    for forbidden in (
        "Navigation Link Should Disappear",
        "xss_payload_must_not_leak",
        "alert(",
        ".hidden",
        "Sidebar promo text",
        "Copyright footer",
    ):
        assert forbidden not in art.text


def test_extract_rich_falls_back_to_json_ld_author_and_date():
    html = """<html><head>
      <script type="application/ld+json">
        {"@type": "BlogPosting", "headline": "From JSON-LD", "author": [{"name": "Ada Lovelace"}], "datePublished": "2026-02-01"}
      </script>
    </head><body><article><p>Body paragraph text here.</p></article></body></html>"""

    art = extract_rich(html)
    assert art.title == "From JSON-LD"
    assert art.author == "Ada Lovelace"
    assert art.published_at == "2026-02-01"


# --- fetch_public Quarto JS redirect, meta-refresh, and SSRF tests ---


class _FakeHTTPResponse:
    def __init__(self, status: int, body: bytes, headers: dict[str, str]):
        self.status = status
        self._body = body
        self._headers = {k.lower(): v for k, v in headers.items()}

    def getheader(self, name: str, default=None):
        return self._headers.get(name.lower(), default)

    def read(self, n: int = -1) -> bytes:
        return self._body[:n] if n >= 0 else self._body


def _install_fake_https(monkeypatch, routes: dict[tuple[str, str], _FakeHTTPResponse], ip_map: dict[str, str] | None = None):
    ip_map = ip_map or {}

    def _fake_getaddrinfo(host, port, *args, **kwargs):
        ip = ip_map.get(host, "93.184.216.34")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    class _FakeConn:
        def __init__(self, host: str, ip: str, timeout: int = 12):
            self.host = host
            self.ip = ip
            self._path = "/"

        def request(self, method: str, path: str, headers=None):
            self._path = path

        def getresponse(self):
            key = (self.host, self._path)
            if key not in routes:
                raise AssertionError(f"Unexpected request to {key}")
            return routes[key]

        def close(self):
            pass

    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo)
    monkeypatch.setattr(fp, "PinnedHTTPS", _FakeConn)


def test_fetch_public_quarto_js_redirect(monkeypatch):
    quarto_stub = b'<html><head><script>var redirects = {"": "posts/real-article.html"};</script></head><body></body></html>'
    real_html = b"<html><body><article><h1>Real Quarto Post</h1><p>Content body.</p></article></body></html>"

    _install_fake_https(
        monkeypatch,
        {
            ("hamel.dev", "/blog/"): _FakeHTTPResponse(200, quarto_stub, {"Content-Type": "text/html; charset=utf-8"}),
            ("hamel.dev", "/blog/posts/real-article.html"): _FakeHTTPResponse(200, real_html, {"Content-Type": "text/html; charset=utf-8"}),
        },
    )

    text, final_url = fp.fetch_public_with_final_url("https://hamel.dev/blog/", expected="html", max_redirects=2)
    assert "Real Quarto Post" in text
    assert final_url == "https://hamel.dev/blog/posts/real-article.html"


def test_fetch_public_meta_refresh_redirect(monkeypatch):
    refresh_stub = b'<html><head><meta http-equiv="refresh" content="0;url=/articles/target"></head><body></body></html>'
    target_html = b"<html><body><article><h1>Target Page</h1><p>Arrived safely.</p></article></body></html>"

    _install_fake_https(
        monkeypatch,
        {
            ("example.org", "/old"): _FakeHTTPResponse(200, refresh_stub, {"Content-Type": "text/html"}),
            ("example.org", "/articles/target"): _FakeHTTPResponse(200, target_html, {"Content-Type": "text/html"}),
        },
    )

    text, final_url = fp.fetch_public_with_final_url("https://example.org/old", expected="html", max_redirects=2)
    assert "Arrived safely." in text
    assert final_url == "https://example.org/articles/target"


def test_fetch_public_redirect_to_private_ip_blocked_by_ssrf(monkeypatch):
    evil_refresh = b'<html><head><meta http-equiv="refresh" content="0;url=https://internal.local/admin"></head></html>'
    _install_fake_https(
        monkeypatch,
        {
            ("example.org", "/start"): _FakeHTTPResponse(200, evil_refresh, {"Content-Type": "text/html"}),
        },
        ip_map={"example.org": "93.184.216.34", "internal.local": "127.0.0.1"},
    )

    with pytest.raises(ValueError, match="Nonpublic destination"):
        fp.fetch_public_with_final_url("https://example.org/start", expected="html", max_redirects=2)


# --- Discover tests ---


SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Research Feed</title>
    <item>
      <title>Eval Driven Development</title>
      <link>https://example.com/posts/evals</link>
      <guid>guid-evals-1</guid>
      <description>How to build reliable evals.</description>
    </item>
    <item>
      <title>Inference Optimization</title>
      <link>https://example.com/posts/inference</link>
      <guid>guid-inf-2</guid>
      <description>Quantization and KV cache notes.</description>
    </item>
  </channel>
</rss>"""


def test_discover_curated_sources_add_delete_dedup_and_read_state(tmp_path, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 443))])

    db = tmp_path / "discover.sqlite3"
    lib = Library(db)
    client = TestClient(create_app(db, secrets_path=tmp_path / ".secrets.json"))

    # Curated sources are pre-seeded
    curated = discover.list_sources(lib)
    assert len(curated) >= 10
    names = {s["name"] for s in curated}
    assert "Lilian Weng" in names
    assert "Andrej Karpathy" in names
    assert client.get("/api/sources").status_code == 200

    # Add custom source
    added_src = discover.add_source(lib, "Custom AI Blog", "https://example.com/rss.xml", category="Özel", kind="article")
    src_id = str(added_src["id"])
    assert added_src["name"] == "Custom AI Blog"

    # Ingest same XML twice -> second run skips duplicates
    first_ingest = discover.ingest_feed_xml(lib, src_id, SAMPLE_RSS)
    assert first_ingest["added"] == 2
    assert first_ingest["duplicates_skipped"] == 0
    assert first_ingest["total_parsed"] == 2

    second_ingest = discover.ingest_feed_xml(lib, src_id, SAMPLE_RSS)
    assert second_ingest["added"] == 0
    assert second_ingest["duplicates_skipped"] == 2

    entries = discover.list_entries(lib, source_id=src_id, unread_only=True)
    assert len(entries) == 2

    # Mark one entry read
    entry_id = str(entries[0]["id"])
    updated_entry = discover.mark_entry_read(lib, entry_id, is_read=True)
    assert updated_entry["is_read"] == 1
    assert len(discover.list_entries(lib, source_id=src_id, unread_only=True)) == 1

    # Delete source cascades cleanly
    discover.delete_source(lib, src_id)
    assert discover.list_entries(lib, source_id=src_id) == []
    with pytest.raises(KeyError):
        discover.delete_source(lib, src_id)
