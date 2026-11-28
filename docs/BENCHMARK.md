# Translation benchmark
Six original synthetic cases in English, German, French and Spanish. References are provisional and need human review. No third-party article is stored.
Offline smoke: python -m knowledge_hub.benchmark --out outputs/smoke.json
Live opt-in: python -m knowledge_hub.benchmark --model MODEL_A --model MODEL_B --allow-paid --out outputs/live.json
OpenAI-compatible endpoint may be configured via OPENAI_BASE_URL and OPENAI_API_KEY. Use only trusted endpoints.
Blind review per case: score 0–4 on fidelity (35%), terminology (25%), completeness (20%), fluency (10%), mathematical/numeric integrity (10%). Weighted score = sum(weight * rating / 4). Any material omission or altered mathematical claim is a critical failure regardless of score. Record latency, token usage and provider-specific price separately. Six cases are a smoke set, not a statistically sufficient benchmark. Expand before selecting a model.
Pilot source: https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/
Use authorized local HTML or text. Offline extraction: python -m knowledge_hub.ingest article.html outputs/article.txt (create outputs directory first).
The parser is deliberately simple; inspect the extracted text for missing sections, code and math before translation. No direct URL network fetch yet. TTS listening test: inspect pronunciation, intelligibility, pace and completeness on the same authorized sample. No live results yet.
