"""Tests for audio pipeline, JobManager, document/audio uploads, mock transcription, and EPUB safety."""
from __future__ import annotations

from pathlib import Path
import threading
import time

from fastapi.testclient import TestClient
import pytest

from knowledge_hub.audio_pipeline import chunk_narration_text, estimate_narration_cost, narrate_item
from knowledge_hub.jobs import JobManager
from knowledge_hub.library import Library
from knowledge_hub.media import _safe_zip_member
from knowledge_hub.server import create_app


# --- Audio pipeline tests ---


def test_chunk_narration_text_respects_budget_and_cleans_markdown():
    text = (
        "# Başlık\n\n"
        "Birinci cümle burada biter. İkinci cümle de oldukça açıktır. Üçüncü cümle uzunluk sınırını test eder.\n\n"
        "```python\nx = 1\n```\n\n"
        "Bağlantı örneği [makale](https://example.com) ve `satir_ici` kod."
    )
    chunks = chunk_narration_text(text, max_chars=70)
    assert len(chunks) >= 3
    assert all(len(c) <= 70 for c in chunks)
    joined = " ".join(chunks)
    assert "```" not in joined
    assert "https://example.com" not in joined
    assert "Kod bloğu ekranda görüntülenmektedir." in joined
    assert "satir_ici" in joined


def test_narrate_item_mock_cache_and_audio_endpoints(tmp_path):
    db = tmp_path / "audio.sqlite3"
    client = TestClient(create_app(db, secrets_path=tmp_path / ".secrets.json"))
    lib = Library(db)

    item = lib.add(
        "Audio Article",
        "manual",
        "article",
        "Birinci paragraf seslendirme için hazır.\n\nİkinci paragraf önbellek testi içindir.",
    )
    item_id = str(item["id"])

    est_before = estimate_narration_cost(
        lib, item_id, provider="mock", model="mock-tts", voice="mock-tr"
    )
    assert est_before["total_chunks"] == 2
    assert est_before["cached_chunks"] == 0
    assert est_before["new_chunks"] == 2
    assert est_before["new_characters_to_bill"] == 0

    est_el = estimate_narration_cost(
        lib, item_id, provider="elevenlabs", model="eleven_flash_v2_5", voice="voice1"
    )
    assert est_el["new_characters_to_bill"] == est_el["total_characters"]
    assert est_el["total_characters"] > 0

    first = narrate_item(lib, item_id, provider="mock", model="mock-tts", voice="mock-tr")
    audio_file = Path(str(first["audio_path"]))
    assert audio_file.is_file()
    assert audio_file.stat().st_size > 0
    assert first["cache_hits"] == 0
    assert first["total_chunks"] == 2
    assert first["item"]["audio_status"] == "ready"

    # Second narration hits chunk cache for every chunk
    second = narrate_item(lib, item_id, provider="mock", model="mock-tts", voice="mock-tr")
    assert second["cache_hits"] == second["total_chunks"] == 2

    est_after = estimate_narration_cost(
        lib, item_id, provider="mock", model="mock-tts", voice="mock-tr"
    )
    assert est_after["cached_chunks"] == 2
    assert est_after["new_chunks"] == 0

    # GET /api/items/{id}/audio serves audio/mpeg
    audio_resp = client.get(f"/api/items/{item_id}/audio")
    assert audio_resp.status_code == 200
    assert audio_resp.headers["content-type"].startswith("audio/mpeg")
    assert len(audio_resp.content) > 0

    # PATCH /api/items/{id}/audio-progress persists playback position and duration
    prog_resp = client.patch(
        f"/api/items/{item_id}/audio-progress",
        json={"position_sec": 12.5, "duration_sec": 45.0},
    )
    assert prog_resp.status_code == 200
    prog_data = prog_resp.json()
    assert prog_data["audio_position_sec"] == 12.5
    assert prog_data["audio_duration_sec"] == 45.0


# --- JobManager tests ---


def test_job_manager_lifecycle_progress_cancel_and_crash_recovery(tmp_path):
    lib = Library(tmp_path / "jobs.sqlite3")
    jm = JobManager(lib, max_workers=2)
    try:
        # 1. Create, update progress, and complete
        job = jm.create_job(job_type="translate", stage="TRANSLATING", item_id="item-1", provider="mock")
        assert job["status"] == "QUEUED"

        def _work(jid: str):
            jm.update(jid, stage="TRANSLATING", processed_segments=1, total_segments=2, progress=0.5)
            return {"cost_usd": 0.02}

        jm.submit(str(job["id"]), _work)
        deadline = time.time() + 5.0
        done = {}
        while time.time() < deadline:
            done = jm.get(str(job["id"]))
            if done["status"] == "COMPLETED":
                break
            time.sleep(0.02)

        assert done["status"] == "COMPLETED"
        assert done["progress"] == 1.0
        assert done["processed_segments"] == 1
        assert done["total_segments"] == 2
        assert done["actual_cost"] == pytest.approx(0.02)

        # 2. Cancel queued job before submission
        queued = jm.create_job(job_type="narrate", stage="GENERATING_AUDIO", item_id="item-2")
        cancelled_q = jm.cancel(str(queued["id"]))
        assert cancelled_q["status"] == "CANCELLED"
        assert jm.is_cancelled(str(queued["id"])) is True

        # 3. Cancel running job cooperatively
        started = threading.Event()
        release = threading.Event()
        running = jm.create_job(job_type="translate", stage="TRANSLATING", item_id="item-3")

        def _cancellable(jid: str):
            started.set()
            release.wait(timeout=3.0)
            if jm.is_cancelled(jid):
                raise RuntimeError("JOB_CANCELLED")
            return {}

        jm.submit(str(running["id"]), _cancellable)
        assert started.wait(timeout=3.0)
        jm.cancel(str(running["id"]))
        release.set()

        deadline = time.time() + 5.0
        final_run = {}
        while time.time() < deadline:
            final_run = jm.get(str(running["id"]))
            if final_run["status"] in ("CANCELLED", "COMPLETED", "FAILED"):
                break
            time.sleep(0.02)
        assert final_run["status"] == "CANCELLED"
    finally:
        jm.shutdown()

    # 4. Crash recovery (_recover_stale_jobs) marks leftover RUNNING/QUEUED as FAILED
    stale_running = jm.create_job(job_type="translate", stage="TRANSLATING", item_id="stale-1")
    jm.update(str(stale_running["id"]), status="RUNNING")
    stale_queued = jm.create_job(job_type="narrate", stage="GENERATING_AUDIO", item_id="stale-2")

    recovered_jm = JobManager(lib, max_workers=1)
    try:
        r1 = recovered_jm.get(str(stale_running["id"]))
        r2 = recovered_jm.get(str(stale_queued["id"]))
        r_done = recovered_jm.get(str(job["id"]))
        assert r1["status"] == "FAILED"
        assert r1["finished_at"] != ""
        assert "yeniden başlatıldığı" in str(r1["error_message"])
        assert r2["status"] == "FAILED"
        assert r_done["status"] == "COMPLETED"
    finally:
        recovered_jm.shutdown()


# --- Upload & mock transcription tests ---


def test_upload_document_supported_formats_and_rejection(tmp_path):
    client = TestClient(create_app(tmp_path / "uploads.sqlite3", secrets_path=tmp_path / ".secrets.json"))

    # .txt
    r_txt = client.post(
        "/api/upload/document",
        files={"file": ("notes.txt", b"Plain text study notes.", "text/plain")},
        data={"category": "Notlar"},
    )
    assert r_txt.status_code == 201
    assert r_txt.json()["kind"] == "document"
    assert r_txt.json()["original"] == "Plain text study notes."

    # .html
    html_bytes = b"<html><head><title>Web Doc</title></head><body><article><h1>Deep Learning</h1><p>Backprop notes.</p></article></body></html>"
    r_html = client.post(
        "/api/upload/document",
        files={"file": ("post.html", html_bytes, "text/html")},
    )
    assert r_html.status_code == 201
    assert r_html.json()["kind"] == "article"
    assert r_html.json()["title"] == "Deep Learning"
    assert "Backprop notes." in r_html.json()["original"]

    # .srt
    srt_bytes = b"1\n00:00:01,000 --> 00:00:03,000\nHello from SRT\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\n"
    r_srt = client.post(
        "/api/upload/document",
        files={"file": ("episode.srt", srt_bytes, "text/plain")},
    )
    assert r_srt.status_code == 201
    assert r_srt.json()["kind"] == "podcast"
    assert "Hello from SRT" in r_srt.json()["original"]
    assert "00:00:01" not in r_srt.json()["original"]

    # .vtt
    vtt_bytes = b"WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello from VTT\n"
    r_vtt = client.post(
        "/api/upload/document",
        files={"file": ("talk.vtt", vtt_bytes, "text/vtt")},
    )
    assert r_vtt.status_code == 201
    assert r_vtt.json()["kind"] == "podcast"
    assert "Hello from VTT" in r_vtt.json()["original"]

    # Invalid extension -> 422
    r_bad = client.post(
        "/api/upload/document",
        files={"file": ("malware.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert r_bad.status_code == 422


def test_upload_audio_and_mock_transcribe(tmp_path):
    client = TestClient(create_app(tmp_path / "podcast.sqlite3", secrets_path=tmp_path / ".secrets.json"))
    mock_mp3 = b"\xff\xfb\x90\x00" + b"\x00" * 512

    up = client.post(
        "/api/upload/audio",
        files={"file": ("episode1.mp3", mock_mp3, "audio/mpeg")},
        data={"title": "AI Podcast Ep 1"},
    )
    assert up.status_code == 201
    item = up.json()
    item_id = item["id"]
    assert item["kind"] == "podcast"
    assert Path(item["source_audio_path"]).is_file()

    # Sync mock transcription produces timestamped segments
    tr = client.post(
        f"/api/items/{item_id}/transcribe",
        json={"mock": True, "async_job": False},
    )
    assert tr.status_code == 200
    tr_item = tr.json()
    assert tr_item["source_lang"] == "en"
    assert "Statistical inference" in tr_item["original"]
    assert len(tr_item["segments"]) == 2
    assert tr_item["segments"][0]["start_sec"] == 0.0
    assert tr_item["segments"][0]["end_sec"] == 4.2
    assert tr_item["segments"][1]["start_sec"] == 4.2
    assert tr_item["segments"][1]["end_sec"] == 8.5


# --- EPUB zip-slip security tests ---


def test_epub_safe_zip_member_allows_normal_and_blocks_traversal():
    assert _safe_zip_member("OEBPS", "chapters/ch1.xhtml") == "OEBPS/chapters/ch1.xhtml"
    assert _safe_zip_member("", "content.opf") == "content.opf"

    for base_dir, href in (
        ("OEBPS", "../../etc/passwd"),
        ("", "../secret.txt"),
        ("OEBPS", "/etc/passwd"),
        ("OEBPS/text", "../../../windows/win.ini"),
    ):
        with pytest.raises(ValueError, match="Unsafe path inside EPUB archive"):
            _safe_zip_member(base_dir, href)


def test_supertonic_wav_assembly_and_provider(tmp_path, monkeypatch):
    import io
    import wave
    import knowledge_hub.audio_pipeline as ap

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"\x00\x00" * 1000)
    fake_wav = buf.getvalue()

    monkeypatch.setattr(ap, "synthesize_supertonic_chunk", lambda text, **kw: (fake_wav, 0.1))

    client = TestClient(create_app(tmp_path / "st.sqlite3", secrets_path=tmp_path / ".secrets.json"))
    item = client.post(
        "/api/items",
        json={"title": "Supertonic Test", "content": "İlk paragraf.\n\nİkinci paragraf."},
    ).json()

    nar = client.post(
        f"/api/items/{item['id']}/narrate",
        json={"provider": "supertonic", "voice": "M1", "async_job": False},
    )
    assert nar.status_code == 200
    assert nar.json()["audio_path"].endswith(".wav")

    aud = client.get(f"/api/items/{item['id']}/audio")
    assert aud.status_code == 200
    assert aud.headers["content-type"].startswith("audio/wav")
    assert aud.content[:4] == b"RIFF"
