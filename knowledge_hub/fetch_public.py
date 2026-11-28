"""Explicit HTTPS GET only. Resolve once and pin public IP, verify hostname TLS.

No cookies, authentication, proxy, or background requests. Redirects are disabled
by default in fetch_public(), and safe hop-validated HTTPS redirects (max 2) are
available for explicit user-triggered article/feed imports.
"""
from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import ssl
from urllib.parse import urljoin, urlsplit
import zlib

_META_REFRESH_RE = re.compile(
    r'<meta[^>]+http-equiv=["\']refresh["\'][^>]+content=["\'][^"\']*url=([^"\';\s>]+)',
    re.I,
)
_QUARTO_REDIRECT_RE = re.compile(r'var\s+redirects\s*=\s*\{\s*""\s*:\s*"([^"]+)"', re.I)


def resolve_public(url: str) -> tuple[str, str, str]:
    if any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise ValueError("Invalid URL characters")
    p = urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.port not in (None, 443) or p.fragment:
        raise ValueError("Only public HTTPS on port 443 is supported")
    hostname = p.hostname.encode("idna").decode("ascii")
    addresses = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    ips = [row[4][0] for row in addresses]
    if not ips or any(
        not ipaddress.ip_address(ip.split("%")[0]).is_global
        or ipaddress.ip_address(ip.split("%")[0]).is_multicast
        for ip in ips
    ):
        raise ValueError("Nonpublic destination")
    return hostname, ips[0], (p.path or "/") + ("?" + p.query if p.query else "")


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host: str, ip: str, timeout: int = 12):
        super().__init__(host, 443, timeout=timeout, context=ssl.create_default_context())
        self.ip = ip

    def connect(self):
        raw = socket.create_connection((self.ip, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def _decode_body(raw: bytes, content_encoding: str, content_type: str, max_bytes: int) -> str:
    enc = (content_encoding or "identity").lower().strip()
    if enc == "gzip":
        decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = decompressor.decompress(raw, max_bytes + 1)
        if len(raw) > max_bytes or decompressor.unconsumed_tail:
            raise ValueError("Decompressed response exceeds size limit")
    elif enc == "deflate":
        decompressor = zlib.decompressobj()
        raw = decompressor.decompress(raw, max_bytes + 1)
        if len(raw) > max_bytes or decompressor.unconsumed_tail:
            raise ValueError("Decompressed response exceeds size limit")
    elif enc != "identity":
        raise ValueError("Compressed response not supported")

    charset = "utf-8-sig"
    m = re.search(r"charset=([A-Za-z0-9_.-]+)", content_type or "", re.I)
    if m and m.group(1).lower() not in {"utf-8", "utf8"}:
        charset = m.group(1)
    try:
        return raw.decode(charset, errors="strict")
    except (UnicodeDecodeError, LookupError):
        return raw.decode("utf-8-sig", errors="replace")


def fetch_public(url: str, expected: str, *, max_redirects: int = 0) -> str:
    """Fetch public HTTPS HTML/XML safely. Returns decoded string."""
    text, _ = fetch_public_with_final_url(url, expected, max_redirects=max_redirects)
    return text


def fetch_public_with_final_url(url: str, expected: str, *, max_redirects: int = 0) -> tuple[str, str]:
    """Fetch public HTTPS HTML/XML and return (decoded_text, final_url)."""
    if expected not in ("html", "xml"):
        raise ValueError("Invalid expected type")

    current_url = url
    for _hop in range(max_redirects + 1):
        hostname, ip, path = resolve_public(current_url)
        conn = PinnedHTTPS(hostname, ip)
        try:
            accept = (
                "text/html,application/xhtml+xml"
                if expected == "html"
                else "application/rss+xml, application/atom+xml, text/xml, application/xml"
            )
            conn.request(
                "GET",
                path,
                headers={
                    "User-Agent": "KnowledgeHubAI/0.5 personal-reader",
                    "Accept-Encoding": "identity",
                    "Accept": accept,
                },
            )
            res = conn.getresponse()
            if res.status in (301, 302, 303, 307, 308) and max_redirects > 0:
                location = res.getheader("Location")
                if not location:
                    raise ValueError("Redirect without Location header")
                current_url = urljoin(current_url, location)
                continue
            if res.status != 200:
                raise ValueError("Only HTTP 200 accepted; redirects disabled")
            ce = res.getheader("Content-Encoding", "identity").lower().strip()
            if ce != "identity" and max_redirects == 0:
                raise ValueError("Compressed response not supported")
            ct_raw = res.getheader("Content-Type", "")
            typ = ct_raw.split(";")[0].lower().strip()
            allowed = (
                {"text/html", "application/xhtml+xml"}
                if expected == "html"
                else {"application/rss+xml", "application/atom+xml", "application/xml", "text/xml"}
            )
            if typ not in allowed:
                raise ValueError("Unexpected MIME type")
            max_bytes = 3_000_000 if expected == "html" else 2_500_000
            body = res.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError("Response exceeds size limit")
            text = _decode_body(body, ce, ct_raw, max_bytes)

            if expected == "html" and max_redirects > 0 and len(text) < 4096:
                m = _META_REFRESH_RE.search(text) or _QUARTO_REDIRECT_RE.search(text)
                if m:
                    next_url = urljoin(current_url, m.group(1).strip())
                    if next_url != current_url:
                        current_url = next_url
                        continue
            return text, current_url
        finally:
            conn.close()
    raise ValueError("Too many redirects")


def fetch_public_binary(url: str, *, max_bytes: int = 100_000_000, max_redirects: int = 3) -> tuple[bytes, str, str]:
    """Fetch an authorized public HTTPS audio file safely with SSRF and size checks."""
    current_url = url
    for _ in range(max_redirects + 1):
        hostname, ip, path = resolve_public(current_url)
        conn = PinnedHTTPS(hostname, ip, timeout=30)
        try:
            conn.request(
                "GET",
                path,
                headers={
                    "User-Agent": "KnowledgeHubAI/0.5 personal-reader",
                    "Accept": "audio/*, application/octet-stream",
                },
            )
            res = conn.getresponse()
            if res.status in (301, 302, 303, 307, 308):
                location = res.getheader("Location")
                if not location:
                    raise ValueError("Redirect without Location header")
                current_url = urljoin(current_url, location)
                continue
            if res.status != 200:
                raise ValueError(f"Unexpected HTTP status {res.status}")
            ct = res.getheader("Content-Type", "").split(";")[0].lower().strip()
            if not (ct.startswith("audio/") or ct in {"application/octet-stream", "binary/octet-stream", "video/mp4"}):
                raise ValueError(f"Unsupported audio MIME type: {ct}")
            data = res.read(max_bytes + 1)
            if len(data) > max_bytes or not data:
                raise ValueError("Audio exceeds maximum allowed size or is empty")
            return data, ct, current_url
        finally:
            conn.close()
    raise ValueError("Too many redirects")
