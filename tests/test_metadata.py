from fastapi.testclient import TestClient
from knowledge_hub.server import create_app

def test_metadata_and_export(tmp_path):
    c=TestClient(create_app(tmp_path/"library.db"))
    i=c.post("/api/items",json={"title":"Research","content":"Original"}).json()["id"]
    assert c.patch(f"/api/items/{i}/metadata",json={"favorite":True,"notes":"note","category":"ML"}).status_code==200
    assert c.get("/api/items").json()[0]["favorite"]==1
    assert c.get(f"/api/items/{i}").json()["notes"]=="note"
    assert "Original" in c.get(f"/api/items/{i}/export").text
