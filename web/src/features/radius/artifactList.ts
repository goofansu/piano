import type { ArtifactPublication } from "../../../../shared/features/radius/radiusArtifacts.ts";
import {
  isPublishingTool,
  publishedArtifact,
} from "../../../../shared/features/radius/radiusArtifactTools.ts";
import type { RenderMsg } from "../../../../shared/wire.ts";

export interface SessionArtifact {
  id: string;
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

export function sessionArtifacts(
  messages: ReadonlyArray<RenderMsg>,
  publications: readonly ArtifactPublication[] = [],
): SessionArtifact[] {
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
    latest.delete(id);
    latest.set(id, { id, title: title ?? "Untitled", url });
  }
  return [...latest.values()].reverse();
}
