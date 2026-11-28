"""RSS/Atom discovery management with duplicate detection and explicit opt-in fetching."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from knowledge_hub.feed import parse_feed
from knowledge_hub.fetch_public import fetch_public_with_final_url, resolve_public
from knowledge_hub.ingest import extract_rich
from knowledge_hub.library import Library


def normalize_entry_hash(url: str, guid: str, title: str) -> str:
    raw = (url or "").strip()
    if raw:
        p = urlsplit(raw)
        clean = urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path.rstrip("/") or "/", p.query, ""))
    else:
        clean = (guid or title).strip()
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()


def list_sources(lib: Library) -> list[dict[str, object]]:
    with lib.connect() as db:
        rows = db.execute(
            """SELECT s.*,
                      (SELECT COUNT(*) FROM feed_entries e WHERE e.source_id=s.id) AS entry_count,
                      (SELECT COUNT(*) FROM feed_entries e WHERE e.source_id=s.id AND e.is_read=0) AS unread_count
               FROM sources s ORDER BY s.category ASC, s.name ASC"""
        ).fetchall()
    return [dict(r) for r in rows]


def add_source(lib: Library, name: str, url: str, category: str = "Özel", kind: str = "article") -> dict[str, object]:
    resolve_public(url)
    if kind not in ("article", "podcast"):
        kind = "article"
    sid = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    with lib.connect() as db:
        existing = db.execute("SELECT * FROM sources WHERE url=?", (url.strip(),)).fetchone()
        if existing:
            return dict(existing)
        db.execute(
            "INSERT INTO sources(id, name, url, category, kind, enabled, created_at) VALUES(?,?,?,?,?,1,?)",
            (sid, name.strip()[:200], url.strip()[:2000], category.strip()[:100], kind, now),
        )
        return dict(db.execute("SELECT * FROM sources WHERE id=?", (sid,)).fetchone())


def delete_source(lib: Library, source_id: str) -> None:
    with lib.connect() as db:
        cur = db.execute("DELETE FROM sources WHERE id=?", (source_id,))
        if cur.rowcount == 0:
            raise KeyError(source_id)


def ingest_feed_xml(lib: Library, source_id: str, xml: str) -> dict[str, object]:
    entries = parse_feed(xml)
    now = datetime.now(timezone.utc).isoformat()
    added = 0
    skipped_duplicates = 0
    with lib.connect() as db:
        src = db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
        if not src:
            raise KeyError(source_id)
        for entry in entries:
            uhash = normalize_entry_hash(entry["url"], entry["guid"], entry["title"])
            cur = db.execute(
                """INSERT OR IGNORE INTO feed_entries(
                    id, source_id, title, url, audio_url, author, published_at, summary, guid, url_hash, discovered_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    uuid4().hex,
                    source_id,
                    entry["title"] or "Başlıksız Yayın",
                    entry["url"],
                    entry["audio"],
                    entry["author"],
                    entry["published_at"],
                    entry["summary"],
                    entry["guid"],
                    uhash,
                    now,
                ),
            )
            if cur.rowcount:
                added += 1
            else:
                skipped_duplicates += 1
        db.execute(
            "UPDATE sources SET last_checked_at=?, last_status='ok', last_error='' WHERE id=?",
            (now, source_id),
        )
    return {"source_id": source_id, "added": added, "duplicates_skipped": skipped_duplicates, "total_parsed": len(entries)}


def refresh_source(lib: Library, source_id: str) -> dict[str, object]:
    with lib.connect() as db:
        src = db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
        if not src:
            raise KeyError(source_id)
        url = src["url"]
    now = datetime.now(timezone.utc).isoformat()
    try:
        xml, _ = fetch_public_with_final_url(url, expected="xml", max_redirects=2)
        return ingest_feed_xml(lib, source_id, xml)
    except Exception as exc:
        with lib.connect() as db:
            db.execute(
                "UPDATE sources SET last_checked_at=?, last_status='error', last_error=? WHERE id=?",
                (now, str(exc)[:300], source_id),
            )
        raise


def list_entries(lib: Library, *, source_id: str | None = None, unread_only: bool = False, limit: int = 120) -> list[dict[str, object]]:
    clauses = []
    params: list[object] = []
    if source_id:
        clauses.append("e.source_id = ?")
        params.append(source_id)
    if unread_only:
        clauses.append("e.is_read = 0")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    with lib.connect() as db:
        rows = db.execute(
            f"""SELECT e.*, s.name AS source_name, s.category AS source_category, s.kind AS source_kind
                FROM feed_entries e
                JOIN sources s ON s.id = e.source_id
                {where}
                ORDER BY e.discovered_at DESC LIMIT ?""",
            tuple(params),
        ).fetchall()
    return [dict(r) for r in rows]


def mark_entry_read(lib: Library, entry_id: str, is_read: bool = True) -> dict[str, object]:
    with lib.connect() as db:
        cur = db.execute("UPDATE feed_entries SET is_read=? WHERE id=?", (int(is_read), entry_id))
        if cur.rowcount == 0:
            raise KeyError(entry_id)
        return dict(db.execute("SELECT * FROM feed_entries WHERE id=?", (entry_id,)).fetchone())


def import_feed_entry(lib: Library, entry_id: str) -> dict[str, object]:
    """Import a discovered entry into the Library (metadata-only or full article fetch; never auto-translates)."""
    with lib.connect() as db:
        row = db.execute(
            """SELECT e.*, s.category AS source_category, s.kind AS source_kind
               FROM feed_entries e JOIN sources s ON s.id = e.source_id
               WHERE e.id=?""",
            (entry_id,),
        ).fetchone()
    if not row:
        raise KeyError(entry_id)
    entry = dict(row)
    if entry.get("imported_item_id"):
        try:
            return lib.get(str(entry["imported_item_id"]))
        except KeyError:
            pass

    url = str(entry.get("url") or "")
    audio_url = str(entry.get("audio_url") or "")
    kind = "podcast" if (audio_url or entry.get("source_kind") == "podcast") else "article"

    if kind == "article" and url.startswith("https://"):
        html, final_url = fetch_public_with_final_url(url, expected="html", max_redirects=2)
        extracted = extract_rich(html, url=final_url)
        item = lib.add(
            extracted.title or entry["title"],
            final_url,
            "article",
            extracted.text,
            author=extracted.author or entry["author"],
            published_at=extracted.published_at or entry["published_at"],
            category=str(entry.get("source_category") or ""),
            source_lang=extracted.language_hint,
            structured_blocks=extracted.blocks,
        )
    else:
        body = entry.get("summary") or f"Podcast bölümü: {entry['title']}\nKaynak: {url or audio_url}"
        item = lib.add(
            str(entry["title"]),
            audio_url or url,
            kind,
            body,
            author=str(entry.get("author") or ""),
            published_at=str(entry.get("published_at") or ""),
            category=str(entry.get("source_category") or ""),
        )

    with lib.connect() as db:
        db.execute("UPDATE feed_entries SET imported_item_id=?, is_read=1 WHERE id=?", (item["id"], entry_id))
    return item
