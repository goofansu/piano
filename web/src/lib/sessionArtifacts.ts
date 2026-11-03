/**
 * The Radius artifacts a session published, for the session header's Artifacts menu. Pi's history is
 * the record (INV-01): each comes from a `radius_artifact_create` or `radius_artifact_update` call
 * whose result the bundled extension confirmed (`extensions/radius-artifacts`), so a failed or
 * unconfirmed publication is never listed.
 */
import type { RenderMsg } from "../../../shared/wire.ts";

export interface SessionArtifact {
  /** Radius's artifact ID: an update keeps it, so the artifact is listed once. */
  id: string;
  /** The title of its latest confirmed publication. */
  title: string;
  url: string;
}

const PUBLISHING_TOOLS = new Set(["radius_artifact_create", "radius_artifact_update"]);

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
        if (!PUBLISHING_TOOLS.has(call.name)) continue;
        const title = text(parseObject(call.args)?.title);
        if (title) titles.set(call.id, title);
      }
      continue;
    }
    if (message.role !== "tool_result" || message.isError) continue;
    if (!message.toolName || !PUBLISHING_TOOLS.has(message.toolName)) continue;
    const result = parseObject(message.text);
    const id = text(result?.artifactId);
    const url = text(result?.url);
    if (result?.status !== "confirmed" || !id || !url) continue;
    const title = (message.toolCallId && titles.get(message.toolCallId)) ?? latest.get(id)?.title;
    // Re-inserting moves the artifact to the end: Map order is publication order.
    latest.delete(id);
    latest.set(id, { id, title: title ?? "Untitled", url });
  }
  return [...latest.values()].reverse();
}
