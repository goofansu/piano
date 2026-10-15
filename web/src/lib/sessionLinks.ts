/**
 * The web links a session's conversation mentions, for the composer's Links popover and the
 * palette's Links group. Only what the user and Pi wrote counts: tool output is full of registry,
 * lockfile and error-text URLs nobody means to revisit.
 */
import type { RenderMsg } from "../../../shared/wire.ts";
import { githubLabel } from "./markdown.ts";

export interface SessionLink {
  url: string;
  /** The markdown link text, else "repo#N" for a GitHub issue or pull request; a bare URL has none. */
  label?: string;
  /** The message that mentions it last. */
  messageId: string;
}

/** Fenced blocks (an open one runs to the end), then indented and inline code: never links. */
const FENCE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const CODE = /^(?: {4}|\t).*$|`[^`\n]+`/gm;
/** A markdown link, an autolink, or a bare URL; the same shapes `renderMarkdown` links. */
const LINK =
  /\[([^\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)|<(https?:\/\/[^<>\s]+)>|https?:\/\/[^\s<>`]+/g;
const WEB = /^https?:\/\//;
const TRAILING = /[.,!?;:)'"\]]+$/;

/** The URL as a list shows it: no scheme, no "www.", no trailing slash, so what differs is in view. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, "");
    return `${host}${parsed.pathname.replace(/\/$/, "")}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/**
 * Every web link in the user's and Pi's messages in conversation order, each URL once at its
 * latest mention and labelled by the markdown text it was last written with, if any. Reverse the
 * list for newest first.
 */
export function sessionLinks(messages: ReadonlyArray<RenderMsg>): SessionLink[] {
  const seen = new Set<string>();
  // Message groups, newest first, so a URL is kept where it was mentioned last.
  const groups: SessionLink[][] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!message.text.includes("http")) continue;
    const found: SessionLink[] = [];
    for (const match of message.text.replace(FENCE, " ").replace(CODE, " ").matchAll(LINK)) {
      const [whole, text, href, autolink] = match;
      let url: string;
      let label: string | undefined;
      if (href !== undefined) {
        if (!WEB.test(href)) continue;
        url = href;
        label = text?.trim() && text.trim() !== href ? text.trim() : undefined;
      } else url = autolink ?? whole.replace(TRAILING, "");
      label ??= githubLabel(url);
      found.push({ url, ...(label ? { label } : {}), messageId: message.id });
    }
    const fresh = found.filter((link) => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    });
    if (fresh.length) groups.push(fresh);
  }
  // Oldest message first; within a message, the order the links were written in.
  return groups.reverse().flat();
}

/** Open a session link the way the transcript's anchors do: a new tab that cannot reach this one. */
export function openLink(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
