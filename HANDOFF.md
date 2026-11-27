# Handoff — 2026-11-27 22:08 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Build **Phase 2 (v0.6)** on `feat/mvp-foundation` (PR #1): Mobile/iPhone API readiness (Tailscale HTTPS + Bearer auth + HTTP 206 Range audio streaming), YouTube transcript import, and NotebookLM-style 2-speaker Turkish podcast generation — preparing the shared backend for **Phase 3 (iOS App Store via Expo/React Native)**.

## Done
- **Phase 1 Accepted (Checkpoints 1–5):** Locked iOS App Store scope (`docs/SCOPE.md`), API-first architecture & editorial UX constitution (`docs/ARCHITECTURE.md`), Python 3.11 `.venv` + RTX 3050 CUDA Faster-Whisper, Edge Neural TTS (`AhmetNeural` / `EmelNeural`), warm paper/ink editorial UI verified on desktop & 390px iPhone viewport.
- **Checkpoint 6 (`843b4d1` — Mobile API Readiness):** Optional `KH_API_TOKEN` Bearer middleware (`knowledge_hub/auth.py`), `/api/health`, HTTP `206 Partial Content` (`Range`) audio streaming verified, `docs/MOBILE_ACCESS.md` Tailscale iPhone guide.
- **Checkpoint 7 (YouTube URL → Timestamped Transcript Import):**
  - Added `knowledge_hub/youtube.py` (`extract_youtube_video_id`, `fetch_youtube_metadata` via official oEmbed, `group_transcript_paragraphs`, `fetch_youtube_transcript` via `youtube-transcript-api>=1.0`).
  - Wired `POST /api/import-youtube` and automatic YouTube URL detection right inside `POST /api/import-url` so pasting any YouTube link (`watch?v=`, `youtu.be/`, `shorts/`, `live/`) into **İçerik Ekle** imports title, channel, clean readable paragraphs, and timestamped `transcript_json`.
  - Updated `pyproject.toml` (`media` extra) and UI URL modal (`sw.js` -> `kh-shell-v11`).
  - Added offline/mock tests in `tests/test_youtube_and_podcast.py` (59/59 tests passing).

## In progress
- **Checkpoint 8 (Next):** NotebookLM-style 2-speaker Turkish Podcast generator (`knowledge_hub/podcast.py` — Ahmet & Emel conversational technical podcast script via LLM + dual-voice Edge Neural TTS MP3 assembly + UI trigger in Reader & Listen views).

## Next steps
1. **Checkpoint 8:** Implement `knowledge_hub/podcast.py`, `POST /api/items/{id}/podcast`, UI button **"Podcast Sohbeti Üret (2 Kişilik)"** in Reader & Listen views, offline/mock tests in `tests/test_youtube_and_podcast.py`, verify `pytest`, restart local server, commit & push.
2. **Phase 2 Live Test with User:** User tests pasting a real YouTube link + generating a 2-speaker Turkish podcast MP3, then optionally tests Tailscale HTTPS on iPhone.
3. **Phase 3 (v1.0 — Native iOS App Store):** Scaffold Expo (React Native, TypeScript) iOS app with Share Extension + `react-native-track-player` + offline bundle -> TestFlight / App Store Connect via EAS Build.

## Decisions & why
- **Auto-detect YouTube inside `/api/import-url`** — Users (and future iOS Share Extension!) just paste or share any link without picking separate "Article" vs "YouTube" importers.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user approves merge.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
```
