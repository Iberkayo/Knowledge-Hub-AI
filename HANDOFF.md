# Handoff — 2026-11-27 22:10 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Build **Phase 2 (v0.6)** on `feat/mvp-foundation` (PR #1) and prepare **Phase 3 (v1.0 — Native iOS App Store Release via Expo/React Native + FastAPI Backend)**.

## Done
- **Phase 1 Accepted (Checkpoints 1–5: `062bdad`, `f28462a`, `a8038c7`, `22ec73d`, `714ca97`):**
  - Locked 3-phase iOS App Store scope (`docs/SCOPE.md`), API-first architecture & Anti-AI-Slop Editorial UX Constitution (`docs/ARCHITECTURE.md`).
  - Python 3.11 `.venv` + RTX 3050 CUDA 12 Faster-Whisper (`cuda_available: True`), native Turkish Edge Neural TTS (`tr-TR-AhmetNeural` & `tr-TR-EmelNeural`, code/tables/URLs skipped in narration), upgraded fluent Turkish prompt (`v2.1`), warm paper/ink editorial UI verified on desktop & 390px iPhone viewport.
- **Phase 2 Complete (Checkpoints 6–8: `843b4d1`, `1f05dfe`, current commit):**
  - **Checkpoint 6 (`843b4d1` — Mobile API Readiness):** Optional `KH_API_TOKEN` constant-time Bearer middleware (`knowledge_hub/auth.py`), `/api/health`, scoped `?token=` query auth for iOS Safari `<audio>`/downloads, HTTP `206 Partial Content` (`Range`) audio streaming verified (`tests/test_mobile_api.py`), and `docs/MOBILE_ACCESS.md` Tailscale iPhone guide.
  - **Checkpoint 7 (`1f05dfe` — YouTube URL Transcript Import):** `knowledge_hub/youtube.py` (`extract_youtube_video_id`, oEmbed metadata, paragraph grouping, `youtube-transcript-api>=1.0`), `POST /api/import-youtube` + auto-detect inside `POST /api/import-url`.
  - **Checkpoint 8 (NotebookLM-Style 2-Speaker Turkish Podcast):** `knowledge_hub/podcast.py` generating natural Emel & Ahmet Turkish technical dialogue via configured LLM (or mock demo) + dual-voice Edge Neural TTS (`tr-TR-EmelNeural` + `tr-TR-AhmetNeural`) per-turn cached MP3 assembly + speaker-labeled timestamped `transcript_json`; `POST /api/items/{id}/podcast` async job endpoint; UI triggers in Reader (`···` menu) and **Dinle** view (`sw.js` -> `kh-shell-v12`).
  - **60/60 pytest tests** + offline benchmark smoke test passing.

## In progress
- **Phase 2 Live Verification & Phase 3 Kickoff:** Fresh local server is running at `http://127.0.0.1:8000`. Ready for user to test YouTube import, 2-speaker Emel & Ahmet Turkish podcast generation, and optional Tailscale iPhone access before scaffolding **Phase 3 (Expo / React Native iOS App)**.

## Next steps
1. **User Live Test (Phase 2):**
   - Press `Ctrl + F5` at `http://127.0.0.1:8000`.
   - Test pasting a public YouTube link in **İçerik Ekle → Makale / YouTube URL**.
   - Test **"Podcast Sohbeti Üret (2 Kişilik)"** (from Reader `···` menu or **Dinle** view) on any article or YouTube transcript — listen to Emel + Ahmet dual-voice MP3 + interactive speaker transcript!
   - Optional: follow `docs/MOBILE_ACCESS.md` to connect iPhone via Tailscale HTTPS (`KH_API_TOKEN`) and dogfood on mobile.
2. **Phase 3 (v1.0 — Native iOS App Store Release):**
   - Decide backend hosting target (self-hosted Tailscale/VPS vs cloud Postgres+R2) and monetization model (BYOK vs StoreKit 2 subscription).
   - Scaffold `mobile/` Expo (React Native, TypeScript) app targeting the existing FastAPI REST contract:
     - Editorial paper/ink iOS UI (Library, Reader, Listen, Discover, Settings)
     - `react-native-track-player` (lock-screen, AirPods, CarPlay, HTTP Range seeking)
     - iOS Share Extension (1-tap save from Safari / X / YouTube)
     - Offline filesystem audio + text archive
     - EAS Build -> TestFlight -> Apple App Store Connect.

## Decisions & why
- **Dual-host Emel + Ahmet Edge Neural TTS for podcasts** — Zero extra TTS cost, native Turkish voices, compact MP3s, and interactive speaker transcript out of the box.
- **Auto-detect YouTube inside `/api/import-url`** — One unified URL endpoint powers both Web UI and the upcoming iOS Share Extension.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## Gotchas
- Service Worker cache is at `kh-shell-v12` (`Ctrl + F5` to load fresh UI).
- Local `outputs/` and `.secrets.json` are gitignored and machine-local.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs\smoke.json -Force
```
