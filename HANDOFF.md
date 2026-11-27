# Handoff — 2026-11-27 21:30 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Complete **Phase 1 (v0.5)** live validation & editorial UX overhaul on `feat/mvp-foundation` (PR #1), following the locked 3-phase roadmap toward a public **iOS App Store** release (Expo/React Native thin client + FastAPI backend).

## Done
- **Checkpoint 0 (Work PC -> Home PC):**
  - Cloned `feat/mvp-foundation` (`6c5d17b`) to `C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI`.
- **Checkpoint 1 (`062bdad` — Scope, Architecture & Anti-AI-Slop UX Constitution Locked):**
  - Locked 3-phase iOS App Store roadmap in `docs/SCOPE.md`.
  - Created `docs/ARCHITECTURE.md` defining API-first boundaries, v0.6/v1.0 bridges, and the Anti-AI-Slop Editorial UX Constitution.
- **Checkpoint 2 (`f28462a` — Python 3.11 `.venv` Setup & Core Verification):**
  - Updated `setup.ps1` to prefer Python 3.12/3.11/3.13 and install `.[test,tts,media,ai]`.
  - Verified Python 3.11.0 `.venv`, 54/54 pytest tests, and offline benchmark smoke test.
- **Checkpoint 3 (`a8038c7` — Live Supertonic 3, Faster-Whisper RTX 3050 CUDA & Live Extraction):**
  - Updated `knowledge_hub/media.py` with Windows CUDA 12 DLL auto-registration (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12` installed in `.venv`); `whisper_status()` reports `cuda_available: True`, `recommended_device: "cuda"`.
  - Live-verified **Supertonic 3 ONNX (`lang="tr"`)** (`6.97s` warm synthesis in `5.04s` on CPU), **Faster-Whisper CUDA `float16`** (`14.56s` Turkish audio transcribed in `2.22s` on RTX 3050), and live SSRF-safe extraction (`hamel.dev/evals/` 3931 words, `felixrieseberg.com` 2217 words).
- **Checkpoint 4 (Anti-AI-Slop Editorial UX Overhaul & Desktop/Mobile `390px` Browser Verification):**
  - Replaced dark-slate/cyan AI-slop UI and all 22+ UI emojis with a warm archival paper (`#F8F5EF`) & warm graphite (`#141311`) editorial design system (`knowledge_hub/static/styles.css`, `index.html`, `icon.svg`, `manifest.webmanifest`) with terracotta accent (`#B34D22` / `#DC7B4A`).
  - Added pure-DOM 1.65px-stroke SVG icon module (`knowledge_hub/static/icons.js`) and bumped Service Worker cache (`knowledge_hub/static/sw.js` -> `kh-shell-v8`).
  - Redesigned **Kütüphanem** into a calm scannable editorial reading list with subtle status dots and fixed the search-input focus-loss bug (`knowledge_hub/static/app.js`).
  - Redesigned **Okuyucu** into a borderless editorial canvas with live 2.5px scroll progress bar, compact `Aa` typography + theme popover (`Kağıt`/`Koyu`, `Serif`/`Sans`, font size, column width, translation mode), `···` overflow menu, collapsible notes/highlights footer, and `.table-scroll` wrapper in `knowledge_hub/static/render.js`.
  - Organized **Ayarlar** into 5 calm tabs (`Çeviri`, `Seslendirme`, `Transkripsiyon`, `Sözlük`, `Sistem & Yedek`) and updated `knowledge_hub/static/player.js` with crisp SVG play/pause dock controls.
  - Verified live in browser at `http://127.0.0.1:8000` (0 console errors, 0 failed network requests) across desktop `1440x900` and mobile iPhone `390x844` (0 horizontal overflow, clean `Aa` dropdown containment, `hamel.dev/evals/` imported & rendered).
  - Re-verified **54/54 pytest tests** and offline benchmark smoke test passing.

## In progress
- **User Live Acceptance (End of Phase 1):** Local server is running on `http://127.0.0.1:8000` with `hamel.dev/evals/` already imported. Waiting for user to enter OpenRouter API key in **Ayarlar -> Çeviri**, test live Turkish translation + listen to Supertonic 3 Turkish audio quality, and confirm whether RTX 3050 GPU TTS (Chatterbox Multilingual / F5-TTS) is needed before starting **Phase 2 (v0.6)**.

## Next steps
1. **User Live Acceptance (Phase 1 Sign-off):**
   - Open `http://127.0.0.1:8000`, enter OpenRouter API key in **Ayarlar -> Çeviri**, test live Turkish translation on `Your AI Product Needs Evals` (`hamel.dev/evals/`).
   - Listen to **Supertonic 3** sample in **Ayarlar -> Seslendirme** (or narrate the translated article) and decide if Supertonic 3 quality is sufficient or if we should add a local RTX 3050 GPU TTS provider (**Chatterbox Multilingual** / **F5-TTS Turkish**).
   - Optional quick polish noted during visual audit: strip duplicate leading title/byline metadata in `ingest.py` `extract_rich()` for Quarto blogs like `hamel.dev`.
2. **Phase 2 (v0.6 — Personal Remote Mobile Access on iPhone):**
   - Add optional `KH_API_TOKEN` Bearer auth middleware (`knowledge_hub/auth.py`) while keeping loopback `127.0.0.1` frictionless.
   - Add HTTP `206 Partial Content` (`Range`) byte-seek support on `/api/items/{id}/audio` (required by iOS `AVPlayer` / Safari audio seeking).
   - Expose over **Tailscale Serve (HTTPS)** and dogfood daily on iPhone.
3. **Phase 3 (v1.0 — Native iOS App Store Release):**
   - Scaffold Expo (React Native, TypeScript) iOS client consuming FastAPI REST endpoints with `react-native-track-player`, iOS Share Extension, and offline filesystem bundling; prepare EAS Build for TestFlight / App Store Connect.

## Decisions & why
- **Locked iOS App Store target (Expo / React Native thin client + FastAPI backend)** — User has Apple Developer account; EAS Build enables iOS TestFlight/App Store builds from Windows while sharing FastAPI.
- **Anti-AI-Slop Editorial UX** — Warm paper/ink editorial design (Readwise Reader / Matter / Apple Books feel), zero emoji chrome, pure SVG icons, verified on desktop + 390px iPhone viewport.
- **CUDA 12 DLL wheels (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) instead of full PyTorch** — Enables RTX 3050 `float16` Faster-Whisper cleanly in `.venv`.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## Gotchas
- On mobile (`<=860px`), `.reader-bar` uses `backdrop-filter`, which creates a containing block for `position: fixed` descendants; therefore `.popover-menu` intentionally uses `position: absolute` with `.reader-bar .popover-anchor { position: static; }` to drop cleanly below the toolbar.
- `ffmpeg` is not on PATH yet (WAV works via `PyAV`/stdlib `wave`; install `winget install Gyan.FFmpeg` if non-WAV podcast transcoding is needed).
- Service Worker cache is at `kh-shell-v8` (`knowledge_hub/static/sw.js`).
- API keys (`outputs/.secrets.json`) are machine-local DPAPI encrypted and gitignored.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs\smoke.json -Force
```
