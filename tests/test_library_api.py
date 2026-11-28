from fastapi.testclient import TestClient
from knowledge_hub.server import create_app
from knowledge_hub.transcript import parse_transcript

def test_library_flow(tmp_path):
    db = tmp_path / "library.db"
    client = TestClient(create_app(db))
    response = client.post("/api/items",json={"title":"Test","content":"Model 42"})
    assert response.status_code == 201
    ident = response.json()["id"]
    assert client.post(f"/api/items/{ident}/demo").json()["mode"] == "demo"
    assert "gerçek çeviri değil" in client.get(f"/api/items/{ident}").json()["translated"]
    assert client.patch(f"/api/items/{ident}/progress",json={"position":.4}).status_code == 200
    other = TestClient(create_app(db))
    assert other.get(f"/api/items/{ident}").json()["position"] == .4
    assert other.delete(f"/api/items/{ident}").status_code == 204
    assert other.get(f"/api/items/{ident}").status_code == 404

def test_validation(tmp_path):
    client = TestClient(create_app(tmp_path / "db"))
    assert client.post("/api/items",json={"title":"x","content":" "}).status_code == 422
    assert client.get("/").status_code == 200

def test_transcript():
    assert parse_transcript("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello") == "Hello"
