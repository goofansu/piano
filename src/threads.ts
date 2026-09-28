/**
 * Threads are pi sessions. This module reads them from pi's session store
 * without starting an agent, using the SDK's SessionManager as a file reader.
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionDirFor } from "./pi-env.ts";
import { type RawMessage, type RenderMsg, serializeMessage } from "./wire.ts";

export interface ThreadInfo {
  sessionId: string;
  path: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  messageCount: number;
}

export async function listThreads(cwd: string): Promise<ThreadInfo[]> {
  const infos = await SessionManager.list(cwd, sessionDirFor(cwd));
  return infos
    .map((i) => ({
      sessionId: i.id,
      path: i.path,
      name: i.name,
      firstMessage: i.firstMessage,
      created: i.created.toISOString(),
      modified: i.modified.toISOString(),
      messageCount: i.messageCount,
    }))
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function findSessionFile(cwd: string, sessionId: string): Promise<string | undefined> {
  const infos = await SessionManager.list(cwd, sessionDirFor(cwd));
  return infos.find((i) => i.id === sessionId)?.path;
}

export interface PeekResult {
  messages: RenderMsg[];
  sessionName?: string;
  model?: string;
}

/** Read the active branch of a session file. Safe to call while pi is writing to it. */
export function peekSession(path: string): PeekResult {
  const sm = SessionManager.open(path);
  const messages: RenderMsg[] = [];
  let model: string | undefined;
  for (const entry of sm.getBranch()) {
    if (entry.type === "model_change") model = `${entry.provider}/${entry.modelId}`;
    if (entry.type !== "message") continue;
    const raw = entry.message as unknown as RawMessage;
    const m = serializeMessage(entry.id, raw);
    if (m) {
      messages.push(m);
      if (raw.role === "assistant" && raw.provider && raw.model) model = `${raw.provider}/${raw.model}`;
    }
  }
  return { messages, sessionName: sm.getSessionName(), model };
}
