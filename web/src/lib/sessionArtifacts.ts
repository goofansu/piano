/**
 * The Radius artifacts a session published, for the session header's Artifacts menu. Pi's history is
 * the record (INV-01): each comes from a create or update call of the bundled extension
 * (`extensions/radius-artifacts`) whose result its shared contract (`shared/radiusArtifacts.ts`)
 * reads as confirmed, so a failed or unconfirmed publication is never listed.
 */
import {
  type ArtifactPublication,
  isPublishingTool,
  publishedArtifact,
} from "../../../shared/radiusArtifacts.ts";
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
export function sessionArtifacts(
  messages: ReadonlyArray<RenderMsg>,
  publications: readonly ArtifactPublication[] = [],
): SessionArtifact[] {
  // Legacy direct results remain discoverable; codemode output is never scraped. Receipts
  // survive compaction and carry the title even when Pi omitted large nested arguments.
  const legacy = derived.get(messages) ?? derive(messages);
  derived.set(messages, legacy);
  if (!publications.length) return legacy;
  const ids = new Set(publications.map((p) => p.artifactId));
  return [
    ...publications.map((p) => ({ id: p.artifactId, title: p.title, url: p.url })),
    ...legacy.filter((p) => !ids.has(p.id)),
  ];
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
