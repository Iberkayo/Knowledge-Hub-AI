"""Tests for mobile API readiness: optional Bearer token auth, /api/health, and HTTP 206 Range audio streaming."""
from __future__ import annotations

from fastapi.testclient import TestClient

from knowledge_hub.library import Library
from knowledge_hub.server import create_app


def test_health_and_optional_bearer_auth(tmp_path):
    db = tmp_path / "auth.sqlite3"
    token = "secret-mobile-token-12345"
    app = create_app(db, secrets_path=tmp_path / ".secrets.json", api_token=token)
    client = TestClient(app)

    # /api/health and PWA shell remain accessible without token
    h = client.get("/api/health")
    assert h.status_code == 200
    assert h.json()["auth_required"] is True
    assert client.get("/").status_code == 200

    # Protected API routes reject missing or invalid token
    assert client.get("/api/items").status_code == 401
    assert client.get("/api/items", headers={"Authorization": "Bearer wrong"}).status_code == 401

    # Valid Bearer token succeeds
    ok = client.get("/api/items", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200
    assert ok.json() == []


def test_audio_http_range_206_and_query_token_auth(tmp_path):
    db = tmp_path / "range.sqlite3"
    token = "mobile-audio-token-999"
    app = create_app(db, secrets_path=tmp_path / ".secrets.json", api_token=token)
    lib = Library(db)
    item = lib.add("Podcast Test", "manual", "podcast", "Test metni.")
    mp3 = lib.audio_dir / "range-test.mp3"
    mp3.parent.mkdir(parents=True, exist_ok=True)
    payload = bytes(range(256)) * 4  # 1024 bytes
    mp3.write_bytes(payload)
    lib.set_audio_result(
        str(item["id"]),
        audio_path=str(mp3),
        status="ready",
        provider="edge_tts",
        model="edge-neural-tr",
        voice="tr-TR-AhmetNeural",
        duration_sec=2.0,
    )

    client = TestClient(app)
    audio_url = f"/api/items/{item['id']}/audio"

    # Without token -> 401
    assert client.get(audio_url).status_code == 401

    # With ?token= and Range header (iOS AVPlayer / Safari seeking) -> 206 Partial Content
    r = client.get(f"{audio_url}?token={token}", headers={"Range": "bytes=0-99"})
    assert r.status_code == 206
    assert r.headers.get("accept-ranges") == "bytes"
    assert r.headers.get("content-range") == "bytes 0-99/1024"
    assert len(r.content) == 100
    assert r.content == payload[:100]

    # Query token must NOT work on non-media endpoints like /api/settings
    assert client.get(f"/api/settings?token={token}").status_code == 401


def test_zero_knowledge_byok_save_client_translation(tmp_path):
    db = tmp_path / "byok.sqlite3"
    app = create_app(db, secrets_path=tmp_path / ".secrets.json")
    lib = Library(db)
    item = lib.add("BYOK Article", "https://example.com/a", "article", "First paragraph.\n\nSecond paragraph.")
    client = TestClient(app)

    resp = client.put(
        f"/api/items/{item['id']}/translation",
        json={
            "translated": "İlk paragraf.\n\nİkinci paragraf.",
            "translation_mode": "faithful",
            "provider": "openrouter_byok",
            "model": "google/gemini-2.5-flash",
            "segments": [
                {"block_type": "paragraph", "original": "First paragraph.", "translated": "İlk paragraf."},
                {"block_type": "paragraph", "original": "Second paragraph.", "translated": "İkinci paragraf."},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "processed"
    assert body["translated"] == "İlk paragraf.\n\nİkinci paragraf."
    assert body["translation_provider"] == "openrouter_byok"
    assert len(body["segments"]) == 2
    assert body["segments"][0]["translated_text"] == "İlk paragraf."

