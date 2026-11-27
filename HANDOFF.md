# Handoff — 2026-11-27 21:52 — Antigravity (Home PC w/ RTX 3050 6GB)

## Goal
Complete **Phase 1 (v0.5)** live quality acceptance & editorial UX on `feat/mvp-foundation` (PR #1), following the locked 3-phase roadmap toward a public **iOS App Store** release (Expo/React Native thin client + FastAPI backend).

## Done
- **Checkpoints 1–4 (`062bdad`, `f28462a`, `a8038c7`, `22ec73d`):**
  - Locked 3-phase iOS App Store scope (`docs/SCOPE.md`) & API-first architecture + Anti-AI-Slop Editorial UX Constitution (`docs/ARCHITECTURE.md`).
  - Python 3.11 `.venv` with `supertonic`, `edge-tts`, `faster-whisper`, RTX 3050 CUDA 12 runtime DLLs (`cuda_available: True`).
  - Complete Editorial UX Overhaul (warm paper/ink themes, pure SVG icons, calm reading list, distraction-free reader + `Aa` popover, 5-tab settings, desktop + mobile `390px` verified).
- **Checkpoint 5 (Natural Turkish TTS, Fluent Translation Prompt, Code-Skipping & Reader Bar Fix):**
  - **Fixed `.reader-bar` / `#jobsBanner` overlap:** Removed negative top margin on `.reader-bar` in `knowledge_hub/static/styles.css` so active job banners never overlap the reader toolbar.
  - **Fixed robotic/foreign-accent TTS:** Switched default TTS provider to **Edge Neural TTS** (`tr-TR-AhmetNeural` / `tr-TR-EmelNeural` — native Turkish accent, free, unlimited, 27× smaller MP3 than Supertonic WAV), added `edge_tts_voice` setting, `POST /api/providers/edge-tts/sample`, Settings UI voice picker + preview button, and provider-aware re-narration ("Yeniden Seslendir" in reader menu + automatic prompt when TTS provider changes).
  - **Skipped code/tables/URLs in narration:** Updated `clean_narration_text()` in `knowledge_hub/audio_pipeline.py` to completely omit fenced code blocks, display math, markdown tables, raw URLs, and code-like inline tokens instead of reading them aloud.
  - **Upgraded Turkish translation fluency (`PROMPT_VERSION = "v2.1"`):** Rewrote `SYSTEM_PROMPTS["faithful"]` in `knowledge_hub/translation.py` for natural, non-translationese native Turkish while strictly preserving code, CLI commands, URLs, equations, and proper/library/product names verbatim. Added 1-click OpenRouter model presets (`google/gemini-2.5-flash`, `anthropic/claude-sonnet-4`, `openai/gpt-4.1-mini`) and "leave Turkish blank to preserve verbatim" workflow in Glossary.
  - **Roadmap updated:** Added **YouTube/Video → Transkript → NotebookLM-style 2-speaker Turkish Podcast ("Audio Overview")** and optional **DeepL API** provider to `docs/SCOPE.md` (Phase 2).
  - Bumped `sw.js` cache to `kh-shell-v9` and verified all 54 pytest tests passing.

## In progress
- **User Live Re-test:** Local server restarted on `http://127.0.0.1:8000`. User to hard-refresh (`Ctrl+F5`), preview **Edge Neural TTS (Ahmet/Emel)** in **Ayarlar → Seslendirme**, and test natural Turkish translation with `google/gemini-2.5-flash` or `anthropic/claude-sonnet-4` on `Your AI Product Needs Evals`.

## Next steps
1. User confirms Turkish translation + Edge Neural TTS quality (and decides whether to also add **DeepL** or local GPU TTS).
2. **Phase 2 (v0.6):**
   - YouTube / Video URL → transcript (`youtube-transcript-api` + `yt-dlp` / Faster-Whisper CUDA) → Turkish translation → **NotebookLM-style 2-speaker Turkish Podcast** (Ahmet + Emel MP3).
   - Optional `KH_API_TOKEN` Bearer auth + HTTP `206 Partial Content` (`Range`) audio streaming + Tailscale HTTPS daily dogfooding on iPhone.
3. **Phase 3 (v1.0):** Expo (React Native) native iOS app (Share Extension + `react-native-track-player` + offline bundle) → Apple App Store via EAS Build.

## Decisions & why
- **Edge Neural TTS (`tr-TR-AhmetNeural` / `tr-TR-EmelNeural`) as default over Supertonic 3** — Supertonic 3 had a noticeable foreign accent in Turkish; Edge Neural has native Turkish pronunciation, is free/unlimited, and produces compact MP3s ideal for iOS mobile. Supertonic 3 remains available as offline fallback.
- **Zero code read aloud** — User explicitly requested code blocks and technical snippets never be translated or spoken aloud.
- **Never merge to `main`** — Keep all commits on `feat/mvp-foundation` until user approves merge.

## Gotchas
- Browser Service Worker cache bumped to `kh-shell-v9`; tell user to press `Ctrl+F5` if old styles persist.
- Existing `outputs/library.sqlite3` on this PC may still have `tts_provider: "supertonic"` saved from before; user can switch to **Edge Neural TTS** in **Ayarlar → Seslendirme** and click **Kaydet**.

## How to verify
```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m knowledge_hub.benchmark --out outputs/smoke.json
Remove-Item outputs\smoke.json -Force
```
