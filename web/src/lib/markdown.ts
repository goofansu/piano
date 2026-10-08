/** Small, HTML-safe markdown renderer (ported from pi-remote-control). No raw HTML passthrough. */
function escH(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Custom inline anchor: shadcn has no HTML-string Markdown link renderer.
// GitHub's mark is decorative; the link text and native URL tooltip carry its meaning.
const githubIcon = '<svg class="github-link-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';

function githubLabel(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (url.hostname !== "github.com" || url.username || url.password || url.port || !/^https?:$/.test(url.protocol)) return;
    const issue = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/([1-9]\d*)\/?$/);
    if (issue) return `${issue[2]}#${issue[3]}`;
    const repo = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
    return repo ? `${repo[1]}/${repo[2]}` : undefined;
  } catch {
    return;
  }
}

function webLink(href: string, label: string): string {
  const compact = githubLabel(href);
  const text = inline(compact && label === href ? compact : label, false);
  return `<a href="${escH(href)}" target="_blank" rel="noreferrer"${compact ? ` class="github-link" title="${escH(href)}"` : ""}>${compact ? githubIcon : ""}${text}</a>`;
}

function inline(s: string, links = true): string {
  const ph: string[] = [];
  s = s.replaceAll("\u0000", "\uFFFD");
  if (!links) s = s.replace(/`([^`\n]+)`/g, (_, c: string) => {
    ph.push(`<code>${escH(c)}</code>`);
    return `\u0000${ph.length - 1}`;
  });
  if (links) {
    // Protect whole links before formatting prose, so URL punctuation never becomes markup.
    s = s.replace(/`([^`\n]+)`|\[([^\]\n]*)\]\((https?:\/\/[^)\n]*)\)|<(https?:\/\/[^<>\s]+)>|https?:\/\/[^\s<>`]+/g, (match, code: string | undefined, label: string | undefined, href: string | undefined, autolink: string | undefined) => {
      let html: string;
      if (code !== undefined) html = `<code>${escH(code)}</code>`;
      else if (href) html = webLink(href, label ?? "");
      else {
        const url = autolink ?? match.replace(/[.,!?;:)'"\]]+$/, "");
        html = githubLabel(url) ? webLink(url, url) + (autolink ? "" : escH(match.slice(url.length))) : escH(match);
      }
      ph.push(html);
      return `\u0000${ph.length - 1}`;
    });
  }
  s = escH(s);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL marks placeholders that source text cannot contain.
  s = s.replace(/\u0000(\d+)/g, (_, i: string) => ph[Number(i)]);
  return s;
}

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = src.split("\n");
  let out = "";
  let para: string[] = [];
  let fence = false;
  let language = "";
  let fl: string[] = [];
  let inList = false;
  let ltag = "";
  let tbl: string[] = [];
  const fp = () => {
    if (!para.length) return;
    out += `<p>${para.map(value => inline(value)).join("<br>")}</p>`;
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
      para.push(...tbl);
      tbl = [];
      return;
    }
    const cells = (r: string) => r.replace(/^\|/, "").replace(/\|$/, "").split("|");
    out += '<div class="markdown-table-scroll" role="region" aria-label="Table" tabindex="0"><table><thead><tr>';
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
    out += "</tbody></table></div>";
    tbl = [];
  };
  for (const ln of lines) {
    if (ln.startsWith("```")) {
      if (!fence) {
        if (tbl.length) fT();
        fp();
        fL();
        fence = true;
        language = ln.slice(3).trim().toLowerCase();
        fl = [];
      } else {
        out += `<pre${language === "mermaid" ? ' data-mermaid=""' : ""}><code>${escH(fl.join("\n"))}</code></pre>`;
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
