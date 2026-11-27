"""Tests for SecretStore, v0.4 SQLite migration, backup, and system info."""
from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient
import pytest

from knowledge_hub.library import Library
from knowledge_hub.secrets import ENV_MAP, SUPPORTED_KEYS, SecretStore, mask_secret
from knowledge_hub.server import create_app


@pytest.fixture(autouse=True)
def _clean_secret_env(monkeypatch):
    for env_var in ENV_MAP.values():
        monkeypatch.delenv(env_var, raising=False)


def test_secret_store_lifecycle_and_masking(tmp_path):
    store = SecretStore(tmp_path / ".secrets.json")
    raw_key = "sk-or-v1-supersecretkey9876543210"

    assert store.get("openrouter_api_key") is None
    assert mask_secret("") == ""
    assert mask_secret("short") == "••••"
    assert mask_secret(raw_key) == "sk-o••••3210"

    store.set("openrouter_api_key", f"  {raw_key}  ")
    assert store.get("openrouter_api_key") == raw_key

    status = store.status()
    assert set(status.keys()) == set(SUPPORTED_KEYS)
    assert status["openrouter_api_key"]["configured"] is True
    assert status["openrouter_api_key"]["source"] == "store"
    assert status["openrouter_api_key"]["masked"] == "sk-o••••3210"
    assert raw_key not in json.dumps(status)

    # Clearing removes the secret cleanly
    store.set("openrouter_api_key", "")
    assert store.get("openrouter_api_key") is None
    assert store.status()["openrouter_api_key"]["configured"] is False
    assert store.status()["openrouter_api_key"]["source"] == "none"

    with pytest.raises(KeyError):
        store.get("nonexistent_key")
    with pytest.raises(KeyError):
        store.set("nonexistent_key", "abc")


def test_secrets_api_endpoints_never_expose_raw_keys(tmp_path):
    db = tmp_path / "lib.sqlite3"
    secrets_path = tmp_path / ".secrets.json"
    client = TestClient(create_app(db, secrets_path=secrets_path))

    raw_or = "sk-or-v1-api-endpoint-test-secret-1234"
    raw_el = "el-elevenlabs-very-secret-key-9999"

    r0 = client.get("/api/secrets/status")
    assert r0.status_code == 200
    assert r0.json()["openrouter_api_key"]["configured"] is False

    r1 = client.put(
        "/api/secrets",
        json={"openrouter_api_key": raw_or, "elevenlabs_api_key": raw_el},
    )
    assert r1.status_code == 200
    assert raw_or not in r1.text
    assert raw_el not in r1.text
    body = r1.json()
    assert body["openrouter_api_key"]["configured"] is True
    assert body["openrouter_api_key"]["masked"] == "sk-o••••1234"
    assert body["elevenlabs_api_key"]["configured"] is True
    assert body["openai_api_key"]["configured"] is False

    r2 = client.get("/api/secrets/status")
    assert r2.status_code == 200
    assert raw_or not in r2.text
    assert raw_el not in r2.text

    # Clearing one key keeps the other intact
    r3 = client.put("/api/secrets", json={"openrouter_api_key": ""})
    assert r3.status_code == 200
    assert r3.json()["openrouter_api_key"]["configured"] is False
    assert r3.json()["elevenlabs_api_key"]["configured"] is True


def test_v04_sqlite_migration_preserves_existing_data(tmp_path):
    db_path = tmp_path / "legacy_v04.sqlite3"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """CREATE TABLE items (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source TEXT NOT NULL,
                kind TEXT NOT NULL,
                original TEXT NOT NULL,
                translated TEXT,
                mode TEXT,
                created TEXT NOT NULL,
                position REAL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'imported',
                favorite INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                category TEXT DEFAULT ''
            )"""
        )
        conn.execute(
            """INSERT INTO items(
                id, title, source, kind, original, translated, mode,
                created, position, status, favorite, notes, category
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "legacy-item-001",
                "Legacy Attention Paper",
                "https://example.com/attention",
                "article",
                "Attention is all you need.",
                "Dikkat ihtiyacınız olan tek şeydir.",
                "live",
                "2025-01-15T10:00:00+00:00",
                0.65,
                "processed",
                1,
                "Önemli makale",
                "LLM",
            ),
        )

    lib = Library(db_path)
    migrated = lib.get("legacy-item-001")
    assert migrated["title"] == "Legacy Attention Paper"
    assert migrated["source"] == "https://example.com/attention"
    assert migrated["original"] == "Attention is all you need."
    assert migrated["translated"] == "Dikkat ihtiyacınız olan tek şeydir."
    assert migrated["mode"] == "live"
    assert migrated["position"] == 0.65
    assert migrated["status"] == "processed"
    assert migrated["favorite"] == 1
    assert migrated["notes"] == "Önemli makale"
    assert migrated["category"] == "LLM"

    # New columns exist on items table
    with lib.connect() as conn:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(items)")}
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    for expected_col in (
        "author",
        "published_at",
        "source_lang",
        "translation_mode",
        "audio_path",
        "audio_status",
        "highlights_json",
        "transcript_json",
        "structured_json",
        "is_read",
        "updated_at",
    ):
        assert expected_col in cols

    for expected_table in (
        "content_segments",
        "translation_cache",
        "audio_cache",
        "sources",
        "feed_entries",
        "jobs",
        "glossary",
        "app_settings",
        "usage_events",
    ):
        assert expected_table in tables

    assert len(lib.list_glossary()) > 0
    assert "translation_provider" in lib.get_settings()


def test_backup_returns_valid_sqlite_and_system_info_has_no_secrets(tmp_path):
    db = tmp_path / "app.sqlite3"
    secrets_path = tmp_path / ".secrets.json"
    client = TestClient(create_app(db, secrets_path=secrets_path))

    raw_secret = "sk-openai-do-not-leak-this-secret-4242"
    client.put("/api/secrets", json={"openai_api_key": raw_secret})

    created = client.post("/api/items", json={"title": "Backup Item", "content": "Backup content 123"})
    assert created.status_code == 201
    item_id = created.json()["id"]

    # /api/backup returns a valid SQLite database containing our item
    backup_resp = client.get("/api/backup")
    assert backup_resp.status_code == 200
    assert backup_resp.headers["content-type"].startswith("application/x-sqlite3")
    assert backup_resp.content.startswith(b"SQLite format 3\x00")
    assert raw_secret.encode("utf-8") not in backup_resp.content

    restored_path = tmp_path / "restored.sqlite3"
    restored_path.write_bytes(backup_resp.content)
    with sqlite3.connect(restored_path) as conn:
        row = conn.execute("SELECT title, original FROM items WHERE id=?", (item_id,)).fetchone()
    assert row == ("Backup Item", "Backup content 123")

    # /api/system/info never exposes raw secrets
    info_resp = client.get("/api/system/info")
    assert info_resp.status_code == 200
    assert raw_secret not in info_resp.text
    info = info_resp.json()
    assert "version" in info
    assert "secrets_backend" in info
    assert "whisper" in info
    assert "usage" in info
