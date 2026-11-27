# API-last development
Install: python -m pip install -e ".[test]"
Run: python -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port 8000
Open http://127.0.0.1:8000.
Local SQLite persists under outputs/. The local UI accepts pasted text, saved HTML and existing transcript files. Demo mode echoes the source with an explicit marker; browser speech depends on installed voices and may use browser/OS services. It is not real translation, transcription or generated MP3.
Provider protocols isolate future translation, transcription and narration implementations. Existing paid CLI is optional via pip install -e ".[ai]"; never invoked by the web app.
Still required: safe URL/RSS retrieval, actual audio file processing, timestamps and speaker alignment, job queue, robust document parsing, real translation QA, exports, native mobile app and deployment security. Local prototype only; do not expose publicly.
