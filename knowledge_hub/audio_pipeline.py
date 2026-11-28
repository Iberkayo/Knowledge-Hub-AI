"""Narration pipeline: ElevenLabs premium TTS, free alternatives, chunk caching & MP3 assembly."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from threading import Lock
from typing import Callable
import wave

import httpx

from knowledge_hub.library import Library

ELEVEN_BASE = "https://api.elevenlabs.io/v1"
ELEVEN_MODELS = (
    {"id": "eleven_flash_v2_5", "name": "Eleven Flash v2.5 (Düşük Gecikme / Ekonomik)"},
    {"id": "eleven_multilingual_v2", "name": "Eleven Multilingual v2 (Yüksek Doğallık)"},
)
SUPERTONIC_VOICES = ("M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5")
EDGE_TTS_VOICES = ("tr-TR-AhmetNeural", "tr-TR-EmelNeural")
OPENAI_TTS_MODELS = ("gpt-4o-mini-tts", "tts-1-hd", "tts-1")
OPENAI_TTS_VOICES = ("coral", "onyx", "nova", "ash", "sage", "alloy", "echo", "shimmer")
OPENAI_TTS_DEFAULT_INSTRUCTIONS = (
    "Anadili Türkçe olan, sıcak, akıcı ve doğal bir teknoloji podcast anlatıcısı gibi oku. "
    "Noktalama işaretlerinde doğal duraklama ve doğru Türkçe vurgu kullan; robotik okuma."
)
_SUPERTONIC_LOCK = Lock()
_SUPERTONIC_ENGINE = None

# Minimal valid MPEG-1 Layer 3 silent frame for mock/offline testing
_MOCK_MP3_FRAME = b"\xff\xfb\x90\x00" + b"\x00" * 413


def clean_narration_text(text: str) -> str:
    """Prepare translated Markdown text for natural speech synthesis (skip code, tables, raw URLs)."""
    # Completely omit fenced code blocks and display math — code should never be spoken aloud
    cleaned = re.sub(r"```[\s\S]*?```", "\n\n", text)
    cleaned = re.sub(r"\$\$[\s\S]*?\$\$", "\n\n", cleaned)
    # Remove markdown table lines
    cleaned = re.sub(r"(?m)^\s*\|.*\|\s*$", "", cleaned)
    # Keep link labels, drop raw URLs
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"https?://\S+", "", cleaned)
    # Drop inline code backticks; omit code-like tokens with symbols/underscores/paths
    def _clean_inline_code(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        if any(ch in inner for ch in ("(", ")", "{", "}", "[", "]", "=", ";", "/", "\\", "--")) or len(inner) > 36:
            return ""
        return inner

    cleaned = re.sub(r"`([^`]+)`", _clean_inline_code, cleaned)
    cleaned = re.sub(r"^#{1,6}\s+", "", cleaned, flags=re.M)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def chunk_narration_text(text: str, max_chars: int = 900) -> list[str]:
    """Split text at paragraph and sentence boundaries within character budget."""
    clean = clean_narration_text(text)
    if not clean:
        return []
    chunks: list[str] = []
    for para in re.split(r"\n\s*\n", clean):
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chars:
            chunks.append(para)
            continue
        sentences = re.split(r"(?<=[.!?…])\s+", para)
        buf = ""
        for sent in sentences:
            if not sent:
                continue
            if len(buf) + len(sent) + 1 <= max_chars:
                buf = (buf + " " + sent).strip()
            else:
                if buf:
                    chunks.append(buf)
                while len(sent) > max_chars:
                    cut = sent.rfind(" ", 0, max_chars + 1)
                    if cut <= 0:
                        cut = max_chars
                    chunks.append(sent[:cut].strip())
                    sent = sent[cut:].strip()
                buf = sent
        if buf:
            chunks.append(buf)
    return chunks


def audio_cache_key(text: str, provider: str, model: str, voice: str, fmt: str = "mp3_44100_128") -> str:
    payload = json.dumps([text, provider, model, voice, fmt], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _strip_id3v2(data: bytes) -> bytes:
    """Strip leading ID3v2 tag when concatenating MP3 frames cleanly."""
    if len(data) >= 10 and data[:3] == b"ID3":
        size = (
            ((data[6] & 0x7F) << 21)
            | ((data[7] & 0x7F) << 14)
            | ((data[8] & 0x7F) << 7)
            | (data[9] & 0x7F)
        )
        offset = 10 + size
        if offset < len(data):
            return data[offset:]
    return data


def assemble_mp3_files(part_paths: list[Path], out_path: Path) -> Path:
    """Assemble chunk MP3 files using FFmpeg when available, or clean MP3 concatenation."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if len(part_paths) == 1:
        shutil.copyfile(part_paths[0], out_path)
        return out_path

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as lst:
            for p in part_paths:
                escaped = str(p.resolve()).replace("'", "'\\''")
                lst.write(f"file '{escaped}'\n")
            list_path = Path(lst.name)
        tmp_out = out_path.with_suffix(".tmp.mp3")
        try:
            proc = subprocess.run(
                [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_path), "-c", "copy", str(tmp_out)],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if proc.returncode == 0 and tmp_out.is_file() and tmp_out.stat().st_size > 0:
                tmp_out.replace(out_path)
                return out_path
        finally:
            list_path.unlink(missing_ok=True)
            tmp_out.unlink(missing_ok=True)

    # Pure-Python fallback: keep first file's header, strip ID3v2 on subsequent parts
    tmp_out = out_path.with_suffix(".tmp.mp3")
    with tmp_out.open("wb") as out_f:
        for idx, p in enumerate(part_paths):
            raw = p.read_bytes()
            out_f.write(raw if idx == 0 else _strip_id3v2(raw))
    tmp_out.replace(out_path)
    return out_path


def assemble_wav_files(part_paths: list[Path], out_path: Path) -> Path:
    """Losslessly concatenate PCM WAV chunks using Python stdlib wave (no FFmpeg needed)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if len(part_paths) == 1:
        shutil.copyfile(part_paths[0], out_path)
        return out_path
    tmp_out = out_path.with_suffix(".tmp.wav")
    with wave.open(str(part_paths[0]), "rb") as first:
        params = first.getparams()
        with wave.open(str(tmp_out), "wb") as out_wav:
            out_wav.setparams(params)
            out_wav.writeframes(first.readframes(first.getnframes()))
            for p in part_paths[1:]:
                with wave.open(str(p), "rb") as nxt:
                    out_wav.writeframes(nxt.readframes(nxt.getnframes()))
    tmp_out.replace(out_path)
    return out_path


def _get_supertonic_tts():
    global _SUPERTONIC_ENGINE
    with _SUPERTONIC_LOCK:
        if _SUPERTONIC_ENGINE is None:
            try:
                from supertonic import TTS
            except ImportError as exc:
                raise RuntimeError("Supertonic 3 kurulu değil. Kurmak için: pip install supertonic") from exc
            _SUPERTONIC_ENGINE = TTS(model="supertonic-3", auto_download=True)
        return _SUPERTONIC_ENGINE


_SUPERTONIC_CHAR_REPLACEMENTS = {
    "\u21a9": " ",   # ↩ footnote return arrow
    "\u21aa": " ",   # ↪
    "\ufe0e": "",    # text variation selector
    "\ufe0f": "",    # emoji variation selector
    "\u200b": "",    # zero-width space
    "\u200c": "",
    "\u200d": "",
    "\u00a0": " ",   # nbsp
    "\u2192": " ",   # →
    "\u2190": " ",   # ←
    "\u21d2": " ",   # ⇒
    "\u2013": "-",   # –
    "\u2014": " - ", # —
    "\u2026": "...", # …
    "\u201c": '"',
    "\u201d": '"',
    "\u2018": "'",
    "\u2019": "'",
    "\u00ab": '"',
    "\u00bb": '"',
    "\u2022": ", ",  # •
}


def sanitize_supertonic_text(text: str, supported_chars: set[str] | None = None) -> str:
    """Normalize typography and strip characters unsupported by Supertonic's UnicodeProcessor."""
    out = text
    for src, dst in _SUPERTONIC_CHAR_REPLACEMENTS.items():
        if src in out:
            out = out.replace(src, dst)
    if supported_chars is not None:
        out = "".join(ch if (ch in supported_chars or ch.isspace()) else " " for ch in out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def synthesize_supertonic_chunk(
    text: str,
    *,
    voice: str = "M1",
    speed: float = 1.05,
    lang: str = "tr",
) -> tuple[bytes, float]:
    """Synthesize a Turkish/multilingual audio chunk locally on CPU via Supertonic 3 ONNX."""
    import soundfile as sf

    chosen_voice = voice if voice in SUPERTONIC_VOICES else "M1"
    tts = _get_supertonic_tts()
    tp = getattr(getattr(tts, "model", None), "text_processor", None)
    supported = getattr(tp, "supported_character_set", None)
    clean_text = sanitize_supertonic_text(text, supported_chars=supported)
    if not clean_text:
        clean_text = "."
    with _SUPERTONIC_LOCK:
        style = tts.get_voice_style(voice_name=chosen_voice)
        wav, dur = tts.synthesize(clean_text, voice_style=style, speed=float(speed), lang=lang)
    buf = io.BytesIO()
    sr = int(getattr(tts, "sample_rate", 44100))
    sf.write(buf, wav.squeeze(), sr, format="WAV", subtype="PCM_16")
    dur_val = float(dur[0]) if hasattr(dur, "__len__") else float(dur)
    return buf.getvalue(), dur_val


# --- ElevenLabs API helpers ---

def _eleven_error_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        detail = body.get("detail")
        if isinstance(detail, dict):
            st = detail.get("status") or ""
            msg = detail.get("message") or ""
            return f"{st}: {msg}".strip(": ")[:220]
        if detail:
            return str(detail)[:220]
    except Exception:
        pass
    return f"HTTP {resp.status_code}"


def get_elevenlabs_subscription(api_key: str, transport: httpx.BaseTransport | None = None) -> dict[str, object]:
    if not api_key:
        raise ValueError("ElevenLabs API anahtarı yapılandırılmamış.")
    with httpx.Client(timeout=20.0, transport=transport) as client:
        resp = client.get(f"{ELEVEN_BASE}/user/subscription", headers={"xi-api-key": api_key})
    if resp.status_code >= 400:
        raise RuntimeError(f"ElevenLabs kredi bilgisi alınamadı (HTTP {resp.status_code} — {_eleven_error_detail(resp)}).")
    d = resp.json()
    limit = int(d.get("character_limit") or 0)
    used = int(d.get("character_count") or 0)
    return {
        "tier": d.get("tier") or "unknown",
        "character_count": used,
        "character_limit": limit,
        "remaining_characters": max(0, limit - used),
        "next_character_count_reset_unix": d.get("next_character_count_reset_unix"),
    }


def list_elevenlabs_voices(api_key: str, transport: httpx.BaseTransport | None = None) -> list[dict[str, object]]:
    if not api_key:
        raise ValueError("ElevenLabs API anahtarı yapılandırılmamış.")
    with httpx.Client(timeout=20.0, transport=transport) as client:
        resp = client.get(f"{ELEVEN_BASE}/voices", headers={"xi-api-key": api_key})
    if resp.status_code >= 400:
        raise RuntimeError(f"ElevenLabs ses listesi alınamadı (HTTP {resp.status_code} — {_eleven_error_detail(resp)}).")
    voices = []
    for v in resp.json().get("voices") or []:
        voices.append(
            {
                "voice_id": v.get("voice_id"),
                "name": v.get("name"),
                "category": v.get("category") or "",
                "labels": v.get("labels") or {},
                "preview_url": v.get("preview_url") or "",
            }
        )
    return voices


def list_elevenlabs_models(api_key: str | None = None, transport: httpx.BaseTransport | None = None) -> list[dict[str, object]]:
    if not api_key:
        return list(ELEVEN_MODELS)
    try:
        with httpx.Client(timeout=20.0, transport=transport) as client:
            resp = client.get(f"{ELEVEN_BASE}/models", headers={"xi-api-key": api_key})
        if resp.status_code >= 400:
            return list(ELEVEN_MODELS)
        models = []
        for m in resp.json():
            if m.get("can_do_text_to_speech"):
                models.append({"id": m.get("model_id"), "name": m.get("name") or m.get("model_id")})
        return models or list(ELEVEN_MODELS)
    except Exception:
        return list(ELEVEN_MODELS)


def synthesize_elevenlabs_chunk(
    text: str,
    *,
    api_key: str,
    voice_id: str,
    model_id: str,
    transport: httpx.BaseTransport | None = None,
) -> tuple[bytes, str]:
    if not api_key:
        raise ValueError("ElevenLabs API anahtarı yapılandırılmamış.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", voice_id or ""):
        raise ValueError("Geçersiz ElevenLabs ses kimliği (voice_id).")
    payload: dict[str, object] = {"text": text, "model_id": model_id}
    if model_id == "eleven_flash_v2_5":
        payload["language_code"] = "tr"
    with httpx.Client(timeout=90.0, transport=transport) as client:
        resp = client.post(
            f"{ELEVEN_BASE}/text-to-speech/{voice_id}?output_format=mp3_44100_128",
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json=payload,
        )
    if resp.status_code == 401:
        raise RuntimeError(f"ElevenLabs API anahtarı geçersiz veya yetkisiz (HTTP 401 — {_eleven_error_detail(resp)}).")
    if resp.status_code == 402 or resp.status_code == 429:
        raise RuntimeError(f"ElevenLabs kredi/kota sınırı aşıldı (HTTP {resp.status_code} — {_eleven_error_detail(resp)}).")
    if resp.status_code >= 400:
        raise RuntimeError(f"ElevenLabs ses üretimi başarısız (HTTP {resp.status_code} — {_eleven_error_detail(resp)}).")
    if not resp.headers.get("content-type", "").startswith("audio/"):
        raise ValueError("ElevenLabs beklenen ses formatını döndürmedi.")
    return resp.content, str(resp.headers.get("character-cost") or len(text))


# --- Cost estimation & full item narration ---

def estimate_narration_cost(
    lib: Library,
    item_id: str,
    *,
    provider: str,
    model: str,
    voice: str,
) -> dict[str, object]:
    item = lib.get(item_id)
    text = str(item.get("translated") or item.get("original") or "")
    chunks = chunk_narration_text(text)
    total_chars = sum(len(c) for c in chunks)
    cached_chunks = 0
    new_chars = 0

    with lib.connect() as db:
        for ch in chunks:
            key = audio_cache_key(ch, provider, model, voice)
            row = db.execute("SELECT file_path FROM audio_cache WHERE cache_key=?", (key,)).fetchone()
            if row and Path(row["file_path"]).is_file():
                cached_chunks += 1
            else:
                new_chars += len(ch)

    return {
        "item_id": item_id,
        "provider": provider,
        "model": model,
        "voice": voice,
        "total_chunks": len(chunks),
        "cached_chunks": cached_chunks,
        "new_chunks": len(chunks) - cached_chunks,
        "total_characters": total_chars,
        "new_characters_to_bill": new_chars if provider == "elevenlabs" else 0,
        "estimated_minutes": max(1, round(total_chars / 900)) if total_chars else 0,
    }


def narrate_item(
    lib: Library,
    item_id: str,
    *,
    provider: str,
    model: str,
    voice: str,
    api_key: str = "",
    char_budget: int = 10000,
    on_progress: Callable[[int, int, int], None] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, object]:
    """Generate persistent MP3 narration for an item with per-chunk cache & resume."""
    item = lib.get(item_id)
    text = str(item.get("translated") or item.get("original") or "")
    chunks = chunk_narration_text(text)
    if not chunks:
        raise ValueError("Seslendirilecek metin bulunamadı.")

    parts_dir = lib.audio_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    part_paths: list[Path] = []
    cache_hits = 0
    chars_billed = 0
    is_wav = provider == "supertonic"
    ext = ".wav" if is_wav else ".mp3"
    fmt_tag = "wav_44100_pcm16" if is_wav else "mp3_44100_128"

    for idx, ch in enumerate(chunks):
        if is_cancelled and is_cancelled():
            raise RuntimeError("JOB_CANCELLED")
        key = audio_cache_key(ch, provider, model, voice, fmt=fmt_tag)
        part_file = parts_dir / f"{key}{ext}"

        with lib.connect() as db:
            row = db.execute("SELECT file_path FROM audio_cache WHERE cache_key=?", (key,)).fetchone()
        if row and Path(row["file_path"]).is_file() and Path(row["file_path"]).stat().st_size > 0:
            part_paths.append(Path(row["file_path"]))
            cache_hits += 1
            if on_progress:
                on_progress(idx + 1, len(chunks), cache_hits)
            continue

        if provider == "mock":
            audio_bytes = _MOCK_MP3_FRAME * 4
            reported_cost = "0"
        elif provider == "supertonic":
            audio_bytes, _ = synthesize_supertonic_chunk(ch, voice=voice or "M1", lang="tr")
            reported_cost = "0"
        elif provider == "elevenlabs":
            if chars_billed + len(ch) > char_budget:
                raise ValueError(f"Yerel ElevenLabs karakter sınırı ({char_budget}) aşılıyor.")
            audio_bytes, reported_cost = synthesize_elevenlabs_chunk(
                ch, api_key=api_key, voice_id=voice, model_id=model, transport=transport
            )
            chars_billed += len(ch)
        elif provider == "edge_tts":
            audio_bytes = _synthesize_edge_tts(ch, voice or "tr-TR-AhmetNeural")
            reported_cost = "0"
        elif provider == "openai_tts":
            audio_bytes = synthesize_openai_tts_chunk(
                ch,
                api_key=api_key,
                voice=voice or "coral",
                model=model or "gpt-4o-mini-tts",
                transport=transport,
            )
            chars_billed += len(ch)
            reported_cost = str(len(ch))
        else:
            raise ValueError(f"Desteklenmeyen seslendirme sağlayıcısı: {provider}")

        tmp = part_file.with_suffix(".tmp")
        tmp.write_bytes(audio_bytes)
        tmp.replace(part_file)

        with lib.connect() as db:
            db.execute(
                """INSERT OR REPLACE INTO audio_cache(
                    cache_key, text_hash, provider, model, voice, format, file_path, chars_used, reported_cost, created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    key,
                    hashlib.sha256(ch.encode("utf-8")).hexdigest(),
                    provider,
                    model,
                    voice,
                    fmt_tag,
                    str(part_file),
                    len(ch),
                    reported_cost,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        part_paths.append(part_file)
        if on_progress:
            on_progress(idx + 1, len(chunks), cache_hits)

    final_path = lib.audio_dir / f"{item_id}-{provider}{ext}"
    if is_wav:
        assemble_wav_files(part_paths, final_path)
    else:
        assemble_mp3_files(part_paths, final_path)
    approx_duration = round(sum(len(c) for c in chunks) / 14.5, 1)

    if chars_billed > 0:
        lib.record_usage("narration", provider, model, characters=chars_billed, item_id=item_id)

    updated = lib.set_audio_result(
        item_id,
        audio_path=str(final_path),
        status="ready",
        provider=provider,
        model=model,
        voice=voice,
        duration_sec=approx_duration,
    )
    return {
        "item": updated,
        "audio_path": str(final_path),
        "total_chunks": len(chunks),
        "cache_hits": cache_hits,
        "characters_billed": chars_billed,
        "duration_sec": approx_duration,
    }


def synthesize_openai_tts_chunk(
    text: str,
    *,
    api_key: str,
    voice: str = "coral",
    model: str = "gpt-4o-mini-tts",
    instructions: str = OPENAI_TTS_DEFAULT_INSTRUCTIONS,
    base_url: str = "https://api.openai.com/v1",
    transport: httpx.BaseTransport | None = None,
) -> bytes:
    """Synthesize high-naturalness Turkish MP3 via OpenAI gpt-4o-mini-tts / tts-1-hd."""
    if not api_key:
        raise ValueError("OpenAI API anahtarı yapılandırılmamış. Ayarlar → Çeviri sekmesinden OpenAI anahtarınızı ekleyin.")
    chosen_voice = voice if voice in OPENAI_TTS_VOICES else "coral"
    chosen_model = model if model in OPENAI_TTS_MODELS else "gpt-4o-mini-tts"
    payload: dict[str, object] = {
        "model": chosen_model,
        "voice": chosen_voice,
        "input": text,
        "response_format": "mp3",
    }
    if chosen_model == "gpt-4o-mini-tts" and instructions:
        payload["instructions"] = instructions
    with httpx.Client(timeout=90.0, transport=transport) as client:
        resp = client.post(
            f"{base_url.rstrip('/')}/audio/speech",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code == 401:
        raise RuntimeError("OpenAI API anahtarı geçersiz veya yetkisiz (HTTP 401).")
    if resp.status_code in (402, 429):
        raise RuntimeError(f"OpenAI TTS kota/bakiye sınırı aşıldı (HTTP {resp.status_code}).")
    if resp.status_code >= 400:
        raise RuntimeError(f"OpenAI TTS ses üretimi başarısız (HTTP {resp.status_code}).")
    if not resp.content:
        raise ValueError("OpenAI TTS boş ses verisi döndürdü.")
    return resp.content


def synthesize_edge_tts_chunk(text: str, *, voice: str = "tr-TR-AhmetNeural") -> bytes:
    """Synthesize natural native Turkish speech via Microsoft Edge Neural TTS (free, MP3)."""
    chosen = voice if voice in EDGE_TTS_VOICES else "tr-TR-AhmetNeural"
    return _synthesize_edge_tts(text, chosen)


def _synthesize_edge_tts(text: str, voice: str) -> bytes:
    import asyncio
    import edge_tts

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(text, voice)
        buf = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.extend(chunk["data"])
        return bytes(buf)

    data = asyncio.run(_run())
    if not data:
        raise RuntimeError("Edge TTS ses verisi üretemedi.")
    return data
