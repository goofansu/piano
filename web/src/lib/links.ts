import type { LinkStatus, RenderMsg } from "@shared/wire";

/**
 * The links a session has set aside: every URL you or Pi wrote in prose, newest mention
 * first. Fenced code is skipped (commands quote URLs they do not point you at), and tool
 * output is not read (a fetched page or lockfile is not a reference anyone chose).
 */

export type LinkKind = "pull_request" | "issue" | "commit" | "compare" | "run" | "code" | "repo" | "local" | "web";

export interface SessionLink {
  url: string;
  kind: LinkKind;
  /** The card's first line: a markdown link's text when the author gave one, else read off the URL. */
  title: string;
  /** The card's second line: where the link points. */
  detail: string;
  /** Host without a leading "www.", for the monogram. */
  host: string;
  /** The message that mentioned the link most recently. */
  messageId: string;
  status?: LinkStatus;
}

/** The pile shows this many at most; older mentions stay in the transcript. */
export const MAX_LINKS = 8;

const MD_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE = /https?:\/\/[^\s<>()[\]"'`]+/g;
const TRAILING = /[.,;:!?*_]+$/;

/** Text outside fenced code blocks; an unterminated fence runs to the end. */
function prose(text: string): string {
  return text.split("```").filter((_, i) => i % 2 === 0).join("\n");
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
const isLocal = (u: URL) => LOCAL_HOSTS.has(u.hostname) || u.hostname.endsWith(".local") || u.hostname.endsWith(".localhost");
const looksLikeUrl = (s: string) => /^(https?:\/\/|www\.)/i.test(s.trim());
const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? "";

/** "set-aside_board.html" → "Set aside board". Slugs that are mostly digits or hashes stay unused. */
function humanize(segment: string): string | undefined {
  let s = decodeURIComponent(segment).replace(/\.(html?|md|php|aspx?)$/i, "");
  if (/^[0-9a-f]{8,}$/i.test(s) || !/[a-z]{3}/i.test(s) || s.length > 60) return undefined;
  s = s.replace(/[-_+]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function github(u: URL): Pick<SessionLink, "kind" | "title" | "detail"> | undefined {
  const [owner, repo, section, ...rest] = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!owner || !repo) return undefined;
  const slug = `${owner}/${repo}`;
  const number = rest[0] && /^\d+$/.test(rest[0]) ? rest[0] : undefined;
  if (section === "pull" && number) return { kind: "pull_request", title: `${slug} #${number}`, detail: "Pull request" };
  if (section === "issues" && number) return { kind: "issue", title: `${slug} #${number}`, detail: "Issue" };
  if (section === "commit" && rest[0]) return { kind: "commit", title: `${slug}@${rest[0].slice(0, 7)}`, detail: "Commit" };
  if (section === "compare" && rest[0]) return { kind: "compare", title: rest.join("/"), detail: `${slug} · compare` };
  if (section === "actions") return { kind: "run", title: rest[0] === "runs" && rest[1] ? `Run #${rest[1]}` : "Actions", detail: slug };
  if ((section === "blob" || section === "tree") && rest.length > 1) {
    const [ref, ...path] = rest;
    const lines = u.hash.match(/^#L(\d+)(?:-L(\d+))?$/);
    const file = basename(path.join("/"));
    return { kind: "code", title: lines ? `${file} ${lines[2] ? `L${lines[1]}–${lines[2]}` : `L${lines[1]}`}` : file, detail: `${slug} · ${ref}` };
  }
  return { kind: "repo", title: slug, detail: section ? section.charAt(0).toUpperCase() + section.slice(1) : "Repository" };
}

/** What a URL says about itself, before any live status. */
export function describeLink(url: string, label?: string): Omit<SessionLink, "messageId"> | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.host.replace(/^www\./, "");
  if (u.hostname === "github.com") {
    const gh = github(u);
    if (gh) return { url, host, ...gh };
  }
  if (isLocal(u)) {
    const where = u.pathname === "/" && !u.search ? "" : `${u.pathname}${u.search}`;
    return { url, host, kind: "local", title: u.host, detail: where || "Local server" };
  }
  const given = label && !looksLikeUrl(label) ? label.trim() : "";
  const title = given || humanize(basename(u.pathname)) || host;
  return { url, host, kind: "web", title, detail: title === host ? (u.pathname === "/" ? "Website" : u.pathname) : host };
}

/** URLs in a transcript with the text they were linked from, newest mention first, without duplicates. */
export function sessionLinks(messages: ReadonlyArray<RenderMsg>): SessionLink[] {
  const found = new Map<string, SessionLink>();
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = prose(m.text);
    const labels = new Map<string, string>();
    for (const [, label, url] of text.matchAll(MD_LINK)) labels.set(url.replace(TRAILING, ""), label);
    for (const [raw] of text.matchAll(BARE)) {
      const url = raw.replace(TRAILING, "");
      const key = url.replace(/\/$/, "");
      const link = describeLink(url, labels.get(url));
      if (!link) continue;
      found.delete(key); // A repeat mention moves the link to the front.
      found.set(key, { ...link, messageId: m.id });
    }
  }
  return [...found.values()].reverse().slice(0, MAX_LINKS);
}

/** Links worth asking the server about. */
export const statusUrls = (links: ReadonlyArray<SessionLink>): string[] =>
  links.filter((l) => l.kind === "pull_request" || l.kind === "issue").map((l) => l.url);

/** Cards with live status read what the forge says; the URL's own words remain the fallback. */
export function withStatus(links: ReadonlyArray<SessionLink>, statuses: ReadonlyArray<LinkStatus>): SessionLink[] {
  const byUrl = new Map(statuses.map((s) => [s.url.replace(/\/$/, ""), s]));
  return links.map((link) => {
    const status = byUrl.get(link.url.replace(/\/$/, ""));
    if (!status) return link;
    return { ...link, status, title: status.title || link.title, detail: `${status.repo} #${status.number}` };
  });
}
