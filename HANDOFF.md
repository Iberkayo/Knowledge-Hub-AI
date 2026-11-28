# Handoff — 2026-11-28 22:36 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Ship **Knowledge Hub AI** across Web + **Native iOS App Store** (Expo / React Native + FastAPI backend) on `feat/mvp-foundation` (PR #1).

## Done
- **Phase 1 & 2 Complete (Checkpoints 1–8: `062bdad`..`ad42440`):** Locked 3-phase iOS App Store scope, API-first architecture & Anti-AI-Slop Editorial UX Constitution, Python 3.11 `.venv` + RTX 3050 CUDA 12 Faster-Whisper, Edge Neural TTS (`AhmetNeural`/`EmelNeural`), fluent Turkish prompt (`v2.1`), code-skipping in narration, Bearer auth (`KH_API_TOKEN`), HTTP `206 Range` audio streaming, YouTube transcript ingestion, and 2-speaker Emel & Ahmet Turkish podcast generation.
- **Checkpoints 9–12 (`78f36c7`..`2573f9d` — Native iOS App + Zero-Knowledge BYOK + App Store Icon + OpenAI TTS):**
  - Live-verified Expo SDK 58 iOS app on physical iPhone (Library, Editorial Reader, Discover, Listen, Settings, full-screen Now Playing sheet with 60fps scrubber & single smooth swipe-down dismiss, deterministic per-job polling).
  - Exported opaque 24-bit RGB `1024×1024` editorial App Store icon (`mobile/assets/icon.png`), added OpenAI `gpt-4o-mini-tts`, and implemented **True Zero-Knowledge BYOK** (`mobile/src/directTranslate.ts`: `iPhone → OpenRouter` via iOS Keychain, plus `PUT /api/items/{id}/translation` sync).
- **Checkpoint 13 (EAS TestFlight Pre-Flight 20/20 Green & Expo Project Linked):**
  - Installed `eas-cli/27.11.0` globally (already authenticated as `ibrberkoz`).
  - Installed missing native peer dependency `expo-asset` (prevents standalone crash outside Expo Go) + `expo-splash-screen` (light `#F8F5EF` / dark `#141311` editorial splash).
  - Hardened `mobile/app.json`: disabled unnecessary microphone permissions (`expo-audio` `microphonePermission: false`, `recordAudioAndroid: false`, `enableBackgroundPlayback: true`), added `NSAppTransportSecurity: { NSAllowsLocalNetworking: true }` (allows local Wi-Fi testing inside TestFlight while enforcing HTTPS for internet/Tailscale), added `buildNumber: "1"`, and verified Apple `privacyManifests`.
  - Linked EAS project `@ibrberkoz/knowledge-hub-ai` (`projectId: 28ed2794-d3f6-4e62-8684-128a65ab089a`, `owner: "ibrberkoz"`).
  - Verified **`npx expo-doctor` 20/20 checks passed** and **`npx tsc --noEmit` 0 errors**.

## In progress
- **First iOS TestFlight Cloud Build (Interactive Apple Developer 2FA Step):** User runs `eas build --platform ios --profile production` in PowerShell so Apple Developer interactive 2FA can issue the Distribution Certificate & Provisioning Profile on Apple's portal, then `eas submit --platform ios --latest` to install via TestFlight on iPhone.

## Next steps
1. **Trigger First iOS TestFlight Build (User's interactive PowerShell):**
   ```powershell
   cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI\mobile"
   eas build --platform ios --profile production
   ```
   After build finishes (~10–15 min on EAS macOS runners), submit to TestFlight:
   ```powershell
   eas submit --platform ios --latest
   ```
2. **Verify Lock-Screen & Background Audio on iPhone via TestFlight:** Confirm continuous background audio + AirPods/lock-screen controls work natively with compiled `UIBackgroundModes: ["audio"]`.
3. **Phase 3B (Next Features):** Tailscale HTTPS for out-of-home iPhone access (`docs/MOBILE_ACCESS.md`), native **iOS Share Extension** (Safari/X/YouTube 1-tap save), and multi-user cloud backend readiness (Sign in with Apple + account deletion + Postgres/R2).

## Decisions & why
- **`NSAllowsLocalNetworking: true`** — Lets the TestFlight build connect to home LAN `http://192.168.x.x:8000` immediately while keeping strict HTTPS enforced for all public/Tailscale traffic (Apple App Store Review compliant).
- **`microphonePermission: false` on `expo-audio`** — Prevents unnecessary microphone permission declarations during App Store Review while keeping `UIBackgroundModes: ["audio"]` active.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user explicitly approves merge.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
cd mobile
npx expo-doctor
npx tsc --noEmit
```
