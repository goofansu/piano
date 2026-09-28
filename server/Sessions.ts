/**
 * Threads are pi sessions. Read them from pi's session store without starting
 * an agent, using the SDK's SessionManager as a file reader.
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import type { RenderMsg, Snapshot } from "../shared/wire.ts";
import { sessionDirFor } from "./PiEnv.ts";
import { type RawMessage, serializeMessage } from "./PiRecords.ts";

export interface SessionSummary {
  sessionId: string;
  path: string;
  name?: string;
  firstMessage: string;
  created: string;
  modified: string;
  messageCount: number;
}

export const listSessions = (cwd: string): Effect.Effect<SessionSummary[]> =>
  Effect.promise(() => SessionManager.list(cwd, sessionDirFor(cwd))).pipe(
    Effect.map((infos) =>
      infos
        .map((i) => ({
          sessionId: i.id,
          path: i.path,
          name: i.name,
          firstMessage: i.firstMessage,
          created: i.created.toISOString(),
          modified: i.modified.toISOString(),
          messageCount: i.messageCount,
        }))
        .sort((a, b) => b.modified.localeCompare(a.modified)),
    ),
    Effect.orElseSucceed(() => []),
  );

export const findSessionFile = (cwd: string, sessionId: string): Effect.Effect<string | undefined> =>
  listSessions(cwd).pipe(Effect.map((s) => s.find((i) => i.sessionId === sessionId)?.path));

/** Read the active branch of a session file as a Snapshot. Safe while pi is writing to it. */
export const peekSession = (path: string, sessionId: string): Effect.Effect<Snapshot> =>
  Effect.sync(() => {
    const sm = SessionManager.open(path);
    const messages: RenderMsg[] = [];
    let model: string | undefined;
    let thinkingLevel: string | undefined;
    for (const entry of sm.getBranch()) {
      if (entry.type === "model_change") model = `${entry.provider}/${entry.modelId}`;
      if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
      if (entry.type !== "message") continue;
      const raw = entry.message as unknown as RawMessage;
      const m = serializeMessage(entry.id, raw);
      if (!m) continue;
      messages.push(m);
      if (raw.role === "assistant" && raw.provider && raw.model) model = `${raw.provider}/${raw.model}`;
    }
    return {
      state: { sessionId, sessionFile: path, sessionName: sm.getSessionName(), model, thinkingLevel, isStreaming: false },
      messages,
      dialogs: [],
    };
  }).pipe(
    Effect.orElseSucceed(() => ({
      state: { sessionId, sessionFile: path, isStreaming: false },
      messages: [],
      dialogs: [],
    })),
  );

export const emptySnapshot = (sessionId: string): Snapshot => ({
  state: { sessionId, isStreaming: false },
  messages: [],
  dialogs: [],
});
