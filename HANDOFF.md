# Handoff — 2026-11-27 23:16 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Ship **Knowledge Hub AI** across Web + **Native iOS App Store** (Expo / React Native + FastAPI backend) on `feat/mvp-foundation` (PR #1).

## Done
- **Phase 1 & 2 Complete (Checkpoints 1–8: `062bdad`..`ad42440`):** Locked 3-phase iOS App Store scope, API-first architecture & Anti-AI-Slop Editorial UX Constitution, Python 3.11 `.venv` + RTX 3050 CUDA 12 Faster-Whisper, Edge Neural TTS (`AhmetNeural`/`EmelNeural`), fluent Turkish prompt (`v2.1`), code-skipping in narration, Bearer auth (`KH_API_TOKEN`), HTTP `206 Range` audio streaming, YouTube transcript ingestion, and 2-speaker Emel & Ahmet Turkish podcast generation.
- **Checkpoints 9–10 (`78f36c7`..`ec2f1f7` — Native iOS App Live-Verified on Real iPhone):**
  - Scaffolded Expo SDK 58 app in `mobile/` and verified live on user's physical iPhone via Expo Go (`192.168.1.107:8081` + authenticated FastAPI `192.168.1.107:8000`).
  - Added deterministic per-job polling (`ReaderScreen` auto-refreshes & switches to Turkish the moment translation finishes), clean YouTube caption scrubbing (`>>`, `[music]`), full-screen expandable **Now Playing** sheet with parent safe-area insets, butter-smooth 60fps seek-on-release scrubber, and single native Animated swipe-down-to-dismiss gesture.
- **Checkpoint 11 (App Store Editorial Icon, Privacy Manifest & OpenAI `gpt-4o-mini-tts` Upgrade):**
  - Generated bespoke editorial iOS App Store icon (warm charcoal `#1C1917`, archival ivory open reading page + terracotta audio waveform page) and exported **100% opaque 24-bit RGB `1024×1024`** `mobile/assets/icon.png` (+ `512×512` `splash-icon.png`, `64×64` `favicon.png`) compliant with Apple App Store icon requirements.
  - Added Apple-required `privacyManifests` (`NSPrivacyAccessedAPICategoryUserDefaults` `CA92.1`, `NSPrivacyAccessedAPICategoryFileTimestamp` `C617.1`) and `NSLocalNetworkUsageDescription` to `mobile/app.json` alongside `UIBackgroundModes: ["audio"]` and `ITSAppUsesNonExemptEncryption: false`.
  - Added high-naturalness **OpenAI TTS (`gpt-4o-mini-tts` / `tts-1-hd`)** across `knowledge_hub/audio_pipeline.py`, `podcast.py` (studio-quality dual-host `coral` + `onyx` Turkish podcasts!), `server.py` (`/api/providers/openai-tts/sample`), `library.py`, Web Settings UI (`sw.js` -> `kh-shell-v13`), and `mobile/src/api.ts`.
  - Verified **61/61 backend pytest tests** + `mobile/` `npx tsc --noEmit` (0 errors).

## In progress
- **Ready for First EAS iOS TestFlight Build:** Everything in `mobile/app.json`, `eas.json`, opaque `1024×1024` icon, and Privacy Manifest is ready for `eas build --platform ios --profile preview` (or `production` for TestFlight) using user's Apple Developer account — this compiles `UIBackgroundModes: ["audio"]` natively so iPhone lock-screen background audio runs continuously!

## Next steps
1. **First Native iOS TestFlight Build (from Windows, no Mac required!):**
   - `npm install -g eas-cli && eas login`
   - `cd mobile && eas build --platform ios --profile production`
   - `eas submit --platform ios --latest` -> install via Apple **TestFlight** on iPhone and verify continuous lock-screen + AirPods background audio.
2. **Optional Tailscale HTTPS Setup (to use the iPhone app outside home Wi-Fi):**
   - Install Tailscale on Windows PC & iPhone, run `tailscale serve https / http://127.0.0.1:8000` (see `docs/MOBILE_ACCESS.md`).
3. **Phase 3B (Public App Store Launch Enhancements):**
   - Add native **iOS Share Extension** (1-tap "Save to Knowledge Hub" from Safari/YouTube/X).
   - Add multi-user cloud backend (Postgres + Cloudflare R2/S3 + Sign in with Apple + in-app account deletion + StoreKit 2 / BYOK).

## Decisions & why
- **Opaque 24-bit RGB `1024×1024` PNG icon** — Apple App Store rejects icons containing an alpha channel.
- **OpenAI `gpt-4o-mini-tts` with Turkish podcast instructions** — ~15× cheaper than ElevenLabs, natural Turkish prosody, supports both single-voice narration and dual-host podcasts while keeping Edge Neural TTS as free default.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
cd mobile
npx tsc --noEmit
```
