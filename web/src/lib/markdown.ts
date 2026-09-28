/** Small, HTML-safe markdown renderer (ported from pi-remote-control). No raw HTML passthrough. */
function escH(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  const ph: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c: string) => {
    ph.push(`<code>${escH(c)}</code>`);
    return `\u0000${ph.length - 1}`;
  });
  s = escH(s);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]\n]*)\]\((https?:\/\/[^)\n]*)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  s = s.replace(/\u0000(\d+)/g, (_, i: string) => ph[Number(i)]);
  return s;
}

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = src.split("\n");
  let out = "";
  let para: string[] = [];
  let fence = false;
  let fl: string[] = [];
  let inList = false;
  let ltag = "";
  let tbl: string[] = [];
  const fp = () => {
    if (!para.length) return;
    out += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  const fL = () => {
    if (!inList) return;
    out += `</${ltag}>`;
    inList = false;
    ltag = "";
  };
  const fT = () => {
    if (!tbl.length) return;
    if (tbl.length < 2 || !/^[|\s:-]+$/.test(tbl[1])) {
      tbl.forEach((r) => para.push(r));
      tbl = [];
      return;
    }
    const cells = (r: string) => r.replace(/^\|/, "").replace(/\|$/, "").split("|");
    out += "<table><thead><tr>";
    cells(tbl[0]).forEach((c) => {
      out += `<th>${inline(c.trim())}</th>`;
    });
    out += "</tr></thead><tbody>";
    for (let j = 2; j < tbl.length; j++) {
      out += "<tr>";
      cells(tbl[j]).forEach((c) => {
        out += `<td>${inline(c.trim())}</td>`;
      });
      out += "</tr>";
    }
    out += "</tbody></table>";
    tbl = [];
  };
  for (const ln of lines) {
    if (ln.startsWith("```")) {
      if (!fence) {
        fp();
        fL();
        fence = true;
        fl = [];
      } else {
        out += `<pre><code>${escH(fl.join("\n"))}</code></pre>`;
        fence = false;
      }
      continue;
    }
    if (fence) {
      fl.push(ln);
      continue;
    }
    if (ln.startsWith("|")) {
      fp();
      fL();
      tbl.push(ln);
      continue;
    }
    if (tbl.length) fT();
    const hm = ln.match(/^(#{1,6}) (.*)/);
    if (hm) {
      fp();
      fL();
      out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`;
      continue;
    }
    if (/^---+\s*$/.test(ln)) {
      fp();
      fL();
      out += "<hr>";
      continue;
    }
    if (ln.startsWith("> ")) {
      fp();
      fL();
      out += `<blockquote>${inline(ln.slice(2))}</blockquote>`;
      continue;
    }
    const um = ln.match(/^[-*] (.*)/);
    if (um) {
      fp();
      if (ltag !== "ul") {
        fL();
        out += "<ul>";
        inList = true;
        ltag = "ul";
      }
      out += `<li>${inline(um[1])}</li>`;
      continue;
    }
    const om = ln.match(/^\d+\. (.*)/);
    if (om) {
      fp();
      if (ltag !== "ol") {
        fL();
        out += "<ol>";
        inList = true;
        ltag = "ol";
      }
      out += `<li>${inline(om[1])}</li>`;
      continue;
    }
    if (!ln.trim()) {
      fp();
      fL();
      continue;
    }
    fL();
    para.push(ln);
  }
  fp();
  fL();
  fT();
  if (fence) out += `<pre><code>${escH(fl.join("\n"))}</code></pre>`;
  return out;
}
