"""Secure local secret storage for API keys.

Uses Windows DPAPI (CryptProtectData / CryptUnprotectData) when available on
Windows so API keys are encrypted per-user at rest and never stored in plain
text inside SQLite or returned to the frontend. Falls back to environment
variables and a 0o600 local store on non-Windows platforms.
"""
from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys
from threading import Lock

SUPPORTED_KEYS = (
    "openrouter_api_key",
    "openai_api_key",
    "elevenlabs_api_key",
    "custom_llm_api_key",
)

ENV_MAP = {
    "openrouter_api_key": "OPENROUTER_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
    "elevenlabs_api_key": "ELEVENLABS_API_KEY",
    "custom_llm_api_key": "KH_CUSTOM_LLM_API_KEY",
}


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _dpapi_protect(raw: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_blob = _DATA_BLOB(len(raw), ctypes.cast(ctypes.create_string_buffer(raw, len(raw)), ctypes.POINTER(ctypes.c_char)))
    out_blob = _DATA_BLOB()
    if not crypt32.CryptProtectData(ctypes.byref(in_blob), "KnowledgeHubAI", None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("Windows DPAPI CryptProtectData failed")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def _dpapi_unprotect(cipher: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_blob = _DATA_BLOB(len(cipher), ctypes.cast(ctypes.create_string_buffer(cipher, len(cipher)), ctypes.POINTER(ctypes.c_char)))
    out_blob = _DATA_BLOB()
    if not crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("Windows DPAPI CryptUnprotectData failed")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def mask_secret(value: str | None) -> str:
    """Return a non-sensitive masked preview of an API key."""
    if not value:
        return ""
    clean = value.strip()
    if len(clean) <= 8:
        return "••••"
    return f"{clean[:4]}••••{clean[-4:]}"


class SecretStore:
    """Thread-safe local secret store; never returns raw keys to HTTP callers."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def _use_dpapi(self) -> bool:
        return sys.platform == "win32" and hasattr(ctypes, "windll")

    def _read_store(self) -> dict[str, str]:
        if not self.path.is_file():
            return {}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        encoding = payload.get("encoding")
        data = payload.get("data", "")
        if not data:
            return {}
        if encoding == "dpapi-b64" and self._use_dpapi():
            raw = _dpapi_unprotect(base64.b64decode(data.encode("ascii")))
            return json.loads(raw.decode("utf-8"))
        if encoding == "plain-b64":
            raw = base64.b64decode(data.encode("ascii"))
            return json.loads(raw.decode("utf-8"))
        return {}

    def _write_store(self, secrets: dict[str, str]) -> None:
        raw = json.dumps(secrets, ensure_ascii=False).encode("utf-8")
        if self._use_dpapi():
            encoding = "dpapi-b64"
            encoded = base64.b64encode(_dpapi_protect(raw)).decode("ascii")
        else:
            encoding = "plain-b64"
            encoded = base64.b64encode(raw).decode("ascii")
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"encoding": encoding, "data": encoded}), encoding="utf-8")
        if os.name == "posix":
            os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    def get(self, name: str) -> str | None:
        if name not in SUPPORTED_KEYS:
            raise KeyError(f"Unsupported secret: {name}")
        with self._lock:
            stored = self._read_store().get(name)
        if stored:
            return stored
        env_var = ENV_MAP.get(name)
        return os.getenv(env_var) if env_var else None

    def set(self, name: str, value: str | None) -> None:
        if name not in SUPPORTED_KEYS:
            raise KeyError(f"Unsupported secret: {name}")
        with self._lock:
            current = self._read_store()
            if value and value.strip():
                current[name] = value.strip()
            else:
                current.pop(name, None)
            self._write_store(current)

    def status(self) -> dict[str, dict[str, object]]:
        """Return safe status metadata for UI without ever exposing raw secrets."""
        with self._lock:
            stored = self._read_store()
        result: dict[str, dict[str, object]] = {}
        for name in SUPPORTED_KEYS:
            store_val = stored.get(name)
            env_val = os.getenv(ENV_MAP[name])
            active = store_val or env_val or ""
            source = "store" if store_val else ("env" if env_val else "none")
            result[name] = {
                "configured": bool(active),
                "masked": mask_secret(active),
                "source": source,
                "storage_backend": "windows-dpapi" if self._use_dpapi() else "local-file-0600",
            }
        return result
