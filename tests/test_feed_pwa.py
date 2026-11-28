from fastapi.testclient import TestClient
from knowledge_hub.server import create_app
from knowledge_hub.feed import parse_feed

def test_feed(tmp_path):
    c=TestClient(create_app(tmp_path/"db"))
    xml='<rss><channel><item><title>Research</title><link>https://example.org/a</link><enclosure url="https://example.org/a.mp3"/></item></channel></rss>'
    assert c.post("/api/feed/parse",json={"xml":xml}).json()[0]["title"]=="Research"
    assert c.post("/api/feed/parse",json={"xml":"<bad"}).status_code==422

def test_pwa(tmp_path):
    c=TestClient(create_app(tmp_path/"db"))
    assert c.get("/manifest.webmanifest").json()["display"]=="standalone"
    assert c.get("/sw.js").status_code==200
    assert c.get("/icon.svg").status_code==200
