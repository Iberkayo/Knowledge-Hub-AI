"""Provider contracts and implementations for translation, transcription, and narration."""
from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Protocol

import httpx


@dataclass(frozen=True)
class TranslationResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class Translator(Protocol):
    def translate(self, text: str) -> str: ...


class RichTranslator(Protocol):
    provider_name: str
    model_name: str

    def translate_segment(
        self,
        segment: str,
        *,
        system_prompt: str,
        context_before: str = "",
        glossary_hint: str = "",
    ) -> TranslationResult: ...


class Transcriber(Protocol):
    def transcribe(self, audio: bytes, mime_type: str) -> str: ...


class Narrator(Protocol):
    def narrate(self, text: str) -> bytes: ...


class DemoTranslator:
    """Explicitly labeled demo transformer; never claims to be real translation."""

    def translate(self, text: str) -> str:
        return "[DEMO — gerçek çeviri değil] " + text


class MockTranslator:
    """Deterministic offline translator for automated tests and API-free E2E verification."""

    provider_name = "mock"

    def __init__(self, model_name: str = "mock-tr-v1", mode: str = "faithful"):
        self.model_name = model_name
        self.mode = mode

    def translate(self, text: str) -> str:
        return self.translate_segment(text, system_prompt="").text

    def translate_segment(
        self,
        segment: str,
        *,
        system_prompt: str = "",
        context_before: str = "",
        glossary_hint: str = "",
    ) -> TranslationResult:
        clean = segment.strip()
        if not clean:
            return TranslationResult("")
        # Preserve code blocks and headings cleanly while marking mock output transparently
        if clean.startswith("```"):
            out = clean
        elif self.mode == "summary":
            first_sentence = clean.split("\n")[0][:240]
            out = f"[MOCK ÖZET] {first_sentence}"
        elif self.mode == "explained":
            out = f"[MOCK ÇEVİRİ] {clean}\n\n[Açıklama]: Bu bölüm test/mock modu ile oluşturulmuş teknik açıklama örneğidir."
        else:
            out = f"[MOCK ÇEVİRİ] {clean}"
        approx_in = max(1, len(clean) // 4)
        approx_out = max(1, len(out) // 4)
        return TranslationResult(text=out, input_tokens=approx_in, output_tokens=approx_out, cost_usd=0.0)


class OpenAICompatibleTranslator:
    """Translator using OpenRouter, OpenAI, or a local OpenAI-compatible endpoint."""

    def __init__(
        self,
        *,
        provider_name: str,
        base_url: str,
        api_key: str,
        model_name: str,
        timeout: float = 90.0,
        transport: httpx.BaseTransport | None = None,
    ):
        self.provider_name = provider_name
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name
        self.timeout = timeout
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key or 'local'}",
        }
        if self.provider_name == "openrouter":
            headers["HTTP-Referer"] = "https://github.com/Iberkayo/Knowledge-Hub-AI"
            headers["X-Title"] = "Knowledge Hub AI"
        return headers

    def translate_segment(
        self,
        segment: str,
        *,
        system_prompt: str,
        context_before: str = "",
        glossary_hint: str = "",
    ) -> TranslationResult:
        user_parts = []
        if glossary_hint:
            user_parts.append(glossary_hint)
        if context_before:
            user_parts.append(
                "<PREVIOUS_CONTEXT_READ_ONLY>\n"
                + context_before.strip()
                + "\n</PREVIOUS_CONTEXT_READ_ONLY>"
            )
        user_parts.append("<SOURCE_CONTENT>\n" + segment + "\n</SOURCE_CONTENT>")
        payload = {
            "model": self.model_name,
            "temperature": 0.15,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "\n\n".join(user_parts)},
            ],
        }
        with httpx.Client(timeout=self.timeout, transport=self._transport) as client:
            resp = client.post(f"{self.base_url}/chat/completions", headers=self._headers(), json=payload)
        if resp.status_code >= 400:
            detail = _safe_error_detail(resp)
            raise RuntimeError(f"{self.provider_name} API error ({resp.status_code}): {detail}")
        data = resp.json()
        choices = data.get("choices") or []
        content = (choices[0].get("message", {}).get("content") or "").strip() if choices else ""
        if not content:
            raise ValueError("Provider returned empty translation")
        usage = data.get("usage") or {}
        cost = float(usage.get("cost") or 0.0)
        return TranslationResult(
            text=content,
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            cost_usd=cost,
        )


def _safe_error_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        err = body.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or resp.status_code)[:200]
        if err:
            return str(err)[:200]
    except Exception:
        pass
    return f"HTTP {resp.status_code}"


def fetch_openrouter_models(
    base_url: str = "https://openrouter.ai/api/v1",
    api_key: str | None = None,
    transport: httpx.BaseTransport | None = None,
) -> list[dict[str, object]]:
    """Fetch available models from OpenRouter public models API."""
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    with httpx.Client(timeout=20.0, transport=transport) as client:
        resp = client.get(f"{base_url.rstrip('/')}/models", headers=headers)
    if resp.status_code >= 400:
        raise RuntimeError(f"OpenRouter models error ({resp.status_code}): {_safe_error_detail(resp)}")
    rows = resp.json().get("data") or []
    models: list[dict[str, object]] = []
    for m in rows:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        pricing = m.get("pricing") or {}
        models.append(
            {
                "id": mid,
                "name": str(m.get("name") or mid),
                "context_length": int(m.get("context_length") or 0),
                "prompt_price": str(pricing.get("prompt") or ""),
                "completion_price": str(pricing.get("completion") or ""),
            }
        )
    return models


def test_translation_connection(
    *,
    provider: str,
    base_url: str,
    api_key: str,
    model_name: str,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, object]:
    """Perform a minimal, safe connection test against the configured translation provider."""
    if provider == "mock":
        return {"ok": True, "provider": "mock", "model": model_name, "sample": "Mock bağlantı başarılı."}
    if provider != "custom" and not api_key:
        raise ValueError("API anahtarı yapılandırılmamış.")
    tr = OpenAICompatibleTranslator(
        provider_name=provider,
        base_url=base_url,
        api_key=api_key,
        model_name=model_name,
        timeout=25.0,
        transport=transport,
    )
    res = tr.translate_segment(
        "95% confidence interval",
        system_prompt="Translate into Turkish only. Keep numbers intact.",
    )
    return {
        "ok": True,
        "provider": provider,
        "model": model_name,
        "sample": res.text[:200],
        "input_tokens": res.input_tokens,
        "output_tokens": res.output_tokens,
    }
