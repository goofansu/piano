/** Small, HTML-safe markdown renderer (ported from pi-remote-control). No raw HTML passthrough. */
function escH(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Custom inline anchor: shadcn has no HTML-string Markdown link renderer.
// Brand marks are decorative; the link text and native URL tooltip carry their meaning.
const linearIcon =
  '<svg class="brand-link-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><use href="/mcp-logos.svg#linear" /></svg>';
const githubIcon =
  '<svg class="brand-link-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';

/** "owner/repo" or "repo#N" for a github.com repository, issue or pull request URL. */
export function githubLabel(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port ||
      !/^https?:$/.test(url.protocol)
    )
      return;
    const issue = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/([1-9]\d*)\/?$/);
    if (issue) return `${issue[2]}#${issue[3]}`;
    const repo = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
    return repo ? `${repo[1]}/${repo[2]}` : undefined;
  } catch {
    return;
  }
}

function isLinearLink(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.hostname === "linear.app" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^https?:$/.test(url.protocol)
    );
  } catch {
    return false;
  }
}

type LinkDecoration = { icon: string; label: string };

/** Recognized providers share rendering and autolinking, but keep their own URL rules. */
function resolveLinkDecoration(href: string): LinkDecoration | undefined {
  const label = githubLabel(href);
  if (label) return { icon: githubIcon, label };
  if (isLinearLink(href)) return { icon: linearIcon, label: href };
  return undefined;
}

function webLink(
  href: string,
  label: string,
  budget: Budget,
  decoration = resolveLinkDecoration(href),
): string {
  const text = renderInline(decoration && label === href ? decoration.label : label, budget, false);
  return `<a href="${escH(href)}" target="_blank" rel="noreferrer"${decoration ? ` class="brand-link" title="${escH(href)}"` : ""}>${decoration?.icon ?? ""}${text}</a>`;
}

/** A Markdown destination is either a web URL or a local path, never an executable scheme.
 * Decode once here; the server resolves the resulting path within the session's workspace. */
function localFilePath(destination: string): string | undefined {
  let path = destination.trim();
  if (!path || path.startsWith("//") || path.startsWith("#") || path.startsWith("?")) return;
  try {
    if (/^file:/i.test(path)) {
      const url = new URL(path);
      if (url.hostname || url.username || url.password || url.port) return;
      path = url.pathname;
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(path)) return;
      path = path.split(/[?#]/, 1)[0];
    }
    path = decodeURIComponent(path);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject path control characters.
    return path && !/[\u0000-\u001f\u007f]/.test(path) ? path : undefined;
  } catch {
    return;
  }
}

/** All entry points share these limits. Fallback itself is only a linear escaped-source copy.
 * Bound parser input, recursive block depth, rescanning work and generated structure separately. */
const MAX_SOURCE = 256 * 1024;
const MAX_DEPTH = 32;
const EXHAUSTED = Symbol("Markdown budget exhausted");
type Budget = { work: number; nodes: number };
function budgetFor(src: string): Budget {
  if (src.length > MAX_SOURCE) throw EXHAUSTED;
  return { work: Math.min(4 * 1024 * 1024, 32 * (src.length + 1)), nodes: 10_000 };
}
function spend(budget: Budget, work: number, nodes = 0) {
  budget.work -= work;
  budget.nodes -= nodes;
  if (budget.work < 0 || budget.nodes < 0) throw EXHAUSTED;
}

// Sticky, not a searching expression: each attempt starts at the scanner's cursor. These
// alternatives have disjoint delimiters and linear work; bracket destinations are scanned below.
const INLINE = /`([^`\n]+)`|<(https?:\/\/[^<>\s]+)>|https?:\/\/[^\s<>`]+/y;
/** Punctuation that ends the sentence, not the URL; `*` is a bold or italic marker around it. */
const URL_END = /[.,!?;:)'"\]*]+$/;
const WEB = /^https?:\/\//;

type InlineToken =
  | { kind: "code"; code: string }
  | { kind: "image" | "link"; label: string; destination: string; source: string }
  | { kind: "autolink"; url: string }
  /** `rest` is the sentence punctuation or emphasis marker after the URL, which stays prose. */
  | { kind: "bare"; url: string; rest: string };

/** Inline runs are single lines. Cache the next closing bracket (including absence) and failed
 * destinations: thousands of opening brackets must not each search the same suffix. Destination
 * scans spend fuel per character, so overlapping malformed destinations cannot become quadratic. */
function* inlineTokens(text: string, budget: Budget) {
  let closing = -1;
  let failedThrough = -1;
  for (let at = 0; at < text.length; ) {
    spend(budget, 1);
    let token: InlineToken | undefined;
    let end = at + 1;
    const image = text[at] === "!" && text[at + 1] === "[";
    const opening = image ? at + 1 : at;
    if ((image || text[at] === "[") && opening > failedThrough) {
      if (closing < opening) {
        closing = text.indexOf("]", opening + 1);
        if (closing === -1) closing = text.length;
      }
      if (text[closing + 1] === "(") {
        let depth = 0;
        let cursor = closing + 2;
        for (; cursor < text.length; cursor++) {
          spend(budget, 1);
          const char = text[cursor];
          if (char === "(" && ++depth > 1) break;
          if (char === ")" && depth-- === 0) {
            end = cursor + 1;
            token = {
              kind: image ? "image" : "link",
              label: text.slice(opening + 1, closing),
              destination: text.slice(closing + 2, cursor),
              source: text.slice(at, end),
            };
            break;
          }
        }
      }
      if (!token) failedThrough = closing;
    }
    if (!token && (text[at] === "`" || text[at] === "<" || text[at] === "h")) {
      INLINE.lastIndex = at;
      const match = INLINE.exec(text);
      if (match) {
        const [whole, code, autolink] = match;
        end = INLINE.lastIndex;
        if (code !== undefined) token = { kind: "code", code };
        else if (autolink !== undefined) token = { kind: "autolink", url: autolink };
        else {
          const url = whole.replace(URL_END, "");
          token = { kind: "bare", url, rest: whole.slice(url.length) };
        }
      }
    }
    if (token) {
      spend(budget, end - at, 1);
      yield { token, at, end };
    }
    at = end;
  }
}

function renderToken(token: InlineToken, budget: Budget, images: boolean): string {
  switch (token.kind) {
    case "code":
      return `<code>${escH(token.code)}</code>`;
    case "image": {
      const path = images ? localFilePath(token.destination) : undefined;
      return path
        ? `<span data-local-image="${escH(path)}"><button type="button" class="local-file-link" data-local-file="${escH(path)}">${escH(token.label || "Image")}</button></span>`
        : escH(token.source);
    }
    case "link": {
      if (WEB.test(token.destination)) return webLink(token.destination, token.label, budget);
      const path = localFilePath(token.destination);
      // Custom inline action: shadcn has no HTML-string Markdown renderer.
      // Paths live in data, not hrefs, so even modified clicks cannot request filesystem URLs.
      return path
        ? `<button type="button" class="local-file-link" data-local-file="${escH(path)}">${renderInline(token.label, budget, false)}</button>`
        : escH(token.source);
    }
    case "autolink":
    case "bare": {
      const decoration = resolveLinkDecoration(token.url);
      if (decoration) return webLink(token.url, token.url, budget, decoration);
      return escH(token.kind === "bare" ? token.url : `<${token.url}>`);
    }
  }
}

function renderInline(s: string, budget: Budget, links = true, images = false): string {
  const ph: string[] = [];
  s = s.replaceAll("\u0000", "\uFFFD");
  if (!links)
    s = s.replace(/`([^`\n]+)`/g, (_, c: string) => {
      ph.push(`<code>${escH(c)}</code>`);
      return `\u0000${ph.length - 1}`;
    });
  // Protect whole links before formatting prose, so URL punctuation never becomes markup.
  if (links) {
    const parts: string[] = [];
    let previous = 0;
    for (const { token, at, end } of inlineTokens(s, budget)) {
      parts.push(s.slice(previous, at));
      ph.push(renderToken(token, budget, images));
      parts.push(`\u0000${ph.length - 1}${token.kind === "bare" ? token.rest : ""}`);
      previous = end;
    }
    parts.push(s.slice(previous));
    s = parts.join("");
  }
  s = escH(s);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL marks placeholders that source text cannot contain.
  s = s.replace(/\u0000(\d+)/g, (_, i: string) => ph[Number(i)]);
  return s;
}

export interface MarkdownLink {
  url: string;
  /** The markdown link text as written, possibly empty; autolinks and bare URLs have none. */
  label?: string;
  /**
   * How it was written. The transcript always links a `markdown` link; it links an `autolink`
   * (`<https://…>`) or a `bare` URL only when a provider decorates it (GitHub, Linear).
   */
  kind: "markdown" | "autolink" | "bare";
}

/**
 * Every web link in `src` in the order written, recognized exactly as `renderMarkdown` does: the
 * same blocks (a fenced block is code, nothing else is) and the same inline scanner (code
 * spans and images are not links; a bare URL sheds sentence punctuation).
 */
export function markdownLinks(src: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  try {
    const budget = budgetFor(src);
    walkMarkdown(
      src,
      (text) => {
        for (const { token } of inlineTokens(text, budget)) {
          if (token.kind === "link" && WEB.test(token.destination))
            links.push({ url: token.destination, label: token.label, kind: "markdown" });
          else if (token.kind === "autolink" || token.kind === "bare")
            links.push({ url: token.url, kind: token.kind });
        }
        return "";
      },
      budget,
    );
    return links;
  } catch {
    // No partial discovery from a document that could not be parsed safely.
    return [];
  }
}

export function renderMarkdown(src: string, images = false): string {
  try {
    const budget = budgetFor(src);
    return walkMarkdown(src, (text) => renderInline(text, budget, true, images), budget);
  } catch {
    return `<pre><code>${escH(src)}</code></pre>`;
  }
}

/** The block structure: `inline` renders each run of inline text; fenced code never reaches it. */
function walkMarkdown(
  src: string,
  inline: (text: string) => string,
  budget: Budget,
  depth = 0,
): string {
  if (depth > MAX_DEPTH) throw EXHAUSTED;
  spend(budget, src.length + 1);
  if (!src) return "";
  const lines = src.split("\n");
  spend(budget, 0, lines.length);
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
    out += `<p>${para.map((value) => inline(value)).join("<br>")}</p>`;
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
    const cells = (r: string) => {
      const values = r.replace(/^\|/, "").replace(/\|$/, "").split("|");
      spend(budget, 0, values.length);
      return values;
    };
    out +=
      '<div class="markdown-table-scroll" role="region" aria-label="Table" tabindex="0"><table><thead><tr>';
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
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
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
    if (/^>(?:\s|$)/.test(ln)) {
      fp();
      fL();
      const quote: string[] = [];
      do {
        quote.push(lines[i].replace(/^> ?/, ""));
        i++;
      } while (i < lines.length && /^>(?:\s|$)/.test(lines[i]));
      i--;
      out += `<blockquote>${walkMarkdown(quote.join("\n"), inline, budget, depth + 1)}</blockquote>`;
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
    const om = ln.match(/^(\d+)\. (.*)/);
    if (om) {
      fp();
      if (ltag !== "ol") {
        fL();
        out += om[1] === "1" ? "<ol>" : `<ol start="${om[1]}">`;
        inList = true;
        ltag = "ol";
      }
      out += `<li>${inline(om[2])}</li>`;
      continue;
    }
    if (!ln.trim()) {
      fp();
      // Blank-separated ordered items are one list; the next block closes it if needed.
      if (ltag !== "ol") fL();
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
