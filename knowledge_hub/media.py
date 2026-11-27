"""Local media ingestion and Faster-Whisper transcription. No paid API."""
from __future__ import annotations

import argparse
import ctypes
from importlib.util import find_spec
import json
import os
from pathlib import Path
import posixpath
import shutil
import sys
import zipfile
from html.parser import HTMLParser


def _register_nvidia_dll_dirs() -> None:
    """Expose pip-installed nvidia/*/bin CUDA DLLs on Windows for ctranslate2/Faster-Whisper."""
    if os.name != "nt":
        return
    try:
        site_roots = [Path(p) for p in sys.path if p and "site-packages" in p.lower()]
        for root in site_roots:
            nvidia_dir = root / "nvidia"
            if not nvidia_dir.is_dir():
                continue
            for bin_dir in nvidia_dir.glob("*/bin"):
                if not bin_dir.is_dir():
                    continue
                bin_str = str(bin_dir)
                if hasattr(os, "add_dll_directory"):
                    try:
                        os.add_dll_directory(bin_str)
                    except OSError:
                        pass
                if bin_str.lower() not in os.environ.get("PATH", "").lower():
                    os.environ["PATH"] = bin_str + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass


def _cuda_runtime_ready() -> bool:
    """Check whether ctranslate2/Faster-Whisper can actually execute on a CUDA GPU."""
    _register_nvidia_dll_dirs()
    if find_spec("ctranslate2") is not None:
        try:
            import ctranslate2

            if int(ctranslate2.get_cuda_device_count()) > 0:
                if os.name == "nt":
                    # ctranslate2 CUDA 12 wheels require cublas64_12.dll at runtime
                    try:
                        ctypes.WinDLL("cublas64_12.dll")
                        return True
                    except OSError:
                        return False
                return True
        except Exception:
            pass
    if find_spec("torch") is not None:
        try:
            import torch

            return bool(torch.cuda.is_available())
        except Exception:
            return False
    return False


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        if tag in ("p", "h1", "h2", "h3", "li", "br"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def _safe_zip_member(base_dir: str, href: str) -> str:
    joined = posixpath.normpath(posixpath.join(base_dir, href))
    if joined.startswith("../") or joined.startswith("/") or ".." in joined.split("/"):
        raise ValueError("Unsafe path inside EPUB archive")
    return joined


def document(path: str | Path) -> str:
    path = Path(path)
    if path.stat().st_size > 50_000_000:
        raise ValueError("Document exceeds 50 MB")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        if len(reader.pages) > 500:
            raise ValueError("PDF exceeds 500 pages")
        text = "\n\n".join(p.extract_text() or "" for p in reader.pages)
    elif suffix == ".epub":
        from defusedxml import ElementTree as ET

        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist()) > 100_000_000:
                raise ValueError("EPUB expansion too large")
            root = ET.fromstring(z.read("META-INF/container.xml"))
            rootfile = root.find(".//{*}rootfile")
            if rootfile is None or "full-path" not in rootfile.attrib:
                raise ValueError("Invalid EPUB container")
            opf = _safe_zip_member("", rootfile.attrib["full-path"])
            package = ET.fromstring(z.read(opf))
            manifest = {e.attrib["id"]: e.attrib["href"] for e in package.findall(".//{*}manifest/{*}item") if "id" in e.attrib and "href" in e.attrib}
            parts = []
            opf_dir = posixpath.dirname(opf)
            for e in package.findall(".//{*}spine/{*}itemref"):
                idref = e.attrib.get("idref")
                if not idref or idref not in manifest:
                    continue
                member = _safe_zip_member(opf_dir, manifest[idref])
                parser = TextParser()
                parser.feed(z.read(member).decode("utf-8", errors="replace"))
                parts.append("".join(parser.parts))
            text = "\n\n".join(parts)
    else:
        raise ValueError("Use PDF or EPUB")
    if not text.strip():
        raise ValueError("No extractable text; scanned PDFs need OCR")
    return text


def whisper_status() -> dict[str, object]:
    """Report Faster-Whisper and FFmpeg availability without downloading models."""
    fw_installed = find_spec("faster_whisper") is not None
    pypdf_installed = find_spec("pypdf") is not None
    ffmpeg_path = shutil.which("ffmpeg")
    cuda_available = _cuda_runtime_ready()
    return {
        "faster_whisper_installed": fw_installed,
        "pypdf_installed": pypdf_installed,
        "ffmpeg_installed": bool(ffmpeg_path),
        "cuda_available": cuda_available,
        "recommended_device": "cuda" if cuda_available else "cpu",
        "supported_models": ["tiny", "base", "small", "medium", "large-v3"],
    }


def transcribe(
    path: str | Path,
    model: str = "small",
    allow_download: bool = False,
    device: str = "cpu",
    language: str | None = None,
) -> dict[str, object]:
    _register_nvidia_dll_dirs()
    from faster_whisper import WhisperModel

    resolved_device = device
    if device == "auto":
        resolved_device = "cuda" if _cuda_runtime_ready() else "cpu"
    compute_type = "float16" if resolved_device == "cuda" else "int8"
    engine = WhisperModel(
        model,
        device=resolved_device,
        compute_type=compute_type,
        local_files_only=not allow_download,
    )
    kwargs = {"vad_filter": True}
    if language and language != "auto":
        kwargs["language"] = language
    segments, info = engine.transcribe(str(path), **kwargs)
    rows = [
        {"start": round(float(s.start), 2), "end": round(float(s.end), 2), "text": s.text.strip()}
        for s in segments
        if s.text.strip()
    ]
    return {
        "language": getattr(info, "language", language or "unknown"),
        "duration": round(float(getattr(info, "duration", 0) or 0), 2),
        "segments": rows,
        "text": "\n".join(s["text"] for s in rows),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("kind", choices=["document", "audio"])
    p.add_argument("source", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--model", default="small")
    p.add_argument("--device", default="cpu")
    p.add_argument("--allow-download", action="store_true")
    a = p.parse_args()
    if a.output.exists():
        p.error("Output already exists")
    if a.kind == "document":
        result = document(a.source)
    else:
        if a.source.stat().st_size > 500_000_000:
            p.error("Audio exceeds 500 MB")
        result = json.dumps(
            transcribe(a.source, a.model, a.allow_download, device=a.device),
            ensure_ascii=False,
            indent=2,
        )
    with a.output.open("x", encoding="utf-8") as f:
        f.write(result)


if __name__ == "__main__":
    main()
