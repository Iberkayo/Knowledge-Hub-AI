# Handoff — 2026-11-27 22:22 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Ship **Knowledge Hub AI** across Web + **Native iOS App Store** (Expo / React Native + FastAPI backend) on `feat/mvp-foundation` (PR #1).

## Done
- **Phase 1 Accepted (Checkpoints 1–5: `062bdad`, `f28462a`, `a8038c7`, `22ec73d`, `714ca97`):**
  - Locked 3-phase iOS App Store scope (`docs/SCOPE.md`), API-first architecture & Anti-AI-Slop Editorial UX Constitution (`docs/ARCHITECTURE.md`).
  - Python 3.11 `.venv`, RTX 3050 CUDA 12 Faster-Whisper (`cuda_available: True`), Edge Neural TTS (`tr-TR-AhmetNeural` / `tr-TR-EmelNeural` — accepted as MVP, flagged in `docs/SCOPE.md` for future premium/GPU TTS upgrade), fluent Turkish prompt (`v2.1`), code/table/URL skipping in narration, warm paper/ink editorial UI verified on desktop & 390px iPhone viewport.
- **Phase 2 Complete (Checkpoints 6–8: `843b4d1`, `1f05dfe`, `ad42440`):**
  - Optional `KH_API_TOKEN` constant-time Bearer auth (`knowledge_hub/auth.py`), `/api/health`, HTTP `206 Partial Content` (`Range`) audio streaming verified, Tailscale iPhone guide (`docs/MOBILE_ACCESS.md`).
  - YouTube URL → timestamped transcript ingestion (`knowledge_hub/youtube.py`, auto-detected inside `/api/import-url`).
  - NotebookLM-style 2-speaker Turkish Podcast generator (`knowledge_hub/podcast.py` — Emel + Ahmet dual-voice MP3 + interactive speaker transcript via `/api/items/{id}/podcast`).
- **Checkpoint 9 (Phase 3 Kickoff — Native iOS Expo / React Native App Scaffolded in `mobile/`):**
  - Scaffolded Expo SDK 58 (`expo ~58.1.0`, `react-native 0.88.1`, TypeScript strict mode) in `mobile/` with `expo-audio`, `expo-file-system`, `expo-secure-store`, `expo-haptics`, `react-native-safe-area-context`, `lucide-react-native`.
  - Configured App Store metadata & EAS Build profiles (`mobile/app.json` with `UIBackgroundModes: ["audio"]` + `ITSAppUsesNonExemptEncryption: false`, `mobile/eas.json`).
  - Implemented editorial Paper/Ink iOS design system (`mobile/src/theme.ts`), iOS Keychain FastAPI client (`mobile/src/api.ts`), real filesystem offline article + MP3 cache (`mobile/src/offline.ts`), and global background + iOS Lock Screen audio player + `MiniPlayer` (`mobile/src/playerContext.tsx`).
  - Built all 5 native screens (`LibraryScreen`, `ReaderScreen` with `Aa` sheet & actions sheet, `DiscoverScreen`, `ListenScreen` with interactive speaker transcript, `SettingsScreen`) + `mobile/App.tsx`.
  - Added `docs/IOS_RELEASE.md` (Expo Go 2-minute test + EAS Build -> TestFlight / App Store Connect guide) and updated root `.gitignore` for mobile build artifacts.
  - Verified `npx tsc --noEmit` (0 errors) inside `mobile/` AND **60/60 backend pytest tests** passing.

## In progress
- Ready for user to test the native iOS app on their iPhone via Expo Go (`cd mobile && npx expo start --tunnel`) or trigger their first EAS TestFlight build, and decide the next Phase 3 milestone (iOS Share Extension / Cloud multi-user backend / TTS voice upgrade).

## Next steps
1. **Live iPhone Test (2 minutes):**
   - Start FastAPI with `KH_API_TOKEN` + `tailscale serve https / http://127.0.0.1:8000` (see `docs/MOBILE_ACCESS.md`).
   - Run `cd mobile && npx expo start --tunnel` and scan QR code with **Expo Go** on iPhone.
   - Enter Tailscale HTTPS URL + token in **Ayarlar** and verify reading, background lock-screen audio, offline download, YouTube import, and 2-speaker podcast playback on iPhone.
2. **Phase 3B (App Store Polish & Custom Native Features):**
   - Add **iOS Share Extension** (1-tap save from Safari / X / YouTube) via Expo config plugin.
   - Replace placeholder `mobile/assets/icon.png` with rendered editorial terracotta/paper App Store 1024×1024 PNG icon (matching `knowledge_hub/static/icon.svg`).
   - Upgrade TTS quality (e.g. OpenAI `gpt-4o-mini-tts` / Google Chirp 3 HD / ElevenLabs `multilingual_v2` / local GPU Chatterbox).
3. **Phase 3C (Public App Store Launch — Multi-User Cloud Readiness):**
   - Add Postgres + R2/S3 storage backend, Sign in with Apple, in-app account deletion, privacy policy & StoreKit 2 / BYOK positioning, then `eas build --platform ios --profile production` + `eas submit`.

## Decisions & why
- **Expo SDK 58 `expo-audio` with built-in Lock Screen controls** — Official native iOS background audio & lock screen controls (`setActiveForLockScreen`) without fragile third-party native patches; works in both Expo Go and EAS Build.
- **TTS noted as improvable** — Edge Neural TTS is acceptable for MVP/Phase 2; `audio_pipeline.py` keeps providers swappable so upgrading TTS automatically upgrades both Web and iOS.
- **Monorepo `mobile/` folder** — Keeps FastAPI backend and Expo iOS app synchronized on `feat/mvp-foundation` (never merge to `main` without explicit user approval).

## Gotchas
- `mobile/node_modules/` and `mobile/.expo/` are gitignored; after cloning on another machine run `cd mobile && npm install`.
- Local FastAPI server (`127.0.0.1:8000`) may still be running in the background during development.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
cd mobile
npx tsc --noEmit
```
