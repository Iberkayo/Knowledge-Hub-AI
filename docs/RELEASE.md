# v0.4 API-free prototype
Install: python -m pip install -e ".[test]"
Start: python -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port 8000
Mobile-responsive PWA shell, local library, search, notes, favorites, categories, text export, saved RSS/Atom import, local audio player and browser narration. PWA shell cache does not cache private library data; local server required. No native app.
Explicit public HTTPS article/feed fetching uses public-IP pinning and hostname TLS checks, rejects redirects and compressed responses, limits response bytes, supports UTF-8 only. No auth bypass. Fetching is best effort and not a production SSRF security certification. Respect source terms. No live source tests yet.
Optional media tools: pip install -e ".[media]". python -m knowledge_hub.media document book.epub outputs/book.txt; python -m knowledge_hub.media audio episode.mp3 outputs/episode.json --allow-download. Create output directory first. Import extracted text manually. Real Whisper inference requires model and local audio.
ElevenLabs pilot: see ELEVEN_PILOT.md. Paid CLI remains opt-in. No actual translation in UI, automatic RSS monitoring, diarization, OCR, durable job queue, semantic QA, or production deployment. These remain release blockers. Do not expose server beyond loopback. No secrets or user media in Git.
