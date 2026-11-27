"""Local API. Run on loopback only; no authentication in this prototype."""
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Literal
from knowledge_hub.library import Library
from knowledge_hub.ingest import extract
from knowledge_hub.transcript import parse_transcript
from knowledge_hub.providers import DemoTranslator
from knowledge_hub.core import translate

class ImportRequest(BaseModel):
    title: str = Field(min_length=1,max_length=300)
    source: str = Field(default="",max_length=2000)
    kind: Literal["article","podcast","document"] = "article"
    format: Literal["text","html","transcript"] = "text"
    content: str = Field(min_length=1,max_length=200000)

class Metadata(BaseModel):
    favorite: bool = False
    notes: str = Field(default="",max_length=20000)
    category: str = Field(default="",max_length=100)

class Progress(BaseModel):
    position: float = Field(ge=0,le=1)

def create_app(db_path=None):
    app = FastAPI(title="Knowledge Hub AI", version="0.2.0")
    lib = Library(db_path or os.getenv("KH_DB", "outputs/library.sqlite3"))
    def lookup(identifier):
        try:
            return lib.get(identifier)
        except KeyError:
            raise HTTPException(404,"Content not found")
    @app.get("/")
    def home():
        return FileResponse(Path(__file__).parent / "static" / "index.html")
    @app.get("/api/items")
    def items():
        return lib.list()
    @app.post("/api/items",status_code=201)
    def add(req: ImportRequest):
        try:
            original = extract(req.content) if req.format=="html" else parse_transcript(req.content) if req.format=="transcript" else req.content
            return lib.add(req.title,req.source,req.kind,original)
        except ValueError as exc:
            raise HTTPException(422,str(exc))
    @app.get("/api/items/{identifier}")
    def get(identifier: str):
        return lookup(identifier)
    @app.post("/api/items/{identifier}/demo")
    def process(identifier: str):
        item = lookup(identifier)
        parts = translate(item["original"],DemoTranslator().translate)
        return lib.complete(identifier,"\n\n".join(s.translated for s in parts),"demo")
    @app.patch("/api/items/{identifier}/progress")
    def progress(identifier: str, req: Progress):
        lookup(identifier)
        return lib.progress(identifier,req.position)
    @app.delete("/api/items/{identifier}",status_code=204)
    def delete(identifier: str):
        lookup(identifier)
        lib.delete(identifier)
    @app.patch("/api/items/{identifier}/metadata")
    def metadata(identifier: str, req: Metadata):
        lookup(identifier)
        return lib.metadata(identifier, req.favorite, req.notes, req.category)
    @app.get("/api/items/{identifier}/export")
    def export(identifier: str):
        from fastapi.responses import PlainTextResponse
        item = lookup(identifier)
        return PlainTextResponse(item["title"]+"\n\n"+item["original"]+"\n\n"+(item["translated"] or ""), headers={"Content-Disposition":"attachment; filename=knowledge-hub.txt"})
    return app
