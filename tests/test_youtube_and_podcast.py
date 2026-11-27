"""Offline tests for YouTube URL parsing, transcript grouping, and API import."""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from knowledge_hub import server
from knowledge_hub.youtube import extract_youtube_video_id, group_transcript_paragraphs


def test_extract_youtube_video_id_variants_and_rejects_invalid():
    assert extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ?t=42") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://m.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://youtube.com/live/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("http://youtube.com/watch?v=dQw4w9WgXcQ") is None
    assert extract_youtube_video_id("https://evil.example/watch?v=dQw4w9WgXcQ") is None
    assert extract_youtube_video_id("https://www.youtube.com/watch?v=too_short") is None
    assert extract_youtube_video_id("https://hamel.dev/evals/") is None


def test_group_transcript_paragraphs_creates_clean_blocks():
    segs = [
        {"start": 0.0, "end": 5.0, "text": "Evaluation systems are essential for LLM apps."},
        {"start": 5.0, "end": 10.0, "text": "Error analysis should come before automated metrics."},
        {"start": 10.0, "end": 15.0, "text": "Domain experts must inspect real failure traces."},
    ]
    text = group_transcript_paragraphs(segs, target_chars=60)
    assert "Evaluation systems are essential" in text
    assert "\n\n" in text


def test_import_url_auto_detects_youtube_and_saves_transcript(tmp_path, monkeypatch):
    fake_yt = {
        "video_id": "dQw4w9WgXcQ",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "title": "Deep Dive into LLM Evals",
        "author": "AI Engineering Channel",
        "language": "en",
        "text": "First paragraph about evaluation.\n\nSecond paragraph about calibration.",
        "segments": [
            {"start": 0.0, "end": 6.5, "text": "First paragraph about evaluation."},
            {"start": 6.5, "end": 14.0, "text": "Second paragraph about calibration."},
        ],
        "duration_sec": 14.0,
    }
    monkeypatch.setattr(server, "fetch_youtube_transcript", lambda url: fake_yt)

    app = server.create_app(tmp_path / "yt.sqlite3", secrets_path=tmp_path / ".secrets.json")
    client = TestClient(app)

    resp = client.post("/api/import-url", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert resp.status_code == 201
    item = resp.json()
    assert item["title"] == "Deep Dive into LLM Evals"
    assert item["author"] == "AI Engineering Channel"
    assert item["kind"] == "podcast"
    assert item["category"] == "YouTube"
    segs = json.loads(item["transcript_json"])
    assert len(segs) == 2
    assert segs[0]["start"] == 0.0
