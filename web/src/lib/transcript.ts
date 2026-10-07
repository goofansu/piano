import type { RenderMsg } from "@shared/wire";

/** The transcript's scroll container; the jump list reads and moves it. */
export const TRANSCRIPT_SELECTOR = '[data-slot="transcript"]';

/** DOM id of a message's article, so a jump can find it without a shared ref. */
export const messageAnchorId = (id: string) => `msg-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export type JumpEntry =
  | { kind: "top"; id: string; label: string }
  | { kind: "bottom"; id: string; label: string }
  | { kind: "user" | "assistant"; id: string; label: string; messageId: string };

/** One line of a message, with markdown prefixes and extra whitespace folded away. */
export function messageLabel(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim().replace(/^[#>*\-`\s]+/, "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * What a reader can jump to: every prompt, and every reply that ended a turn, with
 * "Top" and "End of conversation" around them. Tool-only replies and intermediate
 * reasoning text are not destinations.
 */
export function jumpEntries(messages: ReadonlyArray<RenderMsg>): JumpEntry[] {
  const entries: JumpEntry[] = [{ kind: "top", id: "top", label: "Top of conversation" }];
  const turns = messages.filter(m => m.role === "user" || m.role === "assistant");
  turns.forEach((m, index) => {
    const label = messageLabel(m.skill ? `/skill:${m.skill.name} ${m.text}` : m.text) || (m.attachments?.length ? "Image" : "");
    if (!label) return;
    if (m.role === "user") entries.push({ kind: "user", id: m.id, label, messageId: m.id });
    else if (turns[index + 1]?.role !== "assistant") entries.push({ kind: "assistant", id: m.id, label, messageId: m.id });
  });
  entries.push({ kind: "bottom", id: "bottom", label: "End of conversation" });
  return entries;
}

/** The entry the reader is looking at: bottom when pinned there, else the message under the top edge. */
export function currentEntry(container: HTMLElement, entries: ReadonlyArray<JumpEntry>): string {
  if (container.scrollHeight - container.scrollTop - container.clientHeight < 80) return "bottom";
  if (container.scrollTop <= 40) return "top";
  const cutoff = container.getBoundingClientRect().top + 80;
  let current = "top";
  for (const entry of entries) {
    if (entry.kind !== "user" && entry.kind !== "assistant") continue;
    const el = document.getElementById(messageAnchorId(entry.messageId));
    if (el && el.getBoundingClientRect().top <= cutoff) current = entry.id;
  }
  return current;
}

const motion = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth") as ScrollBehavior;

/** Fired on the transcript container when a jump should leave the reader pinned to the bottom. */
export const STICK_EVENT = "piano:stick";

/** The scroll offset that puts an element just under the container's top edge. */
const offsetWithin = (container: HTMLElement, el: HTMLElement, margin: number) =>
  el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - margin;

/**
 * Scroll the transcript to an entry and flash the message it landed on. Only the transcript
 * moves: `scrollIntoView` would also scroll `main` on phones and leave the composer sitting high.
 */
export function jumpTo(entry: JumpEntry): boolean {
  const container = document.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
  if (!container) return false;
  if (entry.kind === "top" || entry.kind === "bottom") {
    if (entry.kind === "bottom") container.dispatchEvent(new CustomEvent(STICK_EVENT));
    container.scrollTo({ top: entry.kind === "top" ? 0 : container.scrollHeight, behavior: motion() });
    return true;
  }
  const el = document.getElementById(messageAnchorId(entry.messageId));
  if (!el) return false;
  container.scrollTo({ top: offsetWithin(container, el, 16), behavior: motion() });
  el.classList.remove("message-highlight");
  void el.offsetWidth;
  el.classList.add("message-highlight");
  window.setTimeout(() => el.classList.remove("message-highlight"), 2200);
  return true;
}
