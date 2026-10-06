import type { RenderMsg } from "@shared/wire";

/** The transcript's scroll container; the jump list reads and moves it. */
export const TRANSCRIPT_SELECTOR = '[data-slot="transcript"]';

/** DOM id of a message's article, so a jump can find it without a shared ref. */
export const messageAnchorId = (id: string) => `msg-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export type JumpEntry =
  | { kind: "top"; id: string; label: string }
  | { kind: "bottom"; id: string; label: string }
  | { kind: "user" | "assistant"; id: string; label: string; messageId: string; turn?: number };

/** One line of a message, with markdown prefixes and extra whitespace folded away. */
export function messageLabel(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim().replace(/^[#>*\-`\s]+/, "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Every prompt and Pi assistant turn, including tool-only turns, in transcript order. */
export function jumpEntries(messages: ReadonlyArray<RenderMsg>): JumpEntry[] {
  const entries: JumpEntry[] = [{ kind: "top", id: "top", label: "Top of conversation" }];
  const total = messages.filter(message => message.role === "assistant").length;
  let turn = 0;
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.role === "assistant") turn++;
    const label = messageLabel(message.text) || (message.attachments?.length ? "Image" : message.toolCalls?.map(call => call.name).join(", ")) || (message.role === "assistant" ? "Assistant response" : "");
    if (!label) continue;
    entries.push({ kind: message.role, id: message.id, label, messageId: message.id,
      turn: total === 0 ? undefined : message.role === "assistant" ? turn : Math.min(turn + 1, total),
    });
  }
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
