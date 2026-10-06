import type { LinkStatus, RenderMsg } from "@shared/wire";

/**
 * The links a session keeps at hand: the pull requests and issues it mentions, which carry
 * live status, and the local servers it starts, which you reopen. Newest mention first.
 * Fenced code is skipped (commands quote URLs they do not point you at), and tool output
 * is not read (a fetched page or lockfile is not a reference anyone chose).
 */

export type LinkKind = "pull_request" | "issue" | "local";

export interface SessionLink {
  url: string;
  kind: LinkKind;
  /** The card's first line: the forge's title once known, else read off the URL. */
  title: string;
  /** The card's second line: where the link points. */
  detail: string;
  status?: LinkStatus;
}

/** The pile shows this many at most; older mentions stay in the transcript. */
export const MAX_LINKS = 6;

// A URL runs over letters of any script and the ASCII punctuation URLs use; prose punctuation
// glued to it, such as an em dash or a full-width comma, ends it.
const BARE = /https?:\/\/(?:[^\s<>()[\]"'`\p{P}]|[-._~:/?#@!$&*+,;=%])+/gu;
const TRAILING = /[.,;:!?*_]+$/;

/** Text outside fenced code blocks; an unterminated fence runs to the end. */
function prose(text: string): string {
  return text.split("```").filter((_, i) => i % 2 === 0).join("\n");
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
const isLocal = (u: URL) => LOCAL_HOSTS.has(u.hostname) || u.hostname.endsWith(".local") || u.hostname.endsWith(".localhost");

/** What a URL says about itself, before any live status; undefined for a link the pile does not keep. */
export function describeLink(url: string): Omit<SessionLink, "status"> | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)\/?$/);
    if (!m) return undefined;
    const [, repo, section, number] = m;
    const kind = section === "pull" ? "pull_request" : "issue";
    return { url, kind, title: `${repo} #${number}`, detail: kind === "pull_request" ? "Pull request" : "Issue" };
  }
  if (isLocal(u)) {
    const where = u.pathname === "/" && !u.search ? "" : `${u.pathname}${u.search}`;
    return { url, kind: "local", title: u.host, detail: where || "Local server" };
  }
  return undefined;
}

/** The links a transcript keeps at hand, newest mention first, without duplicates. */
export function sessionLinks(messages: ReadonlyArray<RenderMsg>): SessionLink[] {
  const found = new Map<string, SessionLink>();
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    for (const [raw] of prose(m.text).matchAll(BARE)) {
      const url = raw.replace(TRAILING, "");
      const link = describeLink(url);
      if (!link) continue;
      const key = url.replace(/\/$/, "");
      found.delete(key); // A repeat mention moves the link to the front.
      found.set(key, link);
    }
  }
  return [...found.values()].reverse().slice(0, MAX_LINKS);
}

/** Links worth asking the server about. */
export const statusUrls = (links: ReadonlyArray<SessionLink>): string[] =>
  links.filter((l) => l.kind !== "local").map((l) => l.url);

/** Cards with live status read what the forge says; the URL's own words remain the fallback. */
export function withStatus(links: ReadonlyArray<SessionLink>, statuses: ReadonlyArray<LinkStatus>): SessionLink[] {
  const byUrl = new Map(statuses.map((s) => [s.url.replace(/\/$/, ""), s]));
  return links.map((link) => {
    const status = byUrl.get(link.url.replace(/\/$/, ""));
    if (!status) return link;
    return { ...link, status, title: status.title || link.title, detail: `${status.repo} #${status.number}` };
  });
}
