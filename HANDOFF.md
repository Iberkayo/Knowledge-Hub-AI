# Handoff — 2026-11-27 21:10 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Complete **Phase 1 (v0.5)** live validation & editorial UX overhaul on `feat/mvp-foundation` (PR #1), following the locked 3-phase roadmap toward a public **iOS App Store** release (Expo/React Native thin client + FastAPI backend).

## Done
- **Checkpoint 0 (Work PC -> Home PC):**
  - Cloned `feat/mvp-foundation` (commit `6c5d17b`) to `C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI`.
- **Checkpoint 1 (`062bdad` — Scope, Architecture & Anti-AI-Slop UX Constitution Locked):**
  - Locked 3-phase iOS App Store roadmap in `docs/SCOPE.md`.
  - Created `docs/ARCHITECTURE.md` defining API-first boundaries, v0.6/v1.0 bridges, and the Anti-AI-Slop Editorial UX Constitution.
- **Checkpoint 2 (Python 3.11 `.venv` Setup & Core Verification):**
  - Updated `setup.ps1` to prefer Python 3.12/3.11/3.13 before generic `py -3` (avoiding Python 3.14 wheel conflicts) and to install `.[test,tts,media,ai]`.
  - Created `.venv` with Python 3.11.0 and installed all extras cleanly (`supertonic==1.3.1`, `onnxruntime==1.32.0`, `faster-whisper==1.2.1`, `ctranslate2==4.9.1`, `av==18.1.1`, `openai==2.54.0`, `edge-tts==7.3.1`, `pypdf==6.21.4`, `pytest==9.2.0`).
  - Verified **54/54 pytest tests passing** (`5.93s`), offline benchmark smoke test passing, and `ctranslate2.get_cuda_device_count() == 1` (RTX 3050 6GB detected).

## In progress
- **Checkpoint 3 (Current):** Live testing **Supertonic 3** Turkish TTS synthesis & audio quality, **Faster-Whisper** CUDA transcription readiness on RTX 3050, and live article extraction + OpenRouter translation readiness.

## Next steps
1. **Checkpoint 3:** Run live Supertonic 3 Turkish TTS sample synthesis (verifies model download + synthesis speed + WAV validity), verify Faster-Whisper CUDA transcription on a generated Turkish audio sample (end-to-end TTS -> Whisper roundtrip!), and verify live `hamel.dev/evals/` extraction. Commit & push checkpoint.
2. **Checkpoint 4:** Execute **Editorial UX Overhaul** per `docs/ARCHITECTURE.md` (warm paper/ink palette, zero emoji UI chrome, clean inline SVG icon set, editorial library list, distraction-free reader with top scroll progress bar, quiet tabbed settings, fix search-input focus bug, bump `sw.js` cache to `kh-shell-v6`). Verify visually in browser (desktop + 390px iOS viewport), run full `pytest`, commit & push.
3. **User Live Acceptance:** User tests live OpenRouter API translation + listens to Supertonic 3 output in browser at `http://127.0.0.1:8000` and decides if RTX 3050 GPU TTS (Chatterbox / F5-TTS) is needed before Phase 2.

## Decisions & why
- **Locked iOS App Store target (Expo / React Native thin client + FastAPI backend)** — User has Apple Developer account; EAS Build supports iOS builds from Windows while sharing the FastAPI backend.
- **Anti-AI-Slop Editorial UX** — Crafted warm paper/ink editorial design (Readwise Reader / Matter / Apple Books feel), zero emoji chrome, pure SVG icons.
- **Python 3.11 for `.venv`** — Verified clean wheel install for `supertonic`, `onnxruntime`, `faster-whisper`, and `ctranslate2` with CUDA detection.
- **Frequent checkpoint handoffs + GitHub pushes** — Commit & push after every milestone on `feat/mvp-foundation` (never merge to `main`).

## Gotchas
- `ffmpeg` is not on PATH yet, though `PyAV` (`av==18.1.1`) bundled with `faster-whisper` handles audio decoding in-process! Verify whether CUDA cuDNN DLLs are needed when running `faster-whisper` on `cuda` `float16`.
- Service Worker cache (`knowledge_hub/static/sw.js`) must be bumped (`kh-shell-v6`) after frontend UX overhaul.
- API keys (`outputs/.secrets.json`) are machine-local DPAPI encrypted and gitignored; user enters OpenRouter key in **Ayarlar** on this PC.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs\smoke.json -Force
```
