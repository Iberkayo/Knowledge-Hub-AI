# Handoff — 2026-11-27 22:44 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Ship **Knowledge Hub AI** across Web + **Native iOS App Store** (Expo / React Native + FastAPI backend) on `feat/mvp-foundation` (PR #1).

## Done
- **Phase 1 & 2 Complete (Checkpoints 1–8: `062bdad`..`ad42440`):** Locked iOS App Store scope, API-first architecture & Anti-AI-Slop Editorial UX Constitution, Python 3.11 `.venv` + RTX 3050 CUDA 12 Faster-Whisper, Edge Neural TTS (`AhmetNeural`/`EmelNeural`), fluent Turkish prompt (`v2.1`), code-skipping in narration, Bearer token auth (`KH_API_TOKEN`), HTTP `206 Range` audio streaming, YouTube transcript ingestion, and 2-speaker Emel & Ahmet Turkish podcast generation.
- **Checkpoint 9 (`78f36c7` — Native iOS App Live-Verified on Real iPhone via Expo Go):**
  - Scaffolded Expo SDK 58 app in `mobile/`, verified live on user's physical iPhone over Wi-Fi (`192.168.1.107:8081` + authenticated FastAPI `192.168.1.107:8000`, `KH_API_TOKEN`).
  - Live-verified YouTube import (`Terence Tao`, `OpenAI You had us at Deployed`), Gemini 2.5 Flash Turkish translation, and Emel+Ahmet 2-speaker podcast playback on iPhone.
- **Checkpoint 10 (Live iPhone UX Fixes — Full-Screen Now Playing Sheet, Auto-Refresh on Job Completion & Clean YouTube Captions):**
  - **Auto-refresh on job completion (`mobile/App.tsx`, `mobile/src/screens/ReaderScreen.tsx`):** Polled jobs finishing (`COMPLETED`/`FAILED`) now automatically trigger `refreshTick` + library refresh so `ReaderScreen` switches immediately to the newly translated Turkish text (and shows an inline loading spinner while translating).
  - **Expandable Full-Screen Now Playing Player (`mobile/src/playerContext.tsx`):** Tapping `MiniPlayer` expands an Apple Podcasts/Castro-style editorial full-screen player sheet with interactive touch/drag timeline scrubber, large 15s back / Play-Pause / 30s forward controls, speed pills (`0.75×`–`2×`), and clickable live timestamped transcript/podcast dialogue.
  - **Clean YouTube Auto-Captions (`knowledge_hub/youtube.py`):** Added `clean_caption_snippet()` to strip `>>` / `>` speaker markers and `[music]` / `[applause]` / `[laughter]` tags so YouTube transcripts read cleanly without stray markdown blockquotes.
  - Verified `npx tsc --noEmit` (0 errors) + **60/60 backend pytest tests** passing.

## In progress
- **User Re-testing on Physical iPhone (Expo Go running live on `exp://192.168.1.107:8081`):** User testing the new expandable Now Playing sheet and auto-refreshing translation flow.
- **Important iOS Background Audio Note:** Expo Go's pre-built App Store binary does not bundle our custom `UIBackgroundModes: ["audio"]` entitlement, so iOS pauses audio on screen lock inside Expo Go; building our own **EAS Development / TestFlight Build** (`eas build --platform ios`) compiles `app.json`'s `UIBackgroundModes: ["audio"]` natively so lock-screen & background audio works continuously.

## Next steps
1. **First Native iOS TestFlight / Dev Build (unlocks Lock-Screen Background Audio + iOS Share Extension!):**
   - Generate crisp 1024×1024 editorial App Store PNG icon (`mobile/assets/icon.png`) matching `knowledge_hub/static/icon.svg`.
   - Run `eas build --platform ios --profile preview` (or `production` for TestFlight) with user's Apple Developer account so `UIBackgroundModes: ["audio"]` works natively when iPhone is locked.
2. **iOS Share Extension:** Add 1-tap "Save to Knowledge Hub" from Safari / YouTube / X.
3. **TTS Quality Upgrade (flagged as improvable):** Add higher-naturalness Turkish TTS option (OpenAI `gpt-4o-mini-tts` / Google Chirp 3 HD / ElevenLabs Multilingual v2 / local RTX 3050 GPU TTS).
4. **Public App Store Cloud Readiness:** Multi-user auth (Sign in with Apple + account deletion), Postgres + R2/S3, StoreKit 2 or BYOK positioning.

## Decisions & why
- **Expo Go vs EAS Build for iOS Background Audio** — Confirmed on real iPhone that Expo Go drops audio on lock screen due to Expo Go's fixed entitlements; our `mobile/app.json` already declares `UIBackgroundModes: ["audio"]` + `setActiveForLockScreen`, ready for EAS TestFlight build.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
cd mobile
npx tsc --noEmit
```
