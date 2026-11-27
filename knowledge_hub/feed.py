"""Parse saved RSS/Atom feeds; no background network activity."""
from defusedxml import ElementTree as ET

def parse_feed(xml):
    if len(xml)>2_000_000: raise ValueError("Feed too large")
    root=ET.fromstring(xml)
    entries=[]
    for e in root.findall(".//item")+root.findall(".//{*}entry"):
        title=e.findtext("{*}title") or ""
        link=e.find("{*}link")
        url=(link.get("href") or link.text or "") if link is not None else ""
        enclosure=e.find("{*}enclosure")
        entries.append({"title":title,"url":url,"audio":enclosure.get("url","") if enclosure is not None else ""})
    return entries[:500]
