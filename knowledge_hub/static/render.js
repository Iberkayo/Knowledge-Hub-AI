// Safe DOM-based Markdown, code block, math, table, and link renderer (zero innerHTML on untrusted text).

function appendInline(parent, text) {
  // Parse inline links [label](https://...), inline code `...`, bold **...**, and inline math $...$
  const tokenRe = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|\$[^$\n]+\$)/g;
  let last = 0;
  let match;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) {
      parent.append(document.createTextNode(text.slice(last, match.index)));
    }
    const tok = match[0];
    if (tok.startsWith("[")) {
      const m = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (m) {
        const a = document.createElement("a");
        a.href = m[2];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = m[1];
        a.style.color = "var(--accent)";
        parent.append(a);
      } else {
        parent.append(document.createTextNode(tok));
      }
    } else if (tok.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = tok.slice(1, -1);
      parent.append(code);
    } else if (tok.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = tok.slice(2, -2);
      parent.append(strong);
    } else if (tok.startsWith("$")) {
      const span = document.createElement("span");
      span.className = "math-inline";
      span.style.fontFamily = "var(--mono-font)";
      span.textContent = tok;
      parent.append(span);
    }
    last = tokenRe.lastIndex;
  }
  if (last < text.length) {
    parent.append(document.createTextNode(text.slice(last)));
  }
}

export function renderRichText(container, text) {
  container.replaceChildren();
  if (!text) return;

  // Split out fenced code blocks and $$ math blocks first
  const segments = text.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g);
  for (const part of segments) {
    if (!part.trim()) continue;
    const trimmed = part.trim();

    if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
      const firstNl = trimmed.indexOf("\n");
      const lang = firstNl > 3 ? trimmed.slice(3, firstNl).trim() : "kod";
      const codeBody = firstNl > -1 ? trimmed.slice(firstNl + 1, -3) : trimmed.slice(3, -3);
      const wrap = document.createElement("div");
      wrap.className = "code-block-wrap";
      const head = document.createElement("div");
      head.className = "code-block-head";
      const langLabel = document.createElement("span");
      langLabel.textContent = lang || "kod";
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-sm";
      copyBtn.textContent = "Kopyala";
      copyBtn.onclick = () => {
        navigator.clipboard?.writeText(codeBody).catch(() => {});
        copyBtn.textContent = "Kopyalandı";
        setTimeout(() => { copyBtn.textContent = "Kopyala"; }, 1400);
      };
      head.append(langLabel, copyBtn);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeBody.replace(/^\n+|\n+$/g, "");
      pre.append(code);
      wrap.append(head, pre);
      container.append(wrap);
      continue;
    }

    if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
      const div = document.createElement("div");
      div.className = "math-block";
      div.textContent = trimmed;
      container.append(div);
      continue;
    }

    const blocks = trimmed.split(/\n\s*\n/);
    for (const blk of blocks) {
      const b = blk.trim();
      if (!b) continue;

      // Markdown table
      if (b.includes("\n") && b.split("\n").every((ln) => ln.trim().startsWith("|"))) {
        const rows = b.split("\n").map((ln) =>
          ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
        );
        const table = document.createElement("table");
        rows.forEach((cells, idx) => {
          if (idx === 1 && cells.every((c) => /^[-:]+$/.test(c))) return;
          const tr = document.createElement("tr");
          for (const cell of cells) {
            const el = document.createElement(idx === 0 ? "th" : "td");
            appendInline(el, cell);
            tr.append(el);
          }
          table.append(tr);
        });
        container.append(table);
        continue;
      }

      // Headings
      const hMatch = b.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        const lvl = Math.min(4, hMatch[1].length);
        const h = document.createElement(`h${lvl}`);
        appendInline(h, hMatch[2]);
        container.append(h);
        continue;
      }

      // Blockquote
      if (b.startsWith(">")) {
        const bq = document.createElement("blockquote");
        appendInline(bq, b.replace(/^>\s?/gm, ""));
        container.append(bq);
        continue;
      }

      // List block
      const lines = b.split("\n");
      if (lines.every((ln) => /^(-|\*|\d+\.)\s+/.test(ln.trim()))) {
        const ordered = /^\d+\.\s+/.test(lines[0].trim());
        const list = document.createElement(ordered ? "ol" : "ul");
        for (const ln of lines) {
          const li = document.createElement("li");
          appendInline(li, ln.trim().replace(/^(-|\*|\d+\.)\s+/, ""));
          list.append(li);
        }
        container.append(list);
        continue;
      }

      const p = document.createElement("p");
      appendInline(p, b);
      container.append(p);
    }
  }
}
