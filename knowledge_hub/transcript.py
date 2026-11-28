"""Import existing SRT/VTT/plain transcripts without a transcription API."""
import re
def parse_transcript(text: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = raw.strip().lstrip('\ufeff')
        if not line or line == "WEBVTT" or line.isdigit() or "-->" in line:
            continue
        lines.append(line)
    result = "\n".join(lines)
    if not result:
        raise ValueError("Empty transcript")
    return result
