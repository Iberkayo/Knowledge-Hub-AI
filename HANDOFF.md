# Handoff — 2026-11-27 23:24 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Ship **Knowledge Hub AI** across Web + **Native iOS App Store** (Expo / React Native + FastAPI backend) on `feat/mvp-foundation` (PR #1).

## Done
- **Phase 1 & 2 Complete (Checkpoints 1–8: `062bdad`..`ad42440`):** Locked 3-phase iOS App Store scope, API-first architecture & Anti-AI-Slop Editorial UX Constitution, Python 3.11 `.venv` + RTX 3050 CUDA 12 Faster-Whisper, Edge Neural TTS (`AhmetNeural`/`EmelNeural`), fluent Turkish prompt (`v2.1`), code-skipping in narration, Bearer auth (`KH_API_TOKEN`), HTTP `206 Range` audio streaming, YouTube transcript ingestion, and 2-speaker Emel & Ahmet Turkish podcast generation.
- **Checkpoints 9–11 (`78f36c7`..`05f3bef` — Native iOS App Live-Verified on Real iPhone + App Store Assets + OpenAI TTS):**
  - Live-verified Expo SDK 58 iOS app on physical iPhone (Library, Editorial Reader, Discover, Listen, Settings, full-screen Now Playing sheet with 60fps scrubber & single smooth swipe-down dismiss, deterministic per-job polling).
  - Exported opaque 24-bit RGB `1024×1024` editorial App Store icon (`mobile/assets/icon.png`), added Apple `privacyManifests` to `mobile/app.json`, and added high-naturalness **OpenAI `gpt-4o-mini-tts`** provider.
- **Checkpoint 12 (True Zero-Knowledge BYOK — API Keys Stay 100% on iPhone Keychain):**
  - Locked Zero-Knowledge BYOK architecture in `docs/ARCHITECTURE.md`: user API keys NEVER leave the iPhone to touch our server, RAM, database, or logs.
  - Added `mobile/src/directTranslate.ts`: translates directly `iPhone → HTTPS → OpenRouter` (preserving code blocks verbatim on-device, fluent Turkish editorial prompt `v2.1`).
  - Added iOS Keychain BYOK settings (`openrouterApiKey` + model presets) in `mobile/src/api.ts` & `mobile/src/screens/SettingsScreen.tsx` and wired `ReaderScreen.tsx` to translate directly on-device when a Keychain key is configured (falling back cleanly to personal server otherwise).
  - Added `PUT /api/items/{identifier}/translation` in `knowledge_hub/server.py` so the iPhone syncs ONLY the finished Turkish text & bilingual segments back to the library (zero API keys ever sent to backend).
  - Verified **62/62 backend pytest tests** + `mobile/` `npx tsc --noEmit` (0 errors).

## In progress
- **Ready for First Native iOS TestFlight Build (or Cloud/Share Extension):** All core Phase 1–3 foundations are verified, tested, and pushed on `feat/mvp-foundation`.

## Next steps
1. **First Native iOS TestFlight Build (from Windows via EAS Build, unlocks Lock-Screen Background Audio):**
   - `npm install -g eas-cli && eas login`
   - `cd mobile && eas build --platform ios --profile production` -> `eas submit --platform ios --latest`
2. **Optional Tailscale HTTPS Setup** for connecting iPhone outside home Wi-Fi (`docs/MOBILE_ACCESS.md`).
3. **Phase 3B (App Store Polish):** Native **iOS Share Extension** (1-tap save from Safari/YouTube/X) + optional direct on-device OpenAI TTS (`iPhone → api.openai.com/v1/audio/speech`).
4. **Phase 3C (Public Multi-User Cloud Backend):** Postgres + R2/S3 + Sign in with Apple + in-app account deletion.

## Decisions & why
- **True Zero-Knowledge BYOK (Model 1A)** — User explicitly chose that third-party API keys must never reach or be stored on our server; iPhone talks directly to OpenRouter over HTTPS using iOS Keychain (`expo-secure-store`), and backend only syncs translated text via `PUT /api/items/{id}/translation`.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
cd mobile
npx tsc --noEmit
```
