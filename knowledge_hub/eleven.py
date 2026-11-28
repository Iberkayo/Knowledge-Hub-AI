"""Opt-in ElevenLabs speech pilot; no automatic requests or retries."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

MODELS = ("eleven_flash_v2_5", "eleven_multilingual_v2")
SAMPLE = ("İstatistiksel çıkarım, örneklemden hareketle anakütle hakkında bilgi edinmemizi sağlar. "
          "Bir modelin precision ve recall değerleri farklı amaçlara hizmet eder. "
          "Yüzde 95 güven aralığı ile olasılık tahminini birbirine karıştırmamalıyız. "
          "CatBoost, feature engineering ve data leakage gibi teknik terimlerin telaffuzu önemlidir.")

def synthesize(text, model, voice, key, output, *, allow_live=False, transport=None):
    if model not in MODELS or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", voice):
        raise ValueError("Unsupported model or invalid voice ID")
    if not text.strip() or len(text) > 1000:
        raise ValueError("Pilot requires 1–1000 characters")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    payload = {"text":text,"model_id":model}
    if model == "eleven_flash_v2_5":
        payload["language_code"] = "tr"
    fingerprint = hashlib.sha256(json.dumps([voice,payload,"mp3_44100_128"],sort_keys=True).encode()).hexdigest()
    path = output / (fingerprint + ".mp3")
    if path.is_file() and path.stat().st_size:
        return {"path":str(path),"cached":True,"requested_characters":0}
    if not allow_live or not key:
        raise ValueError("Live API requires explicit permission and an environment key")
    # Reserve characters before attempting a request; failed calls count too.
    # A local lifetime guard, not a provider credit balance or billing guarantee.
    with sqlite3.connect(output / "pilot.sqlite3") as db:
        db.execute("CREATE TABLE IF NOT EXISTS attempts (chars INTEGER NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        used = db.execute("SELECT COALESCE(SUM(chars),0) FROM attempts").fetchone()[0]
        if used + len(text) > 3000:
            raise ValueError("Local pilot character budget exhausted")
        db.execute("INSERT INTO attempts VALUES (?)",(len(text),))
    req = Request("https://api.elevenlabs.io/v1/text-to-speech/"+voice+"?output_format=mp3_44100_128",
                  data=json.dumps(payload).encode(),headers={"xi-api-key":key,"Content-Type":"application/json","Accept":"audio/mpeg"},method="POST")
    started = time.monotonic()
    try:
        with (transport or urlopen)(req,timeout=90) as res:
            if not res.headers.get("Content-Type","").startswith("audio/"):
                raise ValueError("Expected audio response")
            audio = res.read(10_000_001)
            if not audio or len(audio)>10_000_000:
                raise ValueError("Invalid audio size")
            cost = res.headers.get("character-cost")
    except HTTPError as exc:
        raise RuntimeError("ElevenLabs HTTP "+str(exc.code)+"; no automatic retry") from None
    temp = path.with_suffix(".tmp")
    temp.write_bytes(audio)
    temp.replace(path)
    return {"path":str(path),"cached":False,"requested_characters":len(text),
            "reported_character_cost":cost,"seconds":time.monotonic()-started}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--voice",required=True)
    p.add_argument("--out",type=Path,default=Path("outputs/eleven-pilot"))
    p.add_argument("--live",action="store_true")
    args=p.parse_args()
    if not args.live:
        print(json.dumps({"mode":"dry-run","models":MODELS,"characters_per_model":len(SAMPLE),
                          "total_requested_characters":len(SAMPLE)*len(MODELS)},ensure_ascii=False))
        return
    key=os.getenv("ELEVENLABS_API_KEY")
    if not key:
        p.error("Set ELEVENLABS_API_KEY locally")
    for model in MODELS:
        print(json.dumps({"model":model,**synthesize(SAMPLE,model,args.voice,key,args.out,allow_live=True)},ensure_ascii=False))

if __name__ == "__main__":
    main()
