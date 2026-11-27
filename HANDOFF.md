# Handoff — 2026-11-27 17:04 — Antigravity (Work PC -> Home PC w/ RTX 6GB)

## Goal
Complete and live-validate **Knowledge Hub AI v0.5.0** (personal Turkish-first technical reader & audio hub for AI/ML/Stats articles & podcasts) on `feat/mvp-foundation` (PR #1), then evaluate local GPU TTS & live APIs at home.

## Done
- **Backend v0.5.0 (`d587221`, `05501de`, `81fd97a`):**
  - Secure local secret store with Windows DPAPI (`knowledge_hub/secrets.py`), never stored in SQLite or returned raw to frontend.
  - Backward-compatible SQLite migrations (`knowledge_hub/library.py`): `content_segments`, `translation_cache`, `audio_cache`, `sources`, `feed_entries`, `jobs`, `glossary`, `app_settings`, `usage_events`.
  - Structure-preserving, context-aware translation pipeline (`knowledge_hub/translation.py`, `providers.py`, `glossary.py`, `qa.py`) with 3 explicit modes (`faithful`, `explained`, `summary`), prompt-injection isolation, 8-part cache key, and deterministic QA.
  - Persistent SQLite job queue with crash recovery & cancellation (`knowledge_hub/jobs.py`).
  - Rich HTML extraction (`knowledge_hub/ingest.py` `extract_rich()`) + SSRF-safe hop-validated redirect / Quarto JS redirect handling (`knowledge_hub/fetch_public.py`) verified live on `hamel.dev/evals/` (3931 words, title + author + date) and `felixrieseberg.com`.
  - Curated verified RSS/Atom discovery (`knowledge_hub/discover.py`, `feed.py`) with duplicate detection.
  - Audio & narration pipeline (`knowledge_hub/audio_pipeline.py`):
    - **Supertonic 3 (`Supertone/supertonic-3` ONNX, `lang="tr"`)** integrated as local unlimited free Turkish TTS (`M1–M5`, `F1–F5` voices, lossless stdlib `wave` WAV assembly, per-chunk cache).
    - ElevenLabs adapter (subscription, voices, models, sample test, scoped API key permission detail & fallback), Edge TTS, Browser Speech Synthesis, and Mock narrator.
  - Document (`.txt`, `.html`, `.pdf`, `.epub`, `.srt`, `.vtt`) and audio upload endpoints + Faster-Whisper job integration (`knowledge_hub/server.py`, `media.py`).
  - Expanded 14-case benchmark (`benchmarks/cases.json`, `benchmark.py`).
- **Frontend Product UX (`a4b6606`, `b51d7d7`, `05501de`, `81fd97a`):**
  - Turkish-first SPA (`knowledge_hub/static/index.html`, `styles.css`, `app.js`, `render.js`, `player.js`, `offline.js`, `sw.js`) with Dark/Light mode, 4 nav pages (**Kütüphanem**, **Keşfet**, **Dinle**, **Ayarlar**), safe pure-DOM Reader (Turkish / Original / Bilingual + font/width/progress/highlights/notes), persistent Spotify-like player + Media Session API, IndexedDB offline cache.
- **Tests & Docs (`718f4f7`, `80bd488`, `81fd97a`):**
  - **54/54 pytest tests passing** (27 existing + 27 new offline/mock tests across `tests/test_secrets_and_migration.py`, `test_translation_and_qa.py`, `test_audio_jobs_and_uploads.py`, `test_discover_and_extract.py`).
  - Windows scripts (`setup.ps1`, `start.ps1`, `start.bat`) and updated docs (`README.md`, `docs/SECURITY.md`, `docs/RELEASE.md`, `docs/OFFLINE.md`, `AGENTS.md`).

## In progress
- Live API & local TTS quality acceptance (Phase G) on the user's home PC (which has an RTX 6 GB VRAM GPU).

## Next steps
1. Pull `feat/mvp-foundation` on the home PC and run `.\setup.ps1` + `pip install -e ".[tts,media,ai]"` (with CUDA PyTorch if using GPU).
2. Run `start.bat` -> open `http://127.0.0.1:8000` -> enter OpenRouter API key in **Ayarlar** -> test real Turkish translation on `https://hamel.dev/evals/` and `https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/`.
3. Test **Supertonic 3** local Turkish narration on full translated articles; optionally add a GPU-accelerated **Chatterbox Multilingual (`tr`)** or **F5-TTS Turkish** provider in `knowledge_hub/audio_pipeline.py` (fits comfortably in 6 GB VRAM in `fp16`) if even higher voice naturalness is desired.
4. Test real **Faster-Whisper** (`small`/`medium` on `cuda` `float16`) transcription on a local podcast audio file via **Dinle** -> **Transkribe Et**.
5. Run visual browser verification (desktop + mobile 390px) and take screenshots for PR #1, then confirm CI is green on GitHub Actions.

## Decisions & why
- **Added `Supertone/supertonic-3` as default local TTS** — ElevenLabs Free tier (10k chars) runs out on a single technical article and blocks library voices (`HTTP 402 payment_required`); Supertonic 3 is ONNX, official `tr` support, unlimited, free, and fast even on CPU.
- **Modular zero-build ES6 frontend** — Zero Node toolchain required for Windows `start.bat` or Python-only CI while providing full SPA UX, pure-DOM XSS-safe rendering, and IndexedDB offline caching.
- **Windows DPAPI (`SecretStore`)** — Keeps API keys encrypted per-user outside SQLite and Git; never returned raw to browser.
- **Do not merge to `main`** — Keep all work on `feat/mvp-foundation` (PR #1) until user explicitly approves merge.

## Gotchas
- **ElevenLabs Free tier:** Rejects community Voice Library IDs (`HTTP 402`); only `premade` voices work via API, and scoped keys need `user_read`, `voices_read`, and `text_to_speech`.
- **Service Worker cache (`kh-shell-v5`):** After frontend edits, bump `CACHE` in `knowledge_hub/static/sw.js` or tell user to `Ctrl + F5`.
- **API keys are machine-local:** `outputs/.secrets.json` is gitignored and DPAPI-encrypted to the work PC; re-enter keys in **Ayarlar** on the home PC.
- **Keep terminal open:** `start.bat` / `start.ps1` must stay running while using `http://127.0.0.1:8000` (otherwise SW shows cached UI but `/api/*` fails).

## How to verify
```powershell
cd Knowledge-Hub-AI
python -m pytest -q
python -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs/smoke.json -Force
```
