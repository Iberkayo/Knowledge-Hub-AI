import pytest
from knowledge_hub.core import chunks, translate

def test_chunks():
    assert chunks("one two\n\nthree", 5) == ["one", "two", "three"]
    assert chunks("abcdefgh", 3) == ["abc", "def", "gh"]

def test_translation_alignment():
    result = translate("Value 42\n\nSecond", lambda s: "Değer 42" if "42" in s else "İkinci")
    assert len(result) == 2
    assert result[0].warnings == ()

def test_numeric_warning():
    assert translate("42", lambda s: "43")[0].warnings

def test_empty():
    with pytest.raises(ValueError):
        translate("hello", lambda s: "")
    with pytest.raises(ValueError):
        translate(" ", lambda s: s)
