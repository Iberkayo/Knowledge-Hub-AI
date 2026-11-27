"""Local persistent SQLite library with backward-compatible migrations."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from knowledge_hub.glossary import DEFAULT_GLOSSARY

DEFAULT_SETTINGS: dict[str, object] = {
    "theme": "dark",
    "translation_provider": "openrouter",
    "translation_model": "openai/gpt-4o-mini",
    "openrouter_base_url": "https://openrouter.ai/api/v1",
    "openai_base_url": "https://api.openai.com/v1",
    "custom_base_url": "http://127.0.0.1:11434/v1",
    "default_target_lang": "tr",
    "default_translation_mode": "faithful",
    "monthly_spend_limit_usd": 10.0,
    "tts_provider": "browser",
    "elevenlabs_model": "eleven_flash_v2_5",
    "elevenlabs_voice_id": "",
    "elevenlabs_voice_name": "",
    "elevenlabs_char_budget": 10000,
    "whisper_model": "small",
    "whisper_device": "cpu",
    "whisper_auto_language": True,
    "whisper_allow_download": False,
    "auto_refresh_feeds": False,
    "semantic_qa_enabled": False,
}

# Verified official RSS/Atom feeds (no invented URLs)
CURATED_SOURCES: list[dict[str, str]] = [
    {"name": "Lilian Weng", "url": "https://lilianweng.github.io/index.xml", "category": "Araştırmacılar", "kind": "article"},
    {"name": "Andrej Karpathy", "url": "https://karpathy.github.io/feed.xml", "category": "Araştırmacılar", "kind": "article"},
    {"name": "Andrej Karpathy (Bearblog)", "url": "https://karpathy.bearblog.dev/feed/", "category": "Araştırmacılar", "kind": "article"},
    {"name": "Eugene Yan", "url": "https://eugeneyan.com/rss.xml", "category": "Araştırmacılar", "kind": "article"},
    {"name": "Chip Huyen", "url": "https://huyenchip.com/feed.xml", "category": "Araştırmacılar", "kind": "article"},
    {"name": "Hamel Husain", "url": "https://hamel.dev/index.xml", "category": "Araştırmacılar", "kind": "article"},
    {"name": "Felix Rieseberg", "url": "https://felixrieseberg.com/rss/", "category": "Araştırmacılar", "kind": "article"},
    {"name": "Simon Willison", "url": "https://simonwillison.net/atom/everything/", "category": "Araştırmacılar", "kind": "article"},
    {"name": "OpenAI News", "url": "https://openai.com/news/rss.xml", "category": "Kurumsal Kaynaklar", "kind": "article"},
    {"name": "Google DeepMind Blog", "url": "https://deepmind.google/blog/rss.xml", "category": "Kurumsal Kaynaklar", "kind": "article"},
    {"name": "Hugging Face Blog", "url": "https://huggingface.co/blog/feed.xml", "category": "Kurumsal Kaynaklar", "kind": "article"},
    {"name": "Latent Space", "url": "https://www.latent.space/feed", "category": "Podcastlar", "kind": "podcast"},
    {"name": "No Priors", "url": "https://feeds.megaphone.fm/nopriors", "category": "Podcastlar", "kind": "podcast"},
    {"name": "Dwarkesh Podcast", "url": "https://www.dwarkesh.com/feed", "category": "Podcastlar", "kind": "podcast"},
    {"name": "The TWIML AI Podcast", "url": "https://twimlai.com/feed/", "category": "Podcastlar", "kind": "podcast"},
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _estimate_reading_minutes(text: str) -> int:
    words = len(text.split())
    return max(1, round(words / 200)) if words else 0


class Library:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.media_dir = self.path.parent / "media"
        self.audio_dir = self.path.parent / "audio"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _init_schema(self) -> None:
        with self.connect() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS items (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    source TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    original TEXT NOT NULL,
                    translated TEXT,
                    mode TEXT,
                    created TEXT NOT NULL,
                    position REAL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'imported'
                )"""
            )
            columns = {row[1] for row in db.execute("PRAGMA table_info(items)")}
            extra_item_cols = (
                ("favorite", "INTEGER DEFAULT 0"),
                ("notes", "TEXT DEFAULT ''"),
                ("category", "TEXT DEFAULT ''"),
                ("author", "TEXT DEFAULT ''"),
                ("published_at", "TEXT DEFAULT ''"),
                ("source_lang", "TEXT DEFAULT ''"),
                ("target_lang", "TEXT DEFAULT 'tr'"),
                ("translation_mode", "TEXT DEFAULT 'faithful'"),
                ("translation_provider", "TEXT DEFAULT ''"),
                ("translation_model", "TEXT DEFAULT ''"),
                ("source_hash", "TEXT DEFAULT ''"),
                ("word_count", "INTEGER DEFAULT 0"),
                ("reading_minutes", "INTEGER DEFAULT 0"),
                ("listening_minutes", "INTEGER DEFAULT 0"),
                ("audio_path", "TEXT DEFAULT ''"),
                ("source_audio_path", "TEXT DEFAULT ''"),
                ("audio_status", "TEXT DEFAULT 'none'"),
                ("audio_provider", "TEXT DEFAULT ''"),
                ("audio_model", "TEXT DEFAULT ''"),
                ("audio_voice", "TEXT DEFAULT ''"),
                ("audio_duration_sec", "REAL DEFAULT 0"),
                ("audio_position_sec", "REAL DEFAULT 0"),
                ("highlights_json", "TEXT DEFAULT '[]'"),
                ("transcript_json", "TEXT DEFAULT '[]'"),
                ("structured_json", "TEXT DEFAULT '[]'"),
                ("is_read", "INTEGER DEFAULT 0"),
                ("updated_at", "TEXT DEFAULT ''"),
            )
            for name, definition in extra_item_cols:
                if name not in columns:
                    db.execute(f"ALTER TABLE items ADD COLUMN {name} {definition}")

            db.execute(
                """CREATE TABLE IF NOT EXISTS content_segments (
                    item_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    block_type TEXT NOT NULL DEFAULT 'paragraph',
                    original_text TEXT NOT NULL,
                    translated_text TEXT DEFAULT '',
                    start_sec REAL,
                    end_sec REAL,
                    warnings_json TEXT DEFAULT '[]',
                    cache_key TEXT DEFAULT '',
                    PRIMARY KEY (item_id, seq),
                    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS translation_cache (
                    cache_key TEXT PRIMARY KEY,
                    source_hash TEXT NOT NULL,
                    source_lang TEXT NOT NULL,
                    target_lang TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt_version TEXT NOT NULL,
                    glossary_version INTEGER NOT NULL,
                    mode TEXT NOT NULL,
                    segmentation_version TEXT NOT NULL,
                    segments_json TEXT NOT NULL,
                    translated_text TEXT NOT NULL,
                    input_tokens INTEGER DEFAULT 0,
                    output_tokens INTEGER DEFAULT 0,
                    cost_usd REAL DEFAULT 0,
                    created_at TEXT NOT NULL
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS audio_cache (
                    cache_key TEXT PRIMARY KEY,
                    text_hash TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    voice TEXT NOT NULL,
                    format TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    chars_used INTEGER DEFAULT 0,
                    reported_cost TEXT DEFAULT '',
                    duration_sec REAL DEFAULT 0,
                    created_at TEXT NOT NULL
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL UNIQUE,
                    category TEXT DEFAULT '',
                    kind TEXT NOT NULL DEFAULT 'article',
                    enabled INTEGER DEFAULT 1,
                    last_checked_at TEXT DEFAULT '',
                    last_status TEXT DEFAULT 'idle',
                    last_error TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS feed_entries (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    audio_url TEXT DEFAULT '',
                    author TEXT DEFAULT '',
                    published_at TEXT DEFAULT '',
                    summary TEXT DEFAULT '',
                    guid TEXT DEFAULT '',
                    url_hash TEXT NOT NULL,
                    is_read INTEGER DEFAULT 0,
                    imported_item_id TEXT DEFAULT '',
                    discovered_at TEXT NOT NULL,
                    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
                )"""
            )
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_entries_dedup ON feed_entries(source_id, url_hash)")
            db.execute(
                """CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    item_id TEXT DEFAULT '',
                    job_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    progress REAL DEFAULT 0,
                    processed_segments INTEGER DEFAULT 0,
                    total_segments INTEGER DEFAULT 0,
                    provider TEXT DEFAULT '',
                    model TEXT DEFAULT '',
                    cache_hits INTEGER DEFAULT 0,
                    estimated_cost REAL DEFAULT 0,
                    actual_cost REAL DEFAULT 0,
                    error_message TEXT DEFAULT '',
                    payload_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    started_at TEXT DEFAULT '',
                    finished_at TEXT DEFAULT ''
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS glossary (
                    id TEXT PRIMARY KEY,
                    term_en TEXT NOT NULL UNIQUE,
                    term_tr TEXT NOT NULL,
                    context_note TEXT DEFAULT '',
                    keep_english_parens INTEGER DEFAULT 1,
                    version INTEGER DEFAULT 1,
                    updated_at TEXT NOT NULL
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS usage_events (
                    id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT DEFAULT '',
                    input_tokens INTEGER DEFAULT 0,
                    output_tokens INTEGER DEFAULT 0,
                    characters INTEGER DEFAULT 0,
                    cost_usd REAL DEFAULT 0,
                    item_id TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )"""
            )

            # Seed default settings if missing
            now = _now_iso()
            for k, v in DEFAULT_SETTINGS.items():
                db.execute(
                    "INSERT OR IGNORE INTO app_settings(key, value_json, updated_at) VALUES(?,?,?)",
                    (k, json.dumps(v), now),
                )
            # Seed default glossary only when empty
            if db.execute("SELECT COUNT(*) FROM glossary").fetchone()[0] == 0:
                for entry in DEFAULT_GLOSSARY:
                    db.execute(
                        "INSERT OR IGNORE INTO glossary(id, term_en, term_tr, context_note, keep_english_parens, version, updated_at) VALUES(?,?,?,?,?,1,?)",
                        (
                            uuid4().hex,
                            entry["term_en"],
                            entry["term_tr"],
                            entry.get("context_note", ""),
                            int(bool(entry.get("keep_english_parens", True))),
                            now,
                        ),
                    )
            # Seed curated official RSS sources only when empty
            if db.execute("SELECT COUNT(*) FROM sources").fetchone()[0] == 0:
                for src in CURATED_SOURCES:
                    db.execute(
                        "INSERT OR IGNORE INTO sources(id, name, url, category, kind, enabled, created_at) VALUES(?,?,?,?,?,1,?)",
                        (uuid4().hex, src["name"], src["url"], src["category"], src["kind"], now),
                    )

    # --- Items ---

    def add(
        self,
        title: str,
        source: str,
        kind: str,
        original: str,
        *,
        author: str = "",
        published_at: str = "",
        category: str = "",
        source_lang: str = "",
        structured_blocks: list[dict[str, object]] | None = None,
        transcript_segments: list[dict[str, object]] | None = None,
        source_audio_path: str = "",
    ) -> dict[str, object]:
        if kind not in ("article", "podcast", "document") or not title.strip() or not original.strip():
            raise ValueError("Invalid content")
        identifier = uuid4().hex
        now = _now_iso()
        words = len(original.split())
        read_min = _estimate_reading_minutes(original)
        listen_min = max(1, round(words / 145)) if words else 0
        with self.connect() as db:
            db.execute(
                """INSERT INTO items(
                    id, title, source, kind, original, created, updated_at,
                    author, published_at, category, source_lang, source_hash,
                    word_count, reading_minutes, listening_minutes,
                    structured_json, transcript_json, source_audio_path
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    identifier,
                    title.strip()[:300],
                    source.strip()[:2000],
                    kind,
                    original,
                    now,
                    now,
                    author.strip()[:200],
                    published_at.strip()[:64],
                    category.strip()[:100],
                    source_lang.strip()[:16],
                    _sha256(original),
                    words,
                    read_min,
                    listen_min,
                    json.dumps(structured_blocks or [], ensure_ascii=False),
                    json.dumps(transcript_segments or [], ensure_ascii=False),
                    source_audio_path,
                ),
            )
        return self.get(identifier)

    def get(self, identifier: str) -> dict[str, object]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM items WHERE id=?", (identifier,)).fetchone()
            if row is None:
                raise KeyError(identifier)
            segs = [
                dict(s)
                for s in db.execute(
                    "SELECT seq, block_type, original_text, translated_text, start_sec, end_sec, warnings_json FROM content_segments WHERE item_id=? ORDER BY seq ASC",
                    (identifier,),
                )
            ]
        data = dict(row)
        data["segments"] = segs
        return data

    def list(self) -> list[dict[str, object]]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT id, title, source, kind, created, updated_at, status, mode, position,
                          favorite, category, author, published_at, source_lang, target_lang,
                          translation_mode, translation_provider, translation_model,
                          word_count, reading_minutes, listening_minutes,
                          audio_status, audio_provider, audio_model, audio_duration_sec,
                          audio_position_sec, is_read, source_audio_path, audio_path
                   FROM items ORDER BY created DESC"""
            ).fetchall()
            return [dict(row) for row in rows]

    def complete(
        self,
        identifier: str,
        text: str,
        mode: str,
        *,
        translation_mode: str = "faithful",
        provider: str = "",
        model: str = "",
        source_lang: str = "",
        segments: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        if mode not in ("demo", "live", "mock") or not text.strip():
            raise ValueError("Invalid translation")
        self.get(identifier)
        now = _now_iso()
        with self.connect() as db:
            db.execute(
                """UPDATE items
                   SET translated=?, mode=?, status='processed',
                       translation_mode=?, translation_provider=?, translation_model=?,
                       source_lang=CASE WHEN ? != '' THEN ? ELSE source_lang END,
                       updated_at=?
                   WHERE id=?""",
                (text, mode, translation_mode, provider, model, source_lang, source_lang, now, identifier),
            )
            if segments is not None:
                db.execute("DELETE FROM content_segments WHERE item_id=?", (identifier,))
                for idx, seg in enumerate(segments):
                    db.execute(
                        """INSERT INTO content_segments(
                            item_id, seq, block_type, original_text, translated_text, start_sec, end_sec, warnings_json, cache_key
                        ) VALUES(?,?,?,?,?,?,?,?,?)""",
                        (
                            identifier,
                            idx,
                            str(seg.get("block_type", "paragraph")),
                            str(seg.get("original", "")),
                            str(seg.get("translated", "")),
                            seg.get("start_sec"),
                            seg.get("end_sec"),
                            json.dumps(list(seg.get("warnings", ())), ensure_ascii=False),
                            str(seg.get("cache_key", "")),
                        ),
                    )
        return self.get(identifier)

    def progress(self, identifier: str, position: float) -> dict[str, object]:
        if not 0 <= position <= 1:
            raise ValueError("Position must be between 0 and 1")
        self.get(identifier)
        with self.connect() as db:
            db.execute(
                "UPDATE items SET position=?, is_read=CASE WHEN ? >= 0.95 THEN 1 ELSE is_read END, updated_at=? WHERE id=?",
                (position, position, _now_iso(), identifier),
            )
        return self.get(identifier)

    def audio_progress(self, identifier: str, position_sec: float, duration_sec: float | None = None) -> dict[str, object]:
        self.get(identifier)
        with self.connect() as db:
            if duration_sec is not None and duration_sec > 0:
                db.execute(
                    "UPDATE items SET audio_position_sec=?, audio_duration_sec=?, updated_at=? WHERE id=?",
                    (max(0.0, position_sec), duration_sec, _now_iso(), identifier),
                )
            else:
                db.execute(
                    "UPDATE items SET audio_position_sec=?, updated_at=? WHERE id=?",
                    (max(0.0, position_sec), _now_iso(), identifier),
                )
        return self.get(identifier)

    def set_audio_result(
        self,
        identifier: str,
        *,
        audio_path: str,
        status: str,
        provider: str,
        model: str,
        voice: str,
        duration_sec: float = 0.0,
    ) -> dict[str, object]:
        self.get(identifier)
        with self.connect() as db:
            db.execute(
                """UPDATE items
                   SET audio_path=?, audio_status=?, audio_provider=?, audio_model=?,
                       audio_voice=?, audio_duration_sec=?, updated_at=?
                   WHERE id=?""",
                (audio_path, status, provider, model, voice, duration_sec, _now_iso(), identifier),
            )
        return self.get(identifier)

    def set_transcript_result(
        self,
        identifier: str,
        *,
        text: str,
        language: str,
        segments: list[dict[str, object]],
        duration_sec: float = 0.0,
    ) -> dict[str, object]:
        self.get(identifier)
        words = len(text.split())
        with self.connect() as db:
            db.execute(
                """UPDATE items
                   SET original=?, source_lang=?, transcript_json=?, source_hash=?,
                       word_count=?, reading_minutes=?, listening_minutes=?,
                       audio_duration_sec=CASE WHEN ? > 0 THEN ? ELSE audio_duration_sec END,
                       updated_at=?
                   WHERE id=?""",
                (
                    text,
                    language,
                    json.dumps(segments, ensure_ascii=False),
                    _sha256(text),
                    words,
                    _estimate_reading_minutes(text),
                    max(1, round(duration_sec / 60)) if duration_sec else max(1, round(words / 145)),
                    duration_sec,
                    duration_sec,
                    _now_iso(),
                    identifier,
                ),
            )
            db.execute("DELETE FROM content_segments WHERE item_id=?", (identifier,))
            for idx, seg in enumerate(segments):
                db.execute(
                    "INSERT INTO content_segments(item_id, seq, block_type, original_text, start_sec, end_sec) VALUES(?,?,?,?,?,?)",
                    (identifier, idx, "transcript", str(seg.get("text", "")), seg.get("start"), seg.get("end")),
                )
        return self.get(identifier)

    def metadata(
        self,
        identifier: str,
        favorite: bool,
        notes: str,
        category: str,
        *,
        is_read: bool | None = None,
        highlights: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        self.get(identifier)
        with self.connect() as db:
            db.execute(
                "UPDATE items SET favorite=?, notes=?, category=?, updated_at=? WHERE id=?",
                (int(favorite), notes, category, _now_iso(), identifier),
            )
            if is_read is not None:
                db.execute("UPDATE items SET is_read=? WHERE id=?", (int(is_read), identifier))
            if highlights is not None:
                db.execute("UPDATE items SET highlights_json=? WHERE id=?", (json.dumps(highlights, ensure_ascii=False), identifier))
        return self.get(identifier)

    def delete(self, identifier: str) -> None:
        item = self.get(identifier)
        # Clean up owned item-specific files while preserving shared segment cache if referenced
        for key in ("audio_path", "source_audio_path"):
            p = item.get(key)
            if p:
                fp = Path(str(p))
                try:
                    if fp.is_file() and (self.audio_dir in fp.parents or self.media_dir in fp.parents):
                        fp.unlink(missing_ok=True)
                except OSError:
                    pass
        with self.connect() as db:
            db.execute("DELETE FROM items WHERE id=?", (identifier,))

    # --- Settings ---

    def get_settings(self) -> dict[str, object]:
        with self.connect() as db:
            rows = db.execute("SELECT key, value_json FROM app_settings").fetchall()
        merged = dict(DEFAULT_SETTINGS)
        for row in rows:
            try:
                merged[row["key"]] = json.loads(row["value_json"])
            except Exception:
                pass
        return merged

    def update_settings(self, patch: dict[str, object]) -> dict[str, object]:
        now = _now_iso()
        with self.connect() as db:
            for k, v in patch.items():
                if k in DEFAULT_SETTINGS:
                    db.execute(
                        "INSERT INTO app_settings(key, value_json, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
                        (k, json.dumps(v), now),
                    )
        return self.get_settings()

    # --- Glossary ---

    def list_glossary(self) -> list[dict[str, object]]:
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM glossary ORDER BY LOWER(term_en) ASC")]

    def glossary_version(self) -> int:
        with self.connect() as db:
            row = db.execute("SELECT COALESCE(MAX(version), 1) AS v, COUNT(*) AS c FROM glossary").fetchone()
            return int(row["v"]) + int(row["c"])

    def upsert_glossary(self, term_en: str, term_tr: str, context_note: str = "", keep_english_parens: bool = True, term_id: str | None = None) -> dict[str, object]:
        if not term_en.strip() or not term_tr.strip():
            raise ValueError("Term cannot be empty")
        now = _now_iso()
        with self.connect() as db:
            if term_id:
                row = db.execute("SELECT version FROM glossary WHERE id=?", (term_id,)).fetchone()
                if not row:
                    raise KeyError(term_id)
                new_ver = int(row["version"]) + 1
                db.execute(
                    "UPDATE glossary SET term_en=?, term_tr=?, context_note=?, keep_english_parens=?, version=?, updated_at=? WHERE id=?",
                    (term_en.strip(), term_tr.strip(), context_note.strip(), int(keep_english_parens), new_ver, now, term_id),
                )
                return dict(db.execute("SELECT * FROM glossary WHERE id=?", (term_id,)).fetchone())
            gid = uuid4().hex
            db.execute(
                """INSERT INTO glossary(id, term_en, term_tr, context_note, keep_english_parens, version, updated_at)
                   VALUES(?,?,?,?,?,1,?)
                   ON CONFLICT(term_en) DO UPDATE SET
                   term_tr=excluded.term_tr, context_note=excluded.context_note,
                   keep_english_parens=excluded.keep_english_parens, version=glossary.version+1, updated_at=excluded.updated_at""",
                (gid, term_en.strip(), term_tr.strip(), context_note.strip(), int(keep_english_parens), now),
            )
            return dict(db.execute("SELECT * FROM glossary WHERE term_en=?", (term_en.strip(),)).fetchone())

    def delete_glossary(self, term_id: str) -> None:
        with self.connect() as db:
            cur = db.execute("DELETE FROM glossary WHERE id=?", (term_id,))
            if cur.rowcount == 0:
                raise KeyError(term_id)

    # --- Usage & Cache Stats ---

    def record_usage(
        self,
        event_type: str,
        provider: str,
        model: str = "",
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
        characters: int = 0,
        cost_usd: float = 0.0,
        item_id: str = "",
    ) -> None:
        with self.connect() as db:
            db.execute(
                """INSERT INTO usage_events(id, event_type, provider, model, input_tokens, output_tokens, characters, cost_usd, item_id, created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (uuid4().hex, event_type, provider, model, input_tokens, output_tokens, characters, cost_usd, item_id, _now_iso()),
            )

    def usage_summary(self) -> dict[str, object]:
        with self.connect() as db:
            t_row = db.execute(
                "SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS in_tok, COALESCE(SUM(output_tokens),0) AS out_tok, COALESCE(SUM(cost_usd),0) AS cost FROM usage_events WHERE event_type='translation'"
            ).fetchone()
            a_row = db.execute(
                "SELECT COUNT(*) AS calls, COALESCE(SUM(characters),0) AS chars, COALESCE(SUM(cost_usd),0) AS cost FROM usage_events WHERE event_type='narration'"
            ).fetchone()
            tc = db.execute("SELECT COUNT(*) FROM translation_cache").fetchone()[0]
            ac = db.execute("SELECT COUNT(*) FROM audio_cache").fetchone()[0]
        audio_bytes = sum(f.stat().st_size for f in self.audio_dir.rglob("*") if f.is_file())
        media_bytes = sum(f.stat().st_size for f in self.media_dir.rglob("*") if f.is_file())
        return {
            "translation": dict(t_row),
            "narration": dict(a_row),
            "translation_cache_entries": tc,
            "audio_cache_entries": ac,
            "audio_disk_bytes": audio_bytes,
            "media_disk_bytes": media_bytes,
        }

    def clear_caches(self, *, translation: bool = True, audio: bool = True) -> dict[str, int]:
        removed = {"translation_cache": 0, "audio_cache": 0}
        with self.connect() as db:
            if translation:
                removed["translation_cache"] = db.execute("DELETE FROM translation_cache").rowcount
            if audio:
                rows = db.execute("SELECT file_path FROM audio_cache").fetchall()
                for r in rows:
                    Path(r["file_path"]).unlink(missing_ok=True)
                removed["audio_cache"] = db.execute("DELETE FROM audio_cache").rowcount
        return removed
