"""Local FastAPI server for Knowledge Hub AI (loopback-first, zero unredacted secrets)."""
from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from typing import Literal
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from knowledge_hub import __version__
from knowledge_hub.auth import ApiTokenMiddleware
from knowledge_hub.audio_pipeline import (
    EDGE_TTS_VOICES,
    OPENAI_TTS_MODELS,
    OPENAI_TTS_VOICES,
    SUPERTONIC_VOICES,
    estimate_narration_cost,
    get_elevenlabs_subscription,
    list_elevenlabs_models,
    list_elevenlabs_voices,
    narrate_item,
    synthesize_edge_tts_chunk,
    synthesize_elevenlabs_chunk,
    synthesize_openai_tts_chunk,
    synthesize_supertonic_chunk,
)
from knowledge_hub.benchmark import RUBRIC_WEIGHTS, build_reference_lookup, evaluate as evaluate_benchmark
from knowledge_hub.core import translate as legacy_translate
from knowledge_hub.discover import (
    add_source,
    delete_source,
    import_feed_entry,
    list_entries,
    list_sources,
    mark_entry_read,
    refresh_source,
)
from knowledge_hub.feed import parse_feed
from knowledge_hub.fetch_public import fetch_public, fetch_public_with_final_url
from knowledge_hub.ingest import extract, extract_rich
from knowledge_hub.jobs import JobManager
from knowledge_hub.library import Library
from knowledge_hub.media import document as extract_document_file, transcribe as whisper_transcribe, whisper_status
from knowledge_hub.podcast import generate_podcast_episode
from knowledge_hub.providers import (
    DemoTranslator,
    MockTranslator,
    OpenAICompatibleTranslator,
    fetch_openrouter_models,
    test_translation_connection,
)
from knowledge_hub.secrets import SUPPORTED_KEYS, SecretStore
from knowledge_hub.transcript import parse_transcript
from knowledge_hub.translation import translate_item
from knowledge_hub.youtube import extract_youtube_video_id, fetch_youtube_transcript


class ImportRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    source: str = Field(default="", max_length=2000)
    kind: Literal["article", "podcast", "document"] = "article"
    format: Literal["text", "html", "transcript"] = "text"
    content: str = Field(min_length=1, max_length=500000)
    author: str = Field(default="", max_length=200)
    published_at: str = Field(default="", max_length=64)
    category: str = Field(default="", max_length=100)


class Metadata(BaseModel):
    favorite: bool = False
    notes: str = Field(default="", max_length=20000)
    category: str = Field(default="", max_length=100)
    is_read: bool | None = None
    highlights: list[dict[str, object]] | None = None


class URLRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class FeedRequest(BaseModel):
    xml: str = Field(min_length=1, max_length=2500000)


class Progress(BaseModel):
    position: float = Field(ge=0, le=1)


class AudioProgressRequest(BaseModel):
    position_sec: float = Field(ge=0)
    duration_sec: float | None = Field(default=None, ge=0)


class TranslateRequest(BaseModel):
    mode: Literal["faithful", "explained", "summary"] = "faithful"
    provider: Literal["openrouter", "openai", "custom", "mock"] | None = None
    model: str | None = Field(default=None, max_length=200)
    target_lang: str = Field(default="tr", max_length=16)
    force: bool = False
    async_job: bool = True


class SaveTranslationRequest(BaseModel):
    translated: str = Field(min_length=1, max_length=2_000_000)
    translation_mode: Literal["faithful", "explained", "summary"] = "faithful"
    provider: str = Field(default="client_byok", max_length=64)
    model: str = Field(default="", max_length=200)
    segments: list[dict[str, object]] | None = None


class NarrateRequest(BaseModel):
    provider: Literal["edge_tts", "openai_tts", "supertonic", "elevenlabs", "mock"] | None = None
    model: str | None = Field(default=None, max_length=120)
    voice: str | None = Field(default=None, max_length=120)
    async_job: bool = True


class PodcastRequest(BaseModel):
    length: Literal["short", "medium"] = "medium"
    provider: Literal["openrouter", "openai", "custom", "mock"] | None = None
    model: str | None = Field(default=None, max_length=200)
    tts_provider: Literal["edge_tts", "openai_tts", "mock"] = "edge_tts"
    async_job: bool = True


class OpenAITtsSampleRequest(BaseModel):
    voice: str = Field(default="coral", max_length=32)
    model: str = Field(default="gpt-4o-mini-tts", max_length=64)
    text: str = Field(
        default="Merhaba! Knowledge Hub ile teknik makaleleri doğal, sıcak ve akıcı bir Türkçeyle dinleyebilirsiniz.",
        min_length=1,
        max_length=500,
    )


class SupertonicSampleRequest(BaseModel):
    voice: str = Field(default="M1", max_length=16)
    speed: float = Field(default=1.05, ge=0.7, le=1.6)
    text: str = Field(
        default="Merhaba! Bu, Knowledge Hub AI için yerel Supertonic 3 Türkçe seslendirme testidir. Yüzde 95 güven aralığı ve model inference terimleri ücretsiz olarak seslendirilmektedir.",
        min_length=1,
        max_length=500,
    )


class EdgeSampleRequest(BaseModel):
    voice: str = Field(default="tr-TR-AhmetNeural", max_length=64)
    text: str = Field(
        default="Merhaba! Knowledge Hub ile teknik makaleleri doğal ve akıcı bir Türkçeyle okuyup dinleyebilirsiniz. Kod blokları seslendirme sırasında otomatik olarak atlanır.",
        min_length=1,
        max_length=500,
    )


class TranscribeRequest(BaseModel):
    model: str | None = Field(default=None, max_length=64)
    device: Literal["cpu", "cuda", "auto"] | None = None
    language: str | None = Field(default=None, max_length=16)
    allow_download: bool | None = None
    mock: bool = False
    async_job: bool = True


class SourceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=2000)
    category: str = Field(default="Özel", max_length=100)
    kind: Literal["article", "podcast"] = "article"


class EntryReadRequest(BaseModel):
    is_read: bool = True


class SecretsUpdateRequest(BaseModel):
    openrouter_api_key: str | None = None
    openai_api_key: str | None = None
    elevenlabs_api_key: str | None = None
    custom_llm_api_key: str | None = None


class TranslationTestRequest(BaseModel):
    provider: Literal["openrouter", "openai", "custom", "mock"]
    model: str = Field(min_length=1, max_length=200)
    base_url: str | None = Field(default=None, max_length=500)


class ElevenSampleRequest(BaseModel):
    voice_id: str = Field(min_length=1, max_length=80)
    model_id: str = Field(default="eleven_flash_v2_5", max_length=80)
    text: str = Field(
        default="Merhaba! Bu, Knowledge Hub AI için Türkçe teknik seslendirme testidir. Yüzde 95 güven aralığı ve model inference terimleri test edilmektedir.",
        min_length=1,
        max_length=500,
    )


class GlossaryUpsertRequest(BaseModel):
    id: str | None = None
    term_en: str = Field(min_length=1, max_length=200)
    term_tr: str = Field(min_length=1, max_length=200)
    context_note: str = Field(default="", max_length=500)
    keep_english_parens: bool = True


class CacheClearRequest(BaseModel):
    translation: bool = True
    audio: bool = True


def _resolve_translator(lib: Library, secrets: SecretStore, provider: str | None, model: str | None, mode: str):
    settings = lib.get_settings()
    prov = provider or str(settings.get("translation_provider") or "openrouter")
    mdl = model or str(settings.get("translation_model") or "openai/gpt-4o-mini")
    if prov == "mock":
        return MockTranslator(model_name=mdl or "mock-tr-v1", mode=mode)
    if prov == "openrouter":
        key = secrets.get("openrouter_api_key")
        if not key:
            raise ValueError("OpenRouter API anahtarı ayarlanmamış. Ayarlar sayfasından ekleyin.")
        return OpenAICompatibleTranslator(
            provider_name="openrouter",
            base_url=str(settings.get("openrouter_base_url") or "https://openrouter.ai/api/v1"),
            api_key=key,
            model_name=mdl,
        )
    if prov == "openai":
        key = secrets.get("openai_api_key")
        if not key:
            raise ValueError("OpenAI API anahtarı ayarlanmamış. Ayarlar sayfasından ekleyin.")
        return OpenAICompatibleTranslator(
            provider_name="openai",
            base_url=str(settings.get("openai_base_url") or "https://api.openai.com/v1"),
            api_key=key,
            model_name=mdl,
        )
    if prov == "custom":
        key = secrets.get("custom_llm_api_key") or "local"
        return OpenAICompatibleTranslator(
            provider_name="custom",
            base_url=str(settings.get("custom_base_url") or "http://127.0.0.1:11434/v1"),
            api_key=key,
            model_name=mdl,
        )
    raise ValueError(f"Desteklenmeyen sağlayıcı: {prov}")


def create_app(
    db_path: str | Path | None = None,
    secrets_path: str | Path | None = None,
    api_token: str | None = None,
) -> FastAPI:
    resolved_db = Path(db_path or os.getenv("KH_DB", "outputs/library.sqlite3"))
    lib = Library(resolved_db)
    resolved_secrets = Path(secrets_path) if secrets_path else (resolved_db.parent / ".secrets.json")
    secrets = SecretStore(resolved_secrets)
    jobs = JobManager(lib)
    static_dir = Path(__file__).parent / "static"
    resolved_token = (api_token if api_token is not None else os.getenv("KH_API_TOKEN", "")).strip()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        jobs.shutdown()

    app = FastAPI(title="Knowledge Hub AI", version=__version__, lifespan=lifespan)
    if resolved_token:
        app.add_middleware(ApiTokenMiddleware, token=resolved_token)
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/api/health")
    def api_health():
        return {"status": "ok", "version": __version__, "auth_required": bool(resolved_token)}

    def lookup(identifier: str) -> dict[str, object]:
        try:
            return lib.get(identifier)
        except KeyError:
            raise HTTPException(404, "İçerik bulunamadı")

    # --- Static & PWA routes ---

    @app.get("/")
    def home():
        return FileResponse(static_dir / "index.html")

    @app.get("/manifest.webmanifest")
    def manifest():
        return FileResponse(static_dir / "manifest.webmanifest", media_type="application/manifest+json")

    @app.get("/sw.js")
    def worker():
        return FileResponse(static_dir / "sw.js", media_type="application/javascript")

    @app.get("/icon.svg")
    def icon():
        return FileResponse(static_dir / "icon.svg", media_type="image/svg+xml")

    # --- Library items ---

    @app.get("/api/items")
    def items():
        return lib.list()

    @app.post("/api/items", status_code=201)
    def add(req: ImportRequest):
        try:
            if req.format == "html":
                rich = extract_rich(req.content, url=req.source)
                return lib.add(
                    req.title or rich.title,
                    req.source,
                    req.kind,
                    rich.text,
                    author=req.author or rich.author,
                    published_at=req.published_at or rich.published_at,
                    category=req.category,
                    source_lang=rich.language_hint,
                    structured_blocks=rich.blocks,
                )
            original = parse_transcript(req.content) if req.format == "transcript" else req.content
            return lib.add(
                req.title,
                req.source,
                req.kind,
                original,
                author=req.author,
                published_at=req.published_at,
                category=req.category,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/items/{identifier}")
    def get_item(identifier: str):
        return lookup(identifier)

    @app.post("/api/items/{identifier}/demo")
    def process_demo(identifier: str):
        item = lookup(identifier)
        parts = legacy_translate(str(item["original"]), DemoTranslator().translate)
        return lib.complete(identifier, "\n\n".join(s.translated for s in parts), "demo")

    @app.post("/api/items/{identifier}/translate")
    def translate_endpoint(identifier: str, req: TranslateRequest):
        lookup(identifier)
        settings = lib.get_settings()
        provider = req.provider or str(settings.get("translation_provider") or "openrouter")
        model = req.model or str(settings.get("translation_model") or "openai/gpt-4o-mini")
        try:
            translator = _resolve_translator(lib, secrets, provider, model, req.mode)
        except ValueError as exc:
            raise HTTPException(400, str(exc))

        if not req.async_job:
            try:
                return translate_item(lib, identifier, translator, mode=req.mode, target_lang=req.target_lang, force=req.force)
            except Exception as exc:
                raise HTTPException(422, str(exc))

        job = jobs.create_job(
            job_type="translate",
            stage="TRANSLATING",
            item_id=identifier,
            provider=provider,
            model=model,
            payload={"mode": req.mode, "target_lang": req.target_lang},
        )
        job_id = str(job["id"])

        def _work(jid: str):
            def _progress(done: int, total: int, hits: int):
                jobs.update(
                    jid,
                    stage="TRANSLATING",
                    processed_segments=done,
                    total_segments=total,
                    cache_hits=hits,
                    progress=round(done / max(1, total), 3),
                )

            res = translate_item(
                lib,
                identifier,
                translator,
                mode=req.mode,
                target_lang=req.target_lang,
                force=req.force,
                on_progress=_progress,
                is_cancelled=lambda: jobs.is_cancelled(jid),
            )
            jobs.update(jid, stage="VALIDATING", cache_hits=int(res["cache_hits"]))
            return {"cost_usd": res["cost_usd"]}

        return jobs.submit(job_id, _work)

    @app.put("/api/items/{identifier}/translation")
    def save_client_translation(identifier: str, req: SaveTranslationRequest):
        """Persist a client-side (Zero-Knowledge BYOK) translation without ever receiving API keys."""
        item = lookup(identifier)
        normalized_segments = None
        if req.segments:
            normalized_segments = [
                {
                    "block_type": str(s.get("block_type") or "paragraph"),
                    "original": str(s.get("original") or s.get("original_text") or ""),
                    "translated": str(s.get("translated") or s.get("translated_text") or ""),
                    "warnings": list(s.get("warnings") or []),
                    "cache_key": "",
                }
                for s in req.segments
            ]
        return lib.complete(
            identifier,
            req.translated,
            "live",
            translation_mode=req.translation_mode,
            provider=req.provider,
            model=req.model,
            source_lang=str(item.get("source_lang") or "en"),
            segments=normalized_segments,
        )

    @app.post("/api/items/{identifier}/narrate/estimate")
    def narrate_estimate(identifier: str, req: NarrateRequest):
        lookup(identifier)
        settings = lib.get_settings()
        provider = req.provider or str(settings.get("tts_provider") or "edge_tts")
        if provider == "edge_tts":
            model = req.model or "edge-neural-tr"
            voice = req.voice or str(settings.get("edge_tts_voice") or "tr-TR-AhmetNeural")
        elif provider == "openai_tts":
            model = req.model or str(settings.get("openai_tts_model") or "gpt-4o-mini-tts")
            voice = req.voice or str(settings.get("openai_tts_voice") or "coral")
        elif provider == "supertonic":
            model = req.model or "supertonic-3"
            voice = req.voice or str(settings.get("supertonic_voice") or "M1")
        else:
            model = req.model or str(settings.get("elevenlabs_model") or "eleven_flash_v2_5")
            voice = req.voice or str(settings.get("elevenlabs_voice_id") or "default")
        if provider == "browser":
            return {"provider": "browser", "total_chunks": 1, "new_characters_to_bill": 0, "note": "Tarayıcı seslendirmesi ücretsiz ve anlıktır."}
        return estimate_narration_cost(lib, identifier, provider=provider, model=model, voice=voice)

    @app.post("/api/items/{identifier}/narrate")
    def narrate_endpoint(identifier: str, req: NarrateRequest):
        lookup(identifier)
        settings = lib.get_settings()
        provider = req.provider or str(settings.get("tts_provider") or "edge_tts")
        if provider == "edge_tts":
            model = req.model or "edge-neural-tr"
            voice = req.voice or str(settings.get("edge_tts_voice") or "tr-TR-AhmetNeural")
        elif provider == "openai_tts":
            model = req.model or str(settings.get("openai_tts_model") or "gpt-4o-mini-tts")
            voice = req.voice or str(settings.get("openai_tts_voice") or "coral")
        elif provider == "supertonic":
            model = req.model or "supertonic-3"
            voice = req.voice or str(settings.get("supertonic_voice") or "M1")
        else:
            model = req.model or str(settings.get("elevenlabs_model") or "eleven_flash_v2_5")
            voice = req.voice or str(settings.get("elevenlabs_voice_id") or "")
        api_key = ""
        if provider == "elevenlabs":
            api_key = secrets.get("elevenlabs_api_key") or ""
            if not api_key:
                raise HTTPException(400, "ElevenLabs API anahtarı ayarlanmamış. Ayarlar sayfasından ekleyin.")
            if not voice:
                raise HTTPException(400, "Lütfen Ayarlar sayfasından bir ElevenLabs sesi seçin.")
        elif provider == "openai_tts":
            api_key = secrets.get("openai_api_key") or ""
            if not api_key:
                raise HTTPException(400, "OpenAI API anahtarı ayarlanmamış. Ayarlar → Çeviri sekmesinden OpenAI anahtarınızı ekleyin.")
            model = model if model in OPENAI_TTS_MODELS else "gpt-4o-mini-tts"
            voice = voice if voice in OPENAI_TTS_VOICES else "coral"
        elif provider == "supertonic":
            voice = voice if voice in SUPERTONIC_VOICES else "M1"
        elif provider == "mock":
            voice = voice or "mock-tr"
        elif provider == "edge_tts":
            voice = voice if voice in EDGE_TTS_VOICES else "tr-TR-AhmetNeural"

        budget = int(settings.get("elevenlabs_char_budget") or 10000)

        if not req.async_job:
            try:
                return narrate_item(lib, identifier, provider=provider, model=model, voice=voice, api_key=api_key, char_budget=budget)
            except Exception as exc:
                raise HTTPException(422, str(exc))

        job = jobs.create_job(
            job_type="narrate",
            stage="GENERATING_AUDIO",
            item_id=identifier,
            provider=provider,
            model=model,
            payload={"voice": voice},
        )
        job_id = str(job["id"])

        def _work(jid: str):
            def _progress(done: int, total: int, hits: int):
                stage = "ASSEMBLING_AUDIO" if done == total else "GENERATING_AUDIO"
                jobs.update(
                    jid,
                    stage=stage,
                    processed_segments=done,
                    total_segments=total,
                    cache_hits=hits,
                    progress=round(done / max(1, total), 3),
                )

            res = narrate_item(
                lib,
                identifier,
                provider=provider,
                model=model,
                voice=voice,
                api_key=api_key,
                char_budget=budget,
                on_progress=_progress,
                is_cancelled=lambda: jobs.is_cancelled(jid),
            )
            return {"characters_billed": res["characters_billed"]}

        return jobs.submit(job_id, _work)

    @app.post("/api/items/{identifier}/podcast")
    def podcast_endpoint(identifier: str, req: PodcastRequest):
        lookup(identifier)
        try:
            translator = _resolve_translator(lib, secrets, req.provider, req.model, "summary")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

        tts_api_key = ""
        if req.tts_provider == "openai_tts":
            tts_api_key = secrets.get("openai_api_key") or ""
            if not tts_api_key:
                raise HTTPException(400, "OpenAI TTS için Ayarlar → Çeviri sekmesinden OpenAI API anahtarınızı ekleyin.")

        if not req.async_job:
            try:
                return generate_podcast_episode(
                    lib,
                    identifier,
                    translator,
                    length=req.length,
                    tts_provider=req.tts_provider,
                    tts_api_key=tts_api_key,
                )
            except Exception as exc:
                raise HTTPException(422, str(exc))

        job = jobs.create_job(
            job_type="podcast",
            stage="WRITING_SCRIPT",
            item_id=identifier,
            provider=f"{translator.provider_name}+{req.tts_provider}",
            model=translator.model_name,
            payload={"length": req.length},
        )
        job_id = str(job["id"])

        def _work(jid: str):
            def _progress(stage: str, done: int, total: int, hits: int):
                pct = 0.15 if stage == "WRITING_SCRIPT" else (0.2 + 0.8 * (done / max(1, total)))
                jobs.update(
                    jid,
                    stage=stage,
                    processed_segments=done,
                    total_segments=total,
                    cache_hits=hits,
                    progress=round(min(1.0, pct), 3),
                )

            res = generate_podcast_episode(
                lib,
                identifier,
                translator,
                length=req.length,
                tts_provider=req.tts_provider,
                tts_api_key=tts_api_key,
                on_progress=_progress,
                is_cancelled=lambda: jobs.is_cancelled(jid),
            )
            return {"turns": res["turns"], "duration_sec": res["duration_sec"]}

        return jobs.submit(job_id, _work)

    @app.get("/api/items/{identifier}/audio")
    def get_item_audio(identifier: str, kind: Literal["auto", "generated", "source"] = "auto"):
        item = lookup(identifier)
        chosen = ""
        if kind == "generated":
            chosen = str(item.get("audio_path") or "")
        elif kind == "source":
            chosen = str(item.get("source_audio_path") or "")
        else:
            chosen = str(item.get("audio_path") or item.get("source_audio_path") or "")
        if not chosen:
            raise HTTPException(404, "Bu içerik için ses dosyası bulunamadı")
        fp = Path(chosen)
        if not fp.is_file():
            raise HTTPException(404, "Ses dosyası diskte bulunamadı")
        ext = fp.suffix.lower()
        media_type = {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".ogg": "audio/ogg",
            ".webm": "audio/webm",
            ".flac": "audio/flac",
        }.get(ext, "audio/mpeg")
        return FileResponse(fp, media_type=media_type, filename=f"{identifier}{ext or '.mp3'}")

    @app.patch("/api/items/{identifier}/audio-progress")
    def update_audio_progress(identifier: str, req: AudioProgressRequest):
        lookup(identifier)
        return lib.audio_progress(identifier, req.position_sec, req.duration_sec)

    @app.post("/api/items/{identifier}/transcribe")
    def transcribe_endpoint(identifier: str, req: TranscribeRequest):
        item = lookup(identifier)
        audio_path = str(item.get("source_audio_path") or item.get("audio_path") or "")
        if not req.mock and (not audio_path or not Path(audio_path).is_file()):
            raise HTTPException(400, "Bu içerik için yüklü bir kaynak ses dosyası yok.")

        settings = lib.get_settings()
        model = req.model or str(settings.get("whisper_model") or "small")
        device = req.device or str(settings.get("whisper_device") or "cpu")
        allow_dl = req.allow_download if req.allow_download is not None else bool(settings.get("whisper_allow_download"))
        lang = None if (req.language == "auto" or (req.language is None and settings.get("whisper_auto_language"))) else req.language

        if not req.async_job:
            if req.mock:
                segs = [
                    {"start": 0.0, "end": 4.2, "text": "Statistical inference helps us reason about population parameters."},
                    {"start": 4.2, "end": 8.5, "text": "Model inference computes predictions with latency under 15 ms."},
                ]
                return lib.set_transcript_result(identifier, text="\n".join(s["text"] for s in segs), language="en", segments=segs, duration_sec=8.5)
            result = whisper_transcribe(audio_path, model=model, allow_download=allow_dl, device=device, language=lang)
            return lib.set_transcript_result(
                identifier,
                text=str(result["text"]),
                language=str(result["language"]),
                segments=list(result["segments"]),
                duration_sec=float(result["duration"]),
            )

        job = jobs.create_job(
            job_type="transcribe",
            stage="TRANSCRIBING",
            item_id=identifier,
            provider="mock" if req.mock else "faster-whisper",
            model=model,
        )
        job_id = str(job["id"])

        def _work(jid: str):
            jobs.update(jid, stage="TRANSCRIBING", progress=0.2)
            if req.mock:
                segs = [
                    {"start": 0.0, "end": 4.2, "text": "Statistical inference helps us reason about population parameters."},
                    {"start": 4.2, "end": 8.5, "text": "Model inference computes predictions with latency under 15 ms."},
                ]
                lib.set_transcript_result(identifier, text="\n".join(s["text"] for s in segs), language="en", segments=segs, duration_sec=8.5)
                jobs.update(jid, processed_segments=len(segs), total_segments=len(segs), progress=0.9)
                return {}
            result = whisper_transcribe(audio_path, model=model, allow_download=allow_dl, device=device, language=lang)
            segs = list(result["segments"])
            lib.set_transcript_result(
                identifier,
                text=str(result["text"]),
                language=str(result["language"]),
                segments=segs,
                duration_sec=float(result["duration"]),
            )
            jobs.update(jid, processed_segments=len(segs), total_segments=len(segs), progress=0.9)
            return {}

        return jobs.submit(job_id, _work)

    @app.patch("/api/items/{identifier}/progress")
    def progress(identifier: str, req: Progress):
        lookup(identifier)
        return lib.progress(identifier, req.position)

    @app.delete("/api/items/{identifier}", status_code=204)
    def delete(identifier: str):
        lookup(identifier)
        lib.delete(identifier)

    @app.patch("/api/items/{identifier}/metadata")
    def metadata(identifier: str, req: Metadata):
        lookup(identifier)
        return lib.metadata(
            identifier,
            req.favorite,
            req.notes,
            req.category,
            is_read=req.is_read,
            highlights=req.highlights,
        )

    @app.get("/api/items/{identifier}/export")
    def export(identifier: str, fmt: Literal["txt", "md"] = Query(default="txt", alias="format")):
        item = lookup(identifier)
        if fmt == "md":
            lines = [f"# {item['title']}"]
            if item.get("author"):
                lines.append(f"**Yazar:** {item['author']}")
            if item.get("source"):
                lines.append(f"**Kaynak:** {item['source']}")
            if item.get("translated"):
                lines.append("\n## Türkçe Çeviri\n")
                lines.append(str(item["translated"]))
            lines.append("\n## Orijinal Metin\n")
            lines.append(str(item["original"]))
            return PlainTextResponse(
                "\n\n".join(lines),
                headers={"Content-Disposition": f"attachment; filename=knowledge-hub-{identifier[:8]}.md"},
            )
        return PlainTextResponse(
            str(item["title"]) + "\n\n" + str(item["original"]) + "\n\n" + str(item.get("translated") or ""),
            headers={"Content-Disposition": "attachment; filename=knowledge-hub.txt"},
        )

    # --- File uploads (PDF, EPUB, TXT, HTML, SRT, VTT, Audio) ---

    @app.post("/api/upload/document", status_code=201)
    async def upload_document(
        file: UploadFile = File(...),
        title: str = Form(default=""),
        category: str = Form(default=""),
    ):
        raw_name = Path(file.filename or "document.txt").name
        ext = Path(raw_name).suffix.lower()
        allowed = {".txt", ".md", ".html", ".htm", ".srt", ".vtt", ".pdf", ".epub"}
        if ext not in allowed:
            raise HTTPException(422, f"Desteklenmeyen dosya türü: {ext}")
        data = await file.read(50_000_001)
        if not data or len(data) > 50_000_000:
            raise HTTPException(422, "Dosya boş veya 50 MB sınırını aşıyor.")

        clean_title = title.strip() or Path(raw_name).stem or "Yüklenen Belge"
        try:
            if ext in {".pdf", ".epub"}:
                safe_file = lib.media_dir / f"{uuid4().hex}{ext}"
                safe_file.write_bytes(data)
                try:
                    extracted_text = extract_document_file(safe_file)
                finally:
                    safe_file.unlink(missing_ok=True)
                return lib.add(clean_title, raw_name, "document", extracted_text, category=category)
            text = data.decode("utf-8-sig")
            if ext in {".html", ".htm"}:
                rich = extract_rich(text)
                return lib.add(
                    title.strip() or rich.title or clean_title,
                    raw_name,
                    "article",
                    rich.text,
                    author=rich.author,
                    published_at=rich.published_at,
                    category=category,
                    source_lang=rich.language_hint,
                    structured_blocks=rich.blocks,
                )
            if ext in {".srt", ".vtt"}:
                parsed = parse_transcript(text)
                return lib.add(clean_title, raw_name, "podcast", parsed, category=category)
            return lib.add(clean_title, raw_name, "document", text, category=category)
        except Exception as exc:
            raise HTTPException(422, f"Belge işlenemedi: {exc}")

    @app.post("/api/upload/audio", status_code=201)
    async def upload_audio(
        file: UploadFile = File(...),
        title: str = Form(default=""),
        category: str = Form(default="Podcastlar"),
    ):
        raw_name = Path(file.filename or "audio.mp3").name
        ext = Path(raw_name).suffix.lower()
        allowed = {".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac"}
        if ext not in allowed:
            raise HTTPException(422, f"Desteklenmeyen ses biçimi: {ext}")
        data = await file.read(200_000_001)
        if not data or len(data) > 200_000_000:
            raise HTTPException(422, "Ses dosyası boş veya 200 MB sınırını aşıyor.")
        safe_path = lib.media_dir / f"{uuid4().hex}{ext}"
        safe_path.write_bytes(data)
        clean_title = title.strip() or Path(raw_name).stem or "Podcast Bölümü"
        return lib.add(
            clean_title,
            raw_name,
            "podcast",
            f"Ses dosyası yüklendi ({raw_name}). Transkripsiyon başlatmak için 'Transkribe Et' butonunu kullanın.",
            category=category,
            source_audio_path=str(safe_path),
        )

    # --- URL & Feed endpoints (backward compatible + enriched) ---

    def _import_youtube_item(url: str) -> dict[str, object]:
        yt = fetch_youtube_transcript(url)
        item = lib.add(
            str(yt["title"]),
            str(yt["url"]),
            "podcast",
            str(yt["text"]),
            author=str(yt["author"]),
            category="YouTube",
            source_lang=str(yt["language"]),
        )
        return lib.set_transcript_result(
            str(item["id"]),
            text=str(yt["text"]),
            language=str(yt["language"]),
            segments=list(yt["segments"]),
            duration_sec=float(yt["duration_sec"]),
        )

    @app.post("/api/import-youtube", status_code=201)
    def import_youtube(req: URLRequest):
        try:
            return _import_youtube_item(req.url)
        except Exception as exc:
            raise HTTPException(422, f"YouTube transkripti alınamadı ({exc}).")

    @app.post("/api/import-url", status_code=201)
    def import_url(req: URLRequest):
        try:
            if extract_youtube_video_id(req.url):
                return _import_youtube_item(req.url)
            html, final_url = fetch_public_with_final_url(req.url, expected="html", max_redirects=2)
            rich = extract_rich(html, url=final_url)
            return lib.add(
                rich.title or (urlsplit(final_url).hostname or "Makale"),
                final_url,
                "article",
                rich.text,
                author=rich.author,
                published_at=rich.published_at,
                source_lang=rich.language_hint,
                structured_blocks=rich.blocks,
            )
        except Exception as exc:
            raise HTTPException(422, f"İçerik getirilemedi ({exc}); yerel HTML veya metin yüklemeyi deneyin.")

    @app.post("/api/feed/parse")
    def feed_parse(req: FeedRequest):
        try:
            return parse_feed(req.xml)
        except Exception:
            raise HTTPException(422, "Geçersiz veya desteklenmeyen RSS/Atom akışı")

    @app.post("/api/feed/url")
    def feed_url(req: URLRequest):
        try:
            return parse_feed(fetch_public(req.url, expected="xml", max_redirects=2))
        except Exception:
            raise HTTPException(422, "Herkese açık RSS akışı getirilemedi")

    # --- Discover & Curated Sources ---

    @app.get("/api/sources")
    def api_list_sources():
        return list_sources(lib)

    @app.post("/api/sources", status_code=201)
    def api_add_source(req: SourceCreateRequest):
        try:
            return add_source(lib, req.name, req.url, req.category, req.kind)
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.delete("/api/sources/{source_id}", status_code=204)
    def api_delete_source(source_id: str):
        try:
            delete_source(lib, source_id)
        except KeyError:
            raise HTTPException(404, "Kaynak bulunamadı")

    @app.post("/api/sources/{source_id}/refresh")
    def api_refresh_source(source_id: str):
        try:
            return refresh_source(lib, source_id)
        except KeyError:
            raise HTTPException(404, "Kaynak bulunamadı")
        except Exception as exc:
            raise HTTPException(422, f"Kaynak yenilenemedi: {exc}")

    @app.post("/api/sources/refresh-all")
    def api_refresh_all():
        results = []
        for src in list_sources(lib):
            if not src.get("enabled"):
                continue
            try:
                res = refresh_source(lib, str(src["id"]))
                results.append({"source_id": src["id"], "name": src["name"], "ok": True, **res})
            except Exception as exc:
                results.append({"source_id": src["id"], "name": src["name"], "ok": False, "error": str(exc)})
        return results

    @app.get("/api/discover/entries")
    def api_discover_entries(source_id: str | None = None, unread_only: bool = False):
        return list_entries(lib, source_id=source_id, unread_only=unread_only)

    @app.patch("/api/discover/entries/{entry_id}")
    def api_mark_entry(entry_id: str, req: EntryReadRequest):
        try:
            return mark_entry_read(lib, entry_id, req.is_read)
        except KeyError:
            raise HTTPException(404, "Yayın bulunamadı")

    @app.post("/api/discover/entries/{entry_id}/import", status_code=201)
    def api_import_entry(entry_id: str):
        try:
            return import_feed_entry(lib, entry_id)
        except KeyError:
            raise HTTPException(404, "Yayın bulunamadı")
        except Exception as exc:
            raise HTTPException(422, f"Yayın kütüphaneye aktarılamadı: {exc}")

    # --- Settings & Secure Secrets ---

    @app.get("/api/settings")
    def api_get_settings():
        return lib.get_settings()

    @app.patch("/api/settings")
    def api_update_settings(patch: dict[str, object]):
        return lib.update_settings(patch)

    @app.get("/api/secrets/status")
    def api_secrets_status():
        return secrets.status()

    @app.put("/api/secrets")
    def api_update_secrets(req: SecretsUpdateRequest):
        data = req.model_dump(exclude_unset=True)
        for k, v in data.items():
            if k in SUPPORTED_KEYS:
                secrets.set(k, v)
        return secrets.status()

    # --- Providers ---

    @app.get("/api/providers/openrouter/models")
    def api_openrouter_models():
        settings = lib.get_settings()
        base_url = str(settings.get("openrouter_base_url") or "https://openrouter.ai/api/v1")
        key = secrets.get("openrouter_api_key")
        try:
            return fetch_openrouter_models(base_url=base_url, api_key=key)
        except Exception as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/providers/translation/test")
    def api_test_translation(req: TranslationTestRequest):
        settings = lib.get_settings()
        base_url = req.base_url or {
            "openrouter": str(settings.get("openrouter_base_url") or "https://openrouter.ai/api/v1"),
            "openai": str(settings.get("openai_base_url") or "https://api.openai.com/v1"),
            "custom": str(settings.get("custom_base_url") or "http://127.0.0.1:11434/v1"),
            "mock": "",
        }[req.provider]
        key_name = {"openrouter": "openrouter_api_key", "openai": "openai_api_key", "custom": "custom_llm_api_key"}.get(req.provider, "")
        key = (secrets.get(key_name) or "") if key_name else ""
        try:
            return test_translation_connection(provider=req.provider, base_url=base_url, api_key=key, model_name=req.model)
        except Exception as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/providers/elevenlabs/test")
    def api_test_elevenlabs():
        key = secrets.get("elevenlabs_api_key")
        if not key:
            raise HTTPException(400, "ElevenLabs API anahtarı yapılandırılmamış.")
        warnings: list[str] = []
        sub = None
        voices = []
        try:
            sub = get_elevenlabs_subscription(key)
        except Exception as exc:
            warnings.append(str(exc))
        try:
            voices = list_elevenlabs_voices(key)
        except Exception as exc:
            if sub is None:
                raise HTTPException(422, str(exc))
            warnings.append(str(exc))
        models = list_elevenlabs_models(key)
        return {"ok": True, "subscription": sub, "voices": voices, "models": models, "warnings": warnings}

    @app.get("/api/providers/elevenlabs/voices")
    def api_elevenlabs_voices():
        key = secrets.get("elevenlabs_api_key")
        if not key:
            raise HTTPException(400, "ElevenLabs API anahtarı yapılandırılmamış.")
        try:
            return list_elevenlabs_voices(key)
        except Exception as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/providers/elevenlabs/models")
    def api_elevenlabs_models():
        return list_elevenlabs_models(secrets.get("elevenlabs_api_key"))

    @app.post("/api/providers/elevenlabs/sample")
    def api_elevenlabs_sample(req: ElevenSampleRequest):
        key = secrets.get("elevenlabs_api_key")
        if not key:
            raise HTTPException(400, "ElevenLabs API anahtarı yapılandırılmamış.")
        try:
            audio_bytes, cost = synthesize_elevenlabs_chunk(
                req.text, api_key=key, voice_id=req.voice_id, model_id=req.model_id
            )
            sample_name = f"sample-{hashlib.sha256((req.voice_id + req.model_id + req.text).encode()).hexdigest()[:12]}.mp3"
            sample_path = lib.audio_dir / sample_name
            sample_path.write_bytes(audio_bytes)
            lib.record_usage("narration", "elevenlabs", req.model_id, characters=len(req.text))
            return {"url": f"/api/audio-samples/{sample_name}", "characters": len(req.text), "reported_character_cost": cost}
        except Exception as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/providers/supertonic/sample")
    def api_supertonic_sample(req: SupertonicSampleRequest):
        try:
            audio_bytes, dur = synthesize_supertonic_chunk(req.text, voice=req.voice, speed=req.speed, lang="tr")
            sample_name = f"sample-{hashlib.sha256(('st3' + req.voice + str(req.speed) + req.text).encode()).hexdigest()[:12]}.wav"
            sample_path = lib.audio_dir / sample_name
            sample_path.write_bytes(audio_bytes)
            return {"url": f"/api/audio-samples/{sample_name}", "voice": req.voice, "duration_sec": round(dur, 2)}
        except Exception as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/providers/edge-tts/sample")
    def api_edge_tts_sample(req: EdgeSampleRequest):
        try:
            chosen = req.voice if req.voice in EDGE_TTS_VOICES else "tr-TR-AhmetNeural"
            audio_bytes = synthesize_edge_tts_chunk(req.text, voice=chosen)
            sample_name = f"sample-{hashlib.sha256(('edge' + chosen + req.text).encode()).hexdigest()[:12]}.mp3"
            sample_path = lib.audio_dir / sample_name
            sample_path.write_bytes(audio_bytes)
            return {"url": f"/api/audio-samples/{sample_name}", "voice": chosen}
        except Exception as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/providers/openai-tts/sample")
    def api_openai_tts_sample(req: OpenAITtsSampleRequest):
        key = secrets.get("openai_api_key") or ""
        if not key:
            raise HTTPException(400, "OpenAI API anahtarı yapılandırılmamış. Ayarlar → Çeviri sekmesinden ekleyin.")
        try:
            chosen_voice = req.voice if req.voice in OPENAI_TTS_VOICES else "coral"
            chosen_model = req.model if req.model in OPENAI_TTS_MODELS else "gpt-4o-mini-tts"
            audio_bytes = synthesize_openai_tts_chunk(req.text, api_key=key, voice=chosen_voice, model=chosen_model)
            sample_name = f"sample-{hashlib.sha256(('oai' + chosen_model + chosen_voice + req.text).encode()).hexdigest()[:12]}.mp3"
            sample_path = lib.audio_dir / sample_name
            sample_path.write_bytes(audio_bytes)
            lib.record_usage("narration", "openai_tts", chosen_model, characters=len(req.text))
            return {"url": f"/api/audio-samples/{sample_name}", "voice": chosen_voice, "model": chosen_model}
        except Exception as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/audio-samples/{filename}")
    def api_get_sample(filename: str):
        if not re.fullmatch(r"sample-[a-f0-9]{12}\.(mp3|wav)", filename):
            raise HTTPException(404, "Örnek ses bulunamadı")
        fp = lib.audio_dir / filename
        if not fp.is_file():
            raise HTTPException(404, "Örnek ses dosyası bulunamadı")
        media_type = "audio/wav" if filename.endswith(".wav") else "audio/mpeg"
        return FileResponse(fp, media_type=media_type)

    @app.get("/api/providers/whisper/status")
    def api_whisper_status():
        return whisper_status()

    # --- Jobs ---

    @app.get("/api/jobs")
    def api_list_jobs():
        return jobs.list()

    @app.get("/api/jobs/{job_id}")
    def api_get_job(job_id: str):
        try:
            return jobs.get(job_id)
        except KeyError:
            raise HTTPException(404, "İşlem bulunamadı")

    @app.post("/api/jobs/{job_id}/cancel")
    def api_cancel_job(job_id: str):
        try:
            return jobs.cancel(job_id)
        except KeyError:
            raise HTTPException(404, "İşlem bulunamadı")

    # --- Glossary ---

    @app.get("/api/glossary")
    def api_list_glossary():
        return lib.list_glossary()

    @app.post("/api/glossary")
    def api_upsert_glossary(req: GlossaryUpsertRequest):
        try:
            return lib.upsert_glossary(
                req.term_en,
                req.term_tr,
                req.context_note,
                req.keep_english_parens,
                term_id=req.id,
            )
        except (ValueError, KeyError) as exc:
            raise HTTPException(422, str(exc))

    @app.delete("/api/glossary/{term_id}", status_code=204)
    def api_delete_glossary(term_id: str):
        try:
            lib.delete_glossary(term_id)
        except KeyError:
            raise HTTPException(404, "Terim bulunamadı")

    # --- Benchmark, Usage, Backup & System ---

    @app.get("/api/benchmark/cases")
    def api_benchmark_cases():
        cases_path = Path(__file__).resolve().parent.parent / "benchmarks" / "cases.json"
        if not cases_path.is_file():
            return {"rubric_weights": RUBRIC_WEIGHTS, "cases": []}
        return {"rubric_weights": RUBRIC_WEIGHTS, "cases": json.loads(cases_path.read_text(encoding="utf-8"))}

    @app.post("/api/benchmark/smoke")
    def api_benchmark_smoke():
        cases_path = Path(__file__).resolve().parent.parent / "benchmarks" / "cases.json"
        if not cases_path.is_file():
            raise HTTPException(404, "Benchmark dosyası bulunamadı")
        cases = json.loads(cases_path.read_text(encoding="utf-8"))
        lookup = build_reference_lookup(cases)
        return {"model": "reference-echo", "mode": "smoke-only", "rubric_weights": RUBRIC_WEIGHTS, "rows": evaluate_benchmark(cases, lookup.__getitem__)}

    @app.get("/api/usage")
    def api_usage():
        return lib.usage_summary()

    @app.post("/api/cache/clear")
    def api_cache_clear(req: CacheClearRequest):
        return lib.clear_caches(translation=req.translation, audio=req.audio)

    @app.get("/api/backup")
    def api_backup():
        fd, tmp_name = tempfile.mkstemp(suffix=".sqlite3")
        os.close(fd)
        tmp_path = Path(tmp_name)
        with lib.connect() as src_db:
            dst_db = sqlite3.connect(tmp_path)
            src_db.backup(dst_db)
            dst_db.close()
        data = tmp_path.read_bytes()
        tmp_path.unlink(missing_ok=True)
        return Response(
            content=data,
            media_type="application/x-sqlite3",
            headers={"Content-Disposition": "attachment; filename=knowledge-hub-backup.sqlite3"},
        )

    @app.get("/api/system/info")
    def api_system_info():
        return {
            "version": __version__,
            "db_path": str(lib.path),
            "audio_dir": str(lib.audio_dir),
            "media_dir": str(lib.media_dir),
            "secrets_backend": secrets.status()["openrouter_api_key"]["storage_backend"],
            "whisper": whisper_status(),
            "usage": lib.usage_summary(),
        }

    return app
