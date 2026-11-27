"""Local media ingestion CLI. No paid API. Optional model download on explicit request."""
import argparse
import json
from pathlib import Path
import zipfile
from html.parser import HTMLParser

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts=[]
        self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ("script","style"): self.skip+=1
        if tag in ("p","h1","h2","h3","li","br"): self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script","style"): self.skip=max(0,self.skip-1)
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def document(path):
    path=Path(path)
    if path.stat().st_size>50_000_000: raise ValueError("Document exceeds 50 MB")
    if path.suffix.lower()==".pdf":
        from pypdf import PdfReader
        reader=PdfReader(path)
        if len(reader.pages)>500: raise ValueError("PDF exceeds 500 pages")
        text="\n\n".join(p.extract_text() or "" for p in reader.pages)
    elif path.suffix.lower()==".epub":
        from defusedxml import ElementTree as ET
        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist())>100_000_000: raise ValueError("EPUB expansion too large")
            import posixpath
            root=ET.fromstring(z.read("META-INF/container.xml"))
            opf=root.find(".//{*}rootfile").attrib["full-path"]
            package=ET.fromstring(z.read(opf))
            manifest={e.attrib["id"]:e.attrib["href"] for e in package.findall(".//{*}manifest/{*}item")}
            parts=[]
            for e in package.findall(".//{*}spine/{*}itemref"):
                parser=TextParser()
                parser.feed(z.read(posixpath.normpath(posixpath.join(posixpath.dirname(opf),manifest[e.attrib["idref"]]))).decode("utf-8"))
                parts.append("".join(parser.parts))
            text="\n\n".join(parts)
    else: raise ValueError("Use PDF or EPUB")
    if not text.strip(): raise ValueError("No extractable text; scanned PDFs need OCR")
    return text

def transcribe(path, model="small", allow_download=False):
    from faster_whisper import WhisperModel
    engine=WhisperModel(model,device="cpu",compute_type="int8",local_files_only=not allow_download)
    segments,info=engine.transcribe(str(path),vad_filter=True)
    rows=[{"start":s.start,"end":s.end,"text":s.text.strip()} for s in segments]
    return {"language":info.language,"segments":rows,"text":"\n".join(s["text"] for s in rows)}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("kind",choices=["document","audio"])
    p.add_argument("source",type=Path)
    p.add_argument("output",type=Path)
    p.add_argument("--model",default="small")
    p.add_argument("--allow-download",action="store_true")
    a=p.parse_args()
    if a.output.exists(): p.error("Output already exists")
    if a.kind=="document": result=document(a.source)
    else:
        if a.source.stat().st_size>500_000_000: p.error("Audio exceeds 500 MB")
        result=json.dumps(transcribe(a.source,a.model,a.allow_download),ensure_ascii=False,indent=2)
    with a.output.open("x",encoding="utf-8") as f: f.write(result)

if __name__=="__main__": main()
