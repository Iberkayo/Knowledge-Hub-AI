"""Local persistent library; no external services."""
import sqlite3
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
import json

class Library:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL,
                kind TEXT NOT NULL, original TEXT NOT NULL, translated TEXT,
                mode TEXT, created TEXT NOT NULL, position REAL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'imported')""")
    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db
    def add(self, title, source, kind, original):
        if kind not in ('article', 'podcast', 'document') or not title.strip() or not original.strip():
            raise ValueError("Invalid content")
        identifier = uuid4().hex
        with self.connect() as db:
            db.execute("INSERT INTO items(id,title,source,kind,original,created) VALUES(?,?,?,?,?,?)",
                       (identifier,title,source,kind,original,datetime.now(timezone.utc).isoformat()))
        return self.get(identifier)
    def get(self, identifier):
        with self.connect() as db:
            row = db.execute("SELECT * FROM items WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise KeyError(identifier)
        return dict(row)
    def list(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT id,title,source,kind,created,status,mode,position FROM items ORDER BY created DESC")]
    def complete(self, identifier, text, mode):
        if mode not in ('demo', 'live') or not text.strip():
            raise ValueError("Invalid translation")
        self.get(identifier)
        with self.connect() as db:
            db.execute("UPDATE items SET translated=?,mode=?,status='processed' WHERE id=?", (text,mode,identifier))
        return self.get(identifier)
    def progress(self, identifier, position):
        if not 0 <= position <= 1:
            raise ValueError("Position must be between 0 and 1")
        self.get(identifier)
        with self.connect() as db:
            db.execute("UPDATE items SET position=? WHERE id=?", (position,identifier))
        return self.get(identifier)
    def delete(self, identifier):
        self.get(identifier)
        with self.connect() as db:
            db.execute("DELETE FROM items WHERE id=?", (identifier,))
