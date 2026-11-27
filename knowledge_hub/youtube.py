"""YouTube URL validation, oEmbed metadata lookup, and timestamped transcript ingestion."""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

import httpx

_YOUTUBE_HOSTS = frozenset({
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
})
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_youtube_video_id(url: str) -> str | None:
    """Return the 11-char YouTube video ID if url is a valid HTTPS YouTube link, else None."""
    try:
        parsed = urlsplit(url.strip())
    except Exception:
        return None
    if parsed.scheme != "https":
        return None
    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None

    vid = ""
    parts = [p for p in parsed.path.split("/") if p]
    if host.endswith("youtu.be"):
        vid = parts[0] if parts else ""
    elif parts and parts[0] == "watch":
        vid = (parse_qs(parsed.query).get("v") or [""])[0]
    elif len(parts) >= 2 and parts[0] in {"shorts", "live", "embed", "v"}:
        vid = parts[1]
    elif "v" in parse_qs(parsed.query):
        vid = (parse_qs(parsed.query).get("v") or [""])[0]

    return vid if _VIDEO_ID_RE.fullmatch(vid) else None


def fetch_youtube_metadata(video_id: str, *, transport: httpx.BaseTransport | None = None) -> dict[str, str]:
    """Fetch public video title & channel name via YouTube's official oEmbed endpoint."""
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with httpx.Client(timeout=10.0, transport=transport) as client:
            resp = client.get(
                "https://www.youtube.com/oembed",
                params={"url": canonical, "format": "json"},
                headers={"Accept": "application/json"},
            )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "title": str(data.get("title") or "").strip() or f"YouTube Video ({video_id})",
                "author": str(data.get("author_name") or "").strip(),
            }
    except Exception:
        pass
    return {"title": f"YouTube Video ({video_id})", "author": ""}


_CAPTION_NOISE_RE = re.compile(r"\[(?:music|applause|laughter|inaudible|cheering|silence)\]", re.I)


def clean_caption_snippet(raw_text: str) -> str:
    """Clean YouTube auto-caption speaker arrows (>>) and bracketed sound tags ([music])."""
    cleaned = _CAPTION_NOISE_RE.sub(" ", raw_text)
    cleaned = re.sub(r"(?:^|\s)>>+\s*", " ", cleaned)
    cleaned = re.sub(r"^\s*>\s*", "", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def group_transcript_paragraphs(segments: list[dict[str, object]], *, target_chars: int = 480) -> str:
    """Group short caption snippets into clean readable paragraphs for editorial reading & translation."""
    paragraphs: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for seg in segments:
        piece = clean_caption_snippet(str(seg.get("text") or ""))
        if not piece:
            continue
        buf.append(piece)
        buf_len += len(piece) + 1
        ends_sentence = piece.endswith((".", "!", "?"))
        if buf_len >= target_chars and (ends_sentence or buf_len >= target_chars + 180):
            paragraphs.append(" ".join(buf))
            buf = []
            buf_len = 0
    if buf:
        paragraphs.append(" ".join(buf))
    return "\n\n".join(paragraphs)


def fetch_youtube_transcript(
    url: str,
    *,
    preferred_langs: tuple[str, ...] = ("en", "tr", "en-US", "en-GB"),
    transport: httpx.BaseTransport | None = None,
) -> dict[str, object]:
    """Fetch metadata and timestamped transcript from a public YouTube URL."""
    video_id = extract_youtube_video_id(url)
    if not video_id:
        raise ValueError("Geçerli bir HTTPS YouTube video adresi değil.")

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as exc:
        raise RuntimeError(
            "YouTube transkript modülü kurulu değil. Kurmak için: pip install youtube-transcript-api"
        ) from exc

    api = YouTubeTranscriptApi()
    try:
        transcript_list = api.list(video_id)
        chosen = None
        try:
            chosen = transcript_list.find_transcript(list(preferred_langs))
        except Exception:
            for tr in transcript_list:
                chosen = tr
                break
        if chosen is None:
            raise ValueError("Bu video için erişilebilir altyazı/transkript bulunamadı.")
        fetched = chosen.fetch()
        lang_code = str(getattr(chosen, "language_code", "en") or "en").split("-")[0].lower()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"YouTube transkripti alınamadı: {exc}") from exc

    segments: list[dict[str, object]] = []
    for entry in fetched:
        if isinstance(entry, dict):
            raw_text = str(entry.get("text") or "")
            start = float(entry.get("start") or 0.0)
            dur = float(entry.get("duration") or 0.0)
        else:
            raw_text = str(getattr(entry, "text", "") or "")
            start = float(getattr(entry, "start", 0.0) or 0.0)
            dur = float(getattr(entry, "duration", 0.0) or 0.0)
        clean = clean_caption_snippet(raw_text)
        if not clean:
            continue
        segments.append({
            "start": round(start, 2),
            "end": round(start + max(0.5, dur), 2),
            "text": clean,
        })

    if not segments:
        raise ValueError("Videoda boş olmayan transkript satırı bulunamadı.")

    meta = fetch_youtube_metadata(video_id, transport=transport)
    grouped_text = group_transcript_paragraphs(segments)
    duration_sec = round(float(segments[-1]["end"]), 1)
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    return {
        "video_id": video_id,
        "url": canonical,
        "title": meta["title"],
        "author": meta["author"],
        "language": lang_code,
        "text": grouped_text,
        "segments": segments,
        "duration_sec": duration_sec,
    }
