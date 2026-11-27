# Handoff — 2026-11-27 21:05 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Complete **Phase 1 (v0.5)** live validation & editorial UX overhaul on `feat/mvp-foundation` (PR #1), following the locked 3-phase roadmap toward a public **iOS App Store** release (Expo/React Native thin client + FastAPI backend).

## Done
- **Checkpoint 0 (Work PC -> Home PC):**
  - Cloned `feat/mvp-foundation` (commit `6c5d17b`) to `C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI`.
  - Audited home PC environment: **NVIDIA GeForce RTX 3050 6GB Laptop GPU**, Python `3.14` (default), `3.13`, and `3.11` installed; `ffmpeg` not currently on PATH.
- **Checkpoint 1 (Scope, Architecture & Anti-AI-Slop UX Constitution Locked):**
  - Locked 3-phase roadmap in `docs/SCOPE.md` (Phase 1: Core Quality & Editorial UX → Phase 2: Remote Mobile Access via Tailscale + Auth → Phase 3: Native iOS App Store via Expo/RN + Cloud Readiness).
  - Created `docs/ARCHITECTURE.md` defining API-first client/backend boundaries, v0.6/v1.0 bridges (Auth, HTTP Range audio streaming, Storage abstraction, iOS Share Extension, App Store compliance), and the **Anti-AI-Slop Editorial UX Constitution** (warm paper/ink palette, zero emoji UI chrome, consistent stroke SVG icons, 62–68ch serif reading typography).

## In progress
- **Checkpoint 2 (Next):** Local environment setup with **Python 3.11** `.venv` (avoiding Python 3.14 wheel issues with `onnxruntime`/`faster-whisper`/PyTorch CUDA), updating `setup.ps1` if needed, and verifying `pytest` + `benchmark` smoke test.

## Next steps
1. **Checkpoint 2:** Create `.venv` with `py -3.11`, install `.[test,tts,media,ai]` (plus CUDA support check for RTX 3050), improve `setup.ps1` to prefer Python 3.11–3.13 and include `tts`, run `python -m pytest -q` and `python -m knowledge_hub.benchmark --out outputs/smoke.json`. Commit & push checkpoint.
2. **Checkpoint 3:** Start local server (`127.0.0.1:8000`), live-test **Supertonic 3** Turkish TTS synthesis & audio quality, verify **Faster-Whisper** CUDA readiness on RTX 3050, and guide user through live OpenRouter translation test (`hamel.dev/evals/`, `felixrieseberg.com`). Decide if GPU TTS (Chatterbox Multilingual / F5-TTS) is needed. Commit & push checkpoint.
3. **Checkpoint 4:** Execute **Editorial UX Overhaul** per `docs/ARCHITECTURE.md` (replace dark-slate/cyan AI-slop theme & emoji icons with warm paper/ink editorial design, pure SVG icons, refined typography & reading canvas, mobile 390px polish, bump `sw.js` cache), verify visually in browser (desktop + 390px iOS viewport), run full test suite, commit & push.
4. **Phase 2 (after Phase 1 sign-off):** Add optional Bearer token auth + HTTP Range audio streaming + Tailscale mobile testing.

## Decisions & why
- **Locked iOS App Store target (Expo / React Native thin client + FastAPI backend)** — User has Apple Developer account and wants both daily personal use and public App Store launch; Expo + EAS Build enables iOS builds/TestFlight from Windows while sharing the FastAPI backend.
- **Anti-AI-Slop Editorial UX** — User explicitly wants crafted editorial UX (Readwise Reader / Matter / Apple Books feel), not generic dark-slate + cyan cards or emoji nav.
- **Python 3.11 for `.venv`** — System default `py -3` resolves to Python 3.14, which risks missing wheels for `onnxruntime` (`supertonic`), `ctranslate2` (`faster-whisper`), and PyTorch CUDA.
- **Frequent checkpoint handoffs + GitHub pushes** — User requested explicit checkpoints pushed to `feat/mvp-foundation` so work survives any agent quota/context limits.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## Gotchas
- `setup.ps1` currently invokes `py -3` (picks 3.14 on this machine) and installs `.[test,media,ai]` without `tts`.
- `ffmpeg` is not on PATH yet (needed for non-WAV audio decoding / Faster-Whisper podcast files).
- Service Worker cache (`knowledge_hub/static/sw.js`) must be bumped after any frontend CSS/JS/HTML changes.
- API keys (`outputs/.secrets.json`) are machine-local DPAPI encrypted and gitignored; user must enter OpenRouter key in **Ayarlar** on this PC.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs\smoke.json -Force
```
