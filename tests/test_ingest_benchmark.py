import pytest
from knowledge_hub.ingest import extract
from knowledge_hub.benchmark import evaluate

def test_extract():
    assert extract("<nav>menu</nav><main><h1>Title</h1><script>bad</script><p>Hello <b>world</b>.</p></main>") == "Title\n\nHello world."

def test_missing_article():
    with pytest.raises(ValueError):
        extract("<body>hello</body>")

def test_benchmark():
    rows = evaluate([{"id":"x","source":"Value 12","reference":"Değer 12"}], lambda s: "Değer 13")
    assert rows[0]["numeric_warning"]
    assert rows[0]["seconds"] >= 0
