"""Offline HTML extraction. Network fetching deliberately not enabled."""
import argparse
from pathlib import Path
from html.parser import HTMLParser

class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = 0
        self.skip = 0
        self.parts = []
        self.found = False

    def handle_starttag(self, tag, attrs):
        if tag in {"article", "main"}:
            self.active += 1
            self.found = True
        if tag in {"script", "style", "nav", "footer", "aside"}:
            self.skip += 1
        if self.active and not self.skip and tag in {"p", "h1", "h2", "h3", "li", "pre", "br"}:
            self.parts.append("\n\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "footer", "aside"}:
            self.skip = max(0, self.skip - 1)
        if tag in {"article", "main"}:
            self.active = max(0, self.active - 1)
        if self.active and not self.skip and tag in {"p", "h1", "h2", "h3", "li", "pre"}:
            self.parts.append("\n\n")

    def handle_data(self, data):
        if self.active and not self.skip:
            self.parts.append(data)

def extract(html: str) -> str:
    parser = ArticleParser()
    parser.feed(html)
    result = "\n\n".join(p.strip() for p in "".join(parser.parts).split("\n\n") if p.strip())
    if not parser.found or not result:
        raise ValueError("No nonempty article/main; provide a manually extracted text file")
    return result

def main():
    p = argparse.ArgumentParser()
    p.add_argument("html", type=Path)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    if args.html.stat().st_size > 5_000_000:
        p.error("HTML exceeds 5 MB")
    result = extract(args.html.read_text(encoding="utf-8"))
    with args.output.open("x", encoding="utf-8") as f:
        f.write(result)

if __name__ == "__main__":
    main()
