"""Tests for QA checks, translation pipeline, segment caching, and API key guards."""
from __future__ import annotations

import time

from fastapi.testclient import TestClient
import pytest

from knowledge_hub.library import Library
from knowledge_hub.providers import MockTranslator
from knowledge_hub.qa import inspect_segment
from knowledge_hub.secrets import ENV_MAP
from knowledge_hub.server import create_app
from knowledge_hub.translation import build_cache_key, translate_item


@pytest.fixture(autouse=True)
def _clean_secret_env(monkeypatch):
    for env_var in ENV_MAP.values():
        monkeypatch.delenv(env_var, raising=False)


# --- QA inspection tests ---


def test_qa_number_normalization_matches_dot_and_comma():
    src = "The learning rate is 0.01 and accuracy reached 95.5% across 3 runs."
    tgt = "Öğrenme oranı 0,01 ve doğruluk 3 koşu boyunca %95,5 seviyesine ulaştı."
    report = inspect_segment(src, tgt, mode="faithful")
    assert report.passed is True
    assert "numeric_mismatch" not in report.warnings
    assert report.metrics["numbers_matched"] is True

    bad = inspect_segment(src, "Öğrenme oranı 0,05 ve doğruluk %90 oldu.", mode="faithful")
    assert "numeric_mismatch" in bad.warnings
    assert bad.metrics["numbers_matched"] is False


def test_qa_missing_code_block_is_critical():
    src = "Use the helper:\n\n```python\nprint(42)\n```"
    tgt = "Yardımcı fonksiyonu kullanın: print(42)"
    report = inspect_segment(src, tgt, mode="faithful")
    assert report.passed is False
    assert "code_block_missing" in report.critical_errors


def test_qa_missing_math_formula_is_warning():
    src = "Energy follows $E = mc^2$ and total loss is $$L = \\sum x_i$$."
    tgt = "Enerji denklemi korunmalı ve toplam kayıp hesaplanmalıdır."
    report = inspect_segment(src, tgt, mode="faithful")
    assert "math_expression_mismatch" in report.warnings


def test_qa_faithful_suspiciously_short_output_is_critical():
    src = (
        "Statistical inference allows researchers to draw principled conclusions about "
        "unknown population parameters using finite samples and carefully calibrated uncertainty bounds."
    )
    assert len(src) >= 120
    tgt = "İstatistiksel çıkarım önemlidir."

    faithful_report = inspect_segment(src, tgt, mode="faithful")
    assert faithful_report.passed is False
    assert "suspiciously_short_output" in faithful_report.critical_errors

    summary_report = inspect_segment(src, tgt, mode="summary")
    assert "suspiciously_short_output" not in summary_report.critical_errors


def test_qa_missing_url_is_warning():
    src = "Read the full specification at https://example.com/spec/v2 for details."
    tgt = "Ayrıntılar için tam belirtimi okuyun."
    report = inspect_segment(src, tgt, mode="faithful")
    assert "url_missing" in report.warnings


# --- Translation pipeline tests ---


def test_translate_item_modes_and_code_block_preservation(tmp_path):
    lib = Library(tmp_path / "lib.sqlite3")
    content = (
        "Statistical inference helps estimate parameters.\n\n"
        "```python\ndef score(x):\n    return x * 0.01\n```\n\n"
        "Model inference runs in production."
    )
    item = lib.add("ML Notes", "manual", "article", content)
    item_id = str(item["id"])

    # Faithful mode
    res_f = translate_item(lib, item_id, MockTranslator(mode="faithful"), mode="faithful")
    assert res_f["cached"] is False
    assert res_f["total_segments"] == 3
    assert "[MOCK ÇEVİRİ]" in str(res_f["item"]["translated"])
    assert "```python\ndef score(x):\n    return x * 0.01\n```" in str(res_f["item"]["translated"])
    code_segs = [s for s in res_f["item"]["segments"] if s["block_type"] == "code"]
    assert len(code_segs) == 1
    assert code_segs[0]["translated_text"] == code_segs[0]["original_text"]

    # Explained mode
    res_e = translate_item(lib, item_id, MockTranslator(mode="explained"), mode="explained")
    assert "[Açıklama]:" in str(res_e["item"]["translated"])
    assert res_e["item"]["translation_mode"] == "explained"

    # Summary mode
    res_s = translate_item(lib, item_id, MockTranslator(mode="summary"), mode="summary")
    assert "[MOCK ÖZET]" in str(res_s["item"]["translated"])
    assert res_s["item"]["translation_mode"] == "summary"


def test_translate_item_cache_hit_and_glossary_version_invalidation(tmp_path):
    lib = Library(tmp_path / "lib.sqlite3")
    item = lib.add("Cache Test", "manual", "article", "Model inference latency is 12 ms.")
    item_id = str(item["id"])
    translator = MockTranslator(mode="faithful")

    first = translate_item(lib, item_id, translator, mode="faithful")
    assert first["cached"] is False
    assert first["input_tokens"] > 0

    second = translate_item(lib, item_id, translator, mode="faithful")
    assert second["cached"] is True
    assert second["cache_hits"] == second["total_segments"]
    assert second["input_tokens"] == 0
    assert second["output_tokens"] == 0

    # Updating glossary changes glossary_version and invalidates cache_key
    v_before = lib.glossary_version()
    key_before = build_cache_key(
        source_text="Model inference latency is 12 ms.",
        source_lang="en",
        target_lang="tr",
        provider="mock",
        model="mock-tr-v1",
        glossary_version=v_before,
        mode="faithful",
    )

    lib.upsert_glossary("Latency", "Gecikme", context_note="Yanıt süresi")
    v_after = lib.glossary_version()
    assert v_after != v_before

    key_after = build_cache_key(
        source_text="Model inference latency is 12 ms.",
        source_lang="en",
        target_lang="tr",
        provider="mock",
        model="mock-tr-v1",
        glossary_version=v_after,
        mode="faithful",
    )
    assert key_after != key_before

    third = translate_item(lib, item_id, translator, mode="faithful")
    assert third["cached"] is False


def test_translate_api_sync_and_async_jobs(tmp_path):
    client = TestClient(create_app(tmp_path / "api.sqlite3", secrets_path=tmp_path / ".secrets.json"))
    created = client.post("/api/items", json={"title": "API Translate", "content": "Confidence interval is 95%."})
    assert created.status_code == 201
    item_id = created.json()["id"]

    # Sync (async_job=False)
    sync_resp = client.post(
        f"/api/items/{item_id}/translate",
        json={"mode": "faithful", "provider": "mock", "async_job": False},
    )
    assert sync_resp.status_code == 200
    sync_data = sync_resp.json()
    assert sync_data["cached"] is False
    assert "[MOCK ÇEVİRİ]" in sync_data["item"]["translated"]

    # Async (async_job=True) with explained mode
    async_resp = client.post(
        f"/api/items/{item_id}/translate",
        json={"mode": "explained", "provider": "mock", "async_job": True},
    )
    assert async_resp.status_code == 200
    job_id = async_resp.json()["id"]

    deadline = time.time() + 5.0
    job_data = {}
    while time.time() < deadline:
        job_data = client.get(f"/api/jobs/{job_id}").json()
        if job_data["status"] in ("COMPLETED", "FAILED", "CANCELLED"):
            break
        time.sleep(0.05)

    assert job_data["status"] == "COMPLETED"
    item_after = client.get(f"/api/items/{item_id}").json()
    assert "[Açıklama]:" in item_after["translated"]


@pytest.mark.parametrize(
    ("provider", "expected_phrase"),
    [
        ("openrouter", "OpenRouter API anahtarı ayarlanmamış"),
        ("openai", "OpenAI API anahtarı ayarlanmamış"),
    ],
)
def test_translate_api_missing_key_returns_400_turkish_error(tmp_path, provider, expected_phrase):
    client = TestClient(create_app(tmp_path / "nokey.sqlite3", secrets_path=tmp_path / ".secrets.json"))
    item_id = client.post("/api/items", json={"title": "No Key", "content": "Hello world"}).json()["id"]

    resp = client.post(
        f"/api/items/{item_id}/translate",
        json={"mode": "faithful", "provider": provider, "async_job": False},
    )
    assert resp.status_code == 400
    assert expected_phrase in resp.json()["detail"]
