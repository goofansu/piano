/** Read-only, bounded projection shared by live RPC and inactive Pi history.
 * Keep real parent IDs even when an ancestor is technical or outside the window.
 * Never serialize arbitrary entry data: custom payloads can contain binary/secrets.
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ConversationDetail, ConversationTree } from "../shared/wire.ts";
import { redactDisplay } from "./DisplayProjection.ts";

const MAX_ENTRIES = 2000;
const PREVIEW = 280;
const DETAIL = 32_000;

function content(entry: SessionEntry, limit: number) {
  const raw = entry as unknown as Record<string, unknown>;
  const message = (entry.type === "message" ? entry.message : raw) as Record<string, unknown>;
  let text = "", omittedImages = 0, truncated = false;
  const append = (value: string) => {
    // Redact before cutting so limits cannot disclose a partial known secret.
    const safe = redactDisplay(value);
    const remaining = limit - text.length;
    if (safe.length > remaining) truncated = true;
    text += safe.slice(0, remaining);
  };
  if (typeof raw.summary === "string") append(raw.summary);
  else if (typeof message.content === "string") append(message.content);
  else if (Array.isArray(message.content)) for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "image") omittedImages++;
    else if (block.type === "text" && typeof block.text === "string") append(`${text ? "\n" : ""}${block.text}`);
    else if (block.type === "thinking" && typeof block.thinking === "string") append(`${text ? "\n" : ""}${block.thinking}`);
    else if (block.type === "toolCall" && typeof block.name === "string") append(`${text ? "\n" : ""}Tool: ${block.name} (arguments omitted)`);
  }
  if (!text) append(entry.type === "model_change" ? `${entry.provider}/${entry.modelId}`
    : entry.type === "thinking_level_change" ? entry.thinkingLevel
    : entry.type === "session_info" ? entry.name ?? "Session name cleared"
    : entry.type === "custom" || entry.type === "custom_message" ? entry.customType
    : entry.type);
  return { text, omittedImages, truncated };
}

export function conversationTree(sessionId: string, entries: readonly SessionEntry[], leafId: string | null): ConversationTree {
  const byId = new Map(entries.map(e => [e.id, e]));
  const path = new Set<string>();
  let current = leafId;
  while (current && !path.has(current)) { path.add(current); current = byId.get(current)?.parentId ?? null; }
  const labels = new Map<string, string>();
  for (const e of entries) if (e.type === "label") {
    if (e.label) labels.set(e.targetId, redactDisplay(e.label).slice(0, PREVIEW));
    else labels.delete(e.targetId);
  }
  // Latest entries, plus the live position even if it is old. No invented parents.
  const window = entries.slice(-MAX_ENTRIES);
  const leaf = leafId ? byId.get(leafId) : undefined;
  if (leaf && !window.includes(leaf)) window[0] = leaf;
  return { sessionId, leafId, total: entries.length, truncated: entries.length > window.length,
    entries: window.map(e => {
      const kind = e.type === "message" ? e.message.role : e.type;
      return { id: e.id, parentId: e.parentId, kind, preview: content(e, PREVIEW).text,
        label: labels.get(e.id), technical: !["user", "assistant", "compaction", "branch_summary", "custom_message"].includes(kind),
        onCurrentPath: path.has(e.id) };
    }),
  };
}

export function conversationDetail(sessionId: string, entries: readonly SessionEntry[], entryId: string): ConversationDetail {
  const entry = entries.find(e => e.id === entryId);
  if (!entry) throw new Error("This entry is no longer available. Refresh the conversation tree.");
  return { sessionId, entryId, ...content(entry, DETAIL) };
}
