# Handoff — 2026-11-27 22:05 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Build **Phase 2 (v0.6)** on `feat/mvp-foundation` (PR #1): Mobile/iPhone API readiness (Tailscale HTTPS + Bearer auth + HTTP 206 Range audio streaming), YouTube transcript import, and NotebookLM-style 2-speaker Turkish podcast generation — preparing the shared backend for **Phase 3 (iOS App Store via Expo/React Native)**.

## Done
- **Phase 1 Accepted (Checkpoints 1–5: `062bdad`, `f28462a`, `a8038c7`, `22ec73d`, `714ca97`):**
  - Locked 3-phase iOS App Store scope (`docs/SCOPE.md`) & API-first architecture + Anti-AI-Slop Editorial UX Constitution (`docs/ARCHITECTURE.md`).
  - Python 3.11 `.venv` with Edge Neural TTS (`tr-TR-AhmetNeural` / `tr-TR-EmelNeural`, accepted by user), Supertonic 3 offline ONNX, Faster-Whisper RTX 3050 CUDA `float16`, warm paper/ink editorial UI verified on desktop & 390px iPhone viewport.
- **Checkpoint 6 (Mobile API Readiness — Auth, HTTP 206 Range Audio & Tailscale Guide):**
  - Added constant-time Bearer token middleware (`knowledge_hub/auth.py`), activated only when `KH_API_TOKEN` is set; leaves loopback `127.0.0.1` frictionless when unset.
  - Added `GET /api/health` (public liveness + `auth_required` probe) and scoped `?token=` query auth strictly to GET audio/export/backup routes so iOS Safari `<audio>` and downloads work over Tailscale.
  - Updated `knowledge_hub/static/app.js` and `player.js` with `localStorage` Bearer token prompt/header/media-token support (`sw.js` -> `kh-shell-v10`).
  - Added `docs/MOBILE_ACCESS.md` step-by-step Turkish Tailscale HTTPS + iPhone PWA setup guide.
  - Added `tests/test_mobile_api.py` verifying Bearer auth (`401`/`200`), scoped query token, and **HTTP `206 Partial Content` (`Range: bytes=0-99`)** audio streaming (56/56 tests passing).

## In progress
- **Checkpoint 7 (Next):** YouTube URL → timestamped transcript import (`knowledge_hub/youtube.py` + `POST /api/import-youtube` + UI integration inside "İçerik Ekle" modal).

## Next steps
1. **Checkpoint 7:** Install `youtube-transcript-api` into `.venv` & `pyproject.toml`, implement `knowledge_hub/youtube.py` (parse `youtube.com/watch?v=`, `youtu.be/`, `shorts/` IDs, fetch title/channel via safe HTTPS oEmbed + transcript with timestamps, clean paragraph grouping + `transcript_json`), expose `POST /api/import-youtube` (and auto-detect YouTube URLs inside `POST /api/import-url`!), add offline/mock unit tests, verify `pytest`, commit & push.
2. **Checkpoint 8:** Implement **NotebookLM-style 2-speaker Turkish Podcast ("Sesli Sohbet / Podcast Üret")** (`knowledge_hub/podcast.py`): generate structured `[AHMET]` / `[EMEL]` Turkish technical dialogue from any library item via configured LLM (OpenRouter / OpenAI / Mock), synthesize turns with `tr-TR-AhmetNeural` & `tr-TR-EmelNeural` (cached per turn!), assemble seamless MP3, expose `POST /api/items/{id}/podcast`, wire UI button in Reader & Listen views, add unit tests, verify `pytest`, commit & push.
3. **Phase 3 (v1.0 — Native iOS App Store):** Scaffold Expo (React Native, TypeScript) client targeting the verified FastAPI endpoints.

## Decisions & why
- **Edge Neural TTS accepted for Turkish** — Natural native Turkish voices (`AhmetNeural` + `EmelNeural`), free, compact MP3s, and enables 2-speaker NotebookLM-style Turkish podcasts at zero TTS cost.
- **Optional `KH_API_TOKEN` middleware** — Zero friction on local `127.0.0.1`, full Bearer protection when exposed via Tailscale HTTPS to iPhone.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user approves merge.

## Gotchas
- `tests/test_mobile_api.py` verifies Starlette `FileResponse` returns HTTP `206 Partial Content` with `Accept-Ranges: bytes`.
- Service Worker cache is at `kh-shell-v10`.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs\smoke.json -Force
```
