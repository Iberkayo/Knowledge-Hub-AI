# Handoff — 2026-11-28 22:47 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Ship **Knowledge Hub AI** across Web + **Native iOS App Store** (Expo / React Native + FastAPI backend) on `feat/mvp-foundation` (PR #1).

## Done
- **Phase 1 & 2 Complete (Checkpoints 1–8: `062bdad`..`ad42440`):** Locked 3-phase iOS App Store scope, API-first architecture & Anti-AI-Slop Editorial UX Constitution, Python 3.11 `.venv` + RTX 3050 CUDA 12 Faster-Whisper, Edge Neural TTS (`AhmetNeural`/`EmelNeural`), fluent Turkish prompt (`v2.1`), code-skipping in narration, Bearer auth (`KH_API_TOKEN`), HTTP `206 Range` audio streaming, YouTube transcript ingestion, and 2-speaker Emel & Ahmet Turkish podcast generation.
- **Checkpoints 9–13 (`78f36c7`..`4b68575`):**
  - Built & live-verified Expo SDK 58 native iOS app in `mobile/` with True Zero-Knowledge BYOK (`mobile/src/directTranslate.ts`: `iPhone → OpenRouter` via iOS Keychain + `PUT /api/items/{id}/translation`), full-screen Now Playing sheet (60fps scrubber + smooth swipe-down dismiss), opaque `1024×1024` editorial App Store icon, OpenAI `gpt-4o-mini-tts`, Apple `privacyManifests`, and `expo-doctor` 20/20 green.
- **Checkpoint 14 (First Production iOS `.ipa` Built & Submitted to Apple TestFlight!):**
  - First-try zero-error EAS cloud iOS build (`04dbb6aa-7055-414e-80b6-0f68206821b6`, `v0.6.0` Build `2`, Bundle ID `com.iberkayo.knowledgehub`, Distribution Cert + Provisioning Profile created & stored on EAS).
  - Successfully submitted to **Apple App Store Connect / TestFlight** (ASC App ID `6840424441`, App Store Connect API Key linked on EAS, TestFlight URL: `https://appstoreconnect.apple.com/apps/6840424441/testflight/ios`).
  - Added `ascAppId: "6840424441"` to `mobile/eas.json` so future `eas submit --platform ios --latest` uploads require zero interactive prompts.

## In progress
- **Apple TestFlight Processing (5–10 min):** Waiting for Apple to finish processing `v0.6.0 (Build 2)` so user can install Knowledge Hub from TestFlight on iPhone and verify native **Lock-Screen & Background Audio (`UIBackgroundModes: ["audio"]`)**, new `1024×1024` icon, and Zero-Knowledge BYOK direct translation!
- Note: App Store Connect auto-named the app `"Knowledge Hub (f1c8d3)"` because `"Knowledge Hub"` is already taken globally — user should choose a final unique App Store display name (e.g., `Knowledge Hub — Okuma & Dinleme` or a distinctive brand name) in App Store Connect before public App Store submission.

## Next steps
1. **Verify TestFlight Build #2 on iPhone:**
   - Install from Apple TestFlight app -> enter `http://192.168.1.107:8000` + `kh-2026-ev` in **Ayarlar** (and optionally enter OpenRouter key in **Cihaz İçi Çeviri Anahtarı** for Zero-Knowledge BYOK).
   - Confirm lock-screen & AirPods background audio plays continuously when iPhone is locked!
2. **Phase 3B (Next High-Impact Features before Public App Store Launch):**
   - **Native iOS Share Extension:** 1-tap "Paylaş → Knowledge Hub" from Safari, X, and YouTube.
   - **Direct On-Device OpenAI TTS (Zero-Knowledge BYOK audio):** Let iPhone call `api.openai.com/v1/audio/speech` directly with user's Keychain OpenAI key (zero server key exposure).
   - **Tailscale HTTPS** (optional for personal out-of-home use) OR **Phase 3C Public Cloud Backend** (Dockerized FastAPI + Postgres + R2/S3 + Sign in with Apple + in-app account deletion + Privacy Policy URL for Apple App Store Review).

## Decisions & why
- **Added `ascAppId: "6840424441"` to `mobile/eas.json`** — Non-secret public App Store Connect ID; enables 1-command automated TestFlight submissions going forward.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
cd mobile
npx expo-doctor
npx tsc --noEmit
```
