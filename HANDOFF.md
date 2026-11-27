# Handoff — 2026-11-27 21:17 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Complete **Phase 1 (v0.5)** live validation & editorial UX overhaul on `feat/mvp-foundation` (PR #1), following the locked 3-phase roadmap toward a public **iOS App Store** release (Expo/React Native thin client + FastAPI backend).

## Done
- **Checkpoint 0 (Work PC -> Home PC):**
  - Cloned `feat/mvp-foundation` (commit `6c5d17b`) to `C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI`.
- **Checkpoint 1 (`062bdad` — Scope, Architecture & Anti-AI-Slop UX Constitution Locked):**
  - Locked 3-phase iOS App Store roadmap in `docs/SCOPE.md`.
  - Created `docs/ARCHITECTURE.md` defining API-first boundaries, v0.6/v1.0 bridges, and the Anti-AI-Slop Editorial UX Constitution.
- **Checkpoint 2 (`f28462a` — Python 3.11 `.venv` Setup & Core Verification):**
  - Updated `setup.ps1` to prefer Python 3.12/3.11/3.13 and install `.[test,tts,media,ai]`.
  - Verified Python 3.11.0 `.venv`, 54/54 pytest tests, and offline benchmark smoke test.
- **Checkpoint 3 (Live Supertonic 3, Faster-Whisper RTX 3050 CUDA & Live Extraction):**
  - Updated `knowledge_hub/media.py` with `_register_nvidia_dll_dirs()` and `_cuda_runtime_ready()` so Windows pip-installed CUDA 12 runtime DLLs (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) are discovered automatically by `ctranslate2` without requiring a 2.5 GB PyTorch install.
  - Verified `whisper_status()` reports `cuda_available: True`, `recommended_device: "cuda"`.
  - Live-tested **Supertonic 3 ONNX (`lang="tr"`)**: downloaded model (`26/26` files), synthesized `14.56s` (`M1`) and `6.97s` warm (`F1`, `5.04s` wall — faster than real-time on CPU). Sample saved at `outputs/checkpoint3_supertonic_sample.wav`.
  - Live-tested **Faster-Whisper on RTX 3050 CUDA `float16`**: transcribed the `14.56s` Turkish audio in `2.22s` (with bundled `PyAV`, no `ffmpeg` needed for WAV).
  - Live-tested SSRF-safe article extraction: `hamel.dev/evals/` (`0.57s`, 3931 words, title + author) and `felixrieseberg.com` (`0.38s`, 2217 words, title + author).
  - Re-verified **54/54 pytest tests passing**.

## In progress
- **Checkpoint 4 (Current):** Executing the **Anti-AI-Slop Editorial UX Overhaul** per `docs/ARCHITECTURE.md` across `knowledge_hub/static/` (`index.html`, `styles.css`, `app.js`, `player.js`, `icon.svg`, `manifest.webmanifest`, `sw.js`), followed by desktop + mobile (`390px`) browser verification.

## Next steps
1. **Checkpoint 4:** Implement the Editorial UX Overhaul (warm paper/ink light & warm charcoal dark themes, zero emoji UI chrome, clean inline SVG icons, calm editorial library list replacing cluttered badge cards, distraction-free reader with top scroll progress bar + compact `Aa` typography popover + overflow menu, tabbed settings, fix search-input focus bug, bump `sw.js` to `kh-shell-v6`). Start local server, visually inspect desktop + 390px mobile via browser subagent, re-run `pytest`, commit & push.
2. **User Live Acceptance:** User opens `http://127.0.0.1:8000`, enters OpenRouter API key in **Ayarlar**, tests real Turkish translation & listens to Supertonic 3 audio quality, and decides if local RTX 3050 GPU TTS (Chatterbox / F5-TTS) is needed before Phase 2.
3. **Phase 2 (v0.6):** Add optional `KH_API_TOKEN` Bearer auth + HTTP `Range` (`206`) audio streaming + Tailscale HTTPS mobile testing on iPhone.

## Decisions & why
- **Locked iOS App Store target (Expo / React Native thin client + FastAPI backend)** — User has Apple Developer account; EAS Build enables iOS TestFlight/App Store builds from Windows while sharing FastAPI.
- **Anti-AI-Slop Editorial UX** — Crafted warm paper/ink editorial design (Readwise Reader / Matter / Apple Books feel), zero emoji chrome, pure SVG icons.
- **CUDA 12 DLL wheels (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) instead of full PyTorch** — Enables RTX 3050 `float16` Faster-Whisper cleanly in `.venv` with half the footprint.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## Gotchas
- `ffmpeg` is not on PATH yet (WAV works via `PyAV`/stdlib `wave`, MP3/M4A podcasts may benefit from `winget install Gyan.FFmpeg` if needed).
- Service Worker cache (`knowledge_hub/static/sw.js`) must be bumped (`kh-shell-v6`) when updating frontend assets.
- API keys (`outputs/.secrets.json`) are machine-local DPAPI encrypted and gitignored.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs\smoke.json -Force
```
