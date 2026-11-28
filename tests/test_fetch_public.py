import socket
import pytest
from knowledge_hub.fetch_public import resolve_public

@pytest.mark.parametrize("url",["http://example.com","https://user:pass@example.com","https://example.com:8443","https://example.com/a#x","https://example.com/\r\nX"])
def test_rejected_urls(url):
    with pytest.raises(ValueError): resolve_public(url)

def test_public_resolution(monkeypatch):
    monkeypatch.setattr(socket,"getaddrinfo",lambda *a,**k:[(2,1,6,"",("93.184.216.34",443))])
    assert resolve_public("https://example.com/article?q=1")==("example.com","93.184.216.34","/article?q=1")

@pytest.mark.parametrize("ip",["127.0.0.1","169.254.169.254","192.168.1.1","::1","224.0.0.1"])
def test_blocked_ip(monkeypatch,ip):
    monkeypatch.setattr(socket,"getaddrinfo",lambda *a,**k:[(2,1,6,"",(ip,443))])
    with pytest.raises(ValueError): resolve_public("https://example.com")
