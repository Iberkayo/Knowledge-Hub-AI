"""Provider contracts. Demo never claims to translate or transcribe."""
from typing import Protocol

class Translator(Protocol):
    def translate(self, text: str) -> str: ...

class Transcriber(Protocol):
    def transcribe(self, audio: bytes, mime_type: str) -> str: ...

class Narrator(Protocol):
    def narrate(self, text: str) -> bytes: ...

class DemoTranslator:
    def translate(self, text: str) -> str:
        return "[DEMO — gerçek çeviri değil] " + text
