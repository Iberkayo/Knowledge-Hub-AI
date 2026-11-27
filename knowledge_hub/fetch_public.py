"""Explicit HTTPS GET only. Resolve once and pin public IP, verify hostname TLS.
No redirects, cookies, authentication, proxy, background requests or compression."""
import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit

def resolve_public(url):
    if any(ord(c)<33 or ord(c)==127 for c in url):
        raise ValueError("Invalid URL characters")
    p=urlsplit(url)
    if p.scheme!="https" or not p.hostname or p.username or p.password or p.port not in (None,443) or p.fragment:
        raise ValueError("Only public HTTPS on port 443 is supported")
    hostname=p.hostname.encode("idna").decode("ascii")
    addresses=socket.getaddrinfo(hostname,443,type=socket.SOCK_STREAM)
    ips=[row[4][0] for row in addresses]
    if not ips or any(not ipaddress.ip_address(ip).is_global or ipaddress.ip_address(ip).is_multicast for ip in ips):
        raise ValueError("Nonpublic destination")
    return hostname,ips[0],(p.path or "/")+("?" + p.query if p.query else "")

class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self,host,ip):
        super().__init__(host,443,timeout=12,context=ssl.create_default_context())
        self.ip=ip
    def connect(self):
        raw=socket.create_connection((self.ip,443),self.timeout)
        try:
            self.sock=self._context.wrap_socket(raw,server_hostname=self.host)
        except Exception:
            raw.close()
            raise

def fetch_public(url,expected):
    if expected not in ("html","xml"): raise ValueError("Invalid expected type")
    hostname,ip,path=resolve_public(url)
    conn=PinnedHTTPS(hostname,ip)
    try:
        conn.request("GET",path,headers={"User-Agent":"KnowledgeHubAI/0.4 personal-reader","Accept-Encoding":"identity","Accept":"text/html" if expected=="html" else "application/rss+xml, application/atom+xml, text/xml, application/xml"})
        res=conn.getresponse()
        if res.status!=200: raise ValueError("Only HTTP 200 accepted; redirects disabled")
        if res.getheader("Content-Encoding","identity").lower()!="identity": raise ValueError("Compressed response not supported")
        typ=res.getheader("Content-Type","").split(";")[0].lower().strip()
        allowed={"text/html","application/xhtml+xml"} if expected=="html" else {"application/rss+xml","application/atom+xml","application/xml","text/xml"}
        if typ not in allowed: raise ValueError("Unexpected MIME type")
        body=res.read(2_000_001)
        if len(body)>2_000_000: raise ValueError("Response exceeds 2 MB")
        return body.decode("utf-8-sig")
    finally:
        conn.close()
