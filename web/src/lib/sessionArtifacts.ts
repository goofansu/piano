/**
 * The Radius artifacts a session published, for the session header's Artifacts menu. Pi's history is
 * the record (INV-01): each comes from a create or update call of the bundled extension
 * (`extensions/radius-artifacts`) whose result its shared contract (`shared/radiusArtifacts.ts`)
 * reads as confirmed, so a failed or unconfirmed publication is never listed.
 */
import { isPublishingTool, publishedArtifact } from "../../../shared/radiusArtifacts.ts";
import type { RenderMsg } from "../../../shared/wire.ts";

export interface SessionArtifact {
  /** Radius's artifact ID: an update keeps it, so the artifact is listed once. */
  id: string;
  /** The title of its latest confirmed publication. */
  title: string;
  url: string;
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/**
 * Every artifact the conversation published, each once, newest publication first: an update moves
 * its artifact to the top and gives it that publication's title and URL.
 */
export function sessionArtifacts(messages: ReadonlyArray<RenderMsg>): SessionArtifact[] {
  // The header and the command list both ask on every render; the store replaces the array on change.
  const cached = derived.get(messages);
  if (cached) return cached;
  const found = derive(messages);
  derived.set(messages, found);
  return found;
}

const derived = new WeakMap<ReadonlyArray<RenderMsg>, SessionArtifact[]>();

function derive(messages: ReadonlyArray<RenderMsg>): SessionArtifact[] {
  const titles = new Map<string, string>();
  const latest = new Map<string, SessionArtifact>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (!isPublishingTool(call.name)) continue;
        const title = text(parseObject(call.args)?.title);
        if (title) titles.set(call.id, title);
      }
      continue;
    }
    if (message.role !== "tool_result" || message.isError) continue;
    const published = message.toolName && publishedArtifact(message.toolName, message.text);
    if (!published) continue;
    const { id, url } = published;
    const title = (message.toolCallId && titles.get(message.toolCallId)) ?? latest.get(id)?.title;
    // Re-inserting moves the artifact to the end: Map order is publication order.
    latest.delete(id);
    latest.set(id, { id, title: title ?? "Untitled", url });
  }
  return [...latest.values()].reverse();
}
