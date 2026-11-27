# Knowledge Hub AI
Yabancı dildeki teknik içerikleri Türkçe okumak ve dinlemek için kişisel kütüphane.

## P0 prototype
Python 3.11+, local UTF-8 text, configurable OpenAI translation, bilingual segment JSON, numeric mismatch warnings, optional numbered MP3 files. No web ingestion or audio transcription yet.

```sh
python -m pip install -e ".[test]"
python -m pytest
```

Set OPENAI_API_KEY in your local environment and choose an available translation model. Use only content you are authorized to process.

```sh
knowledge-hub source.txt --out outputs/demo --model YOUR_MODEL --allow-paid --audio
```

Omit --audio for text only. The output directory must be new. API calls can incur charges; there is no live cost cap yet. Audio uses synthetic narration, not speaker cloning. Numeric checks are heuristic; semantic accuracy requires review. The source and outputs should remain local and must not be redistributed without permission.

See [scope](docs/SCOPE.md).
