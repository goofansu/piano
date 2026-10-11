/**
 * Sessions are Pi sessions. Read them from Pi's session store without starting
 * an agent, using the SDK's SessionManager as a file reader.
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import type { Snapshot } from "../shared/wire.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { sessionDirFor } from "./PiEnv.ts";
import { type RawMessage, serializeMessages, stateFactsOf } from "./PiRecords.ts";
import { RunLedger } from "./RunLedger.ts";

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

/** Read the active branch of a session file as a Snapshot, with Run usage from every entry.
 * Safe while Pi is writing to it. */
export const peekSession = (path: string, sessionId: string): Effect.Effect<Snapshot> =>
  Effect.sync(() => {
    const sm = SessionManager.open(path);
    // Use Pi's own compaction/context-edit/active-branch projection, the same
    // display scope as RPC get_messages. Never infer selection from an answer.
    const context = sm.buildSessionContext();
    // Pi's context builder uses the last assistant's physical model. Selection
    // is recorded separately; this read-only peek cannot check whether a virtual
    // model is still registered. The next CLI open confirms/falls back itself.
    const selection = sm.getBranch().findLast(entry => entry.type === "model_change");
    const model = selection?.type === "model_change" ? { provider: selection.provider, id: selection.modelId }
      : context.model ? { provider: context.model.provider, id: context.model.modelId } : undefined;
    return projectDisplay({
      state: { ...stateFactsOf({ sessionId, sessionFile: path, sessionName: sm.getSessionName(), model, thinkingLevel: context.thinkingLevel, isStreaming: false }),
        subagents: new RunLedger().add(sm.getEntries()).usage },
      messages: serializeMessages(context.messages as RawMessage[]),
      dialogs: [],
    });
  }).pipe(
    Effect.orElseSucceed(() => ({
      state: { sessionId, sessionFile: path, isStreaming: false, projectionError: "Could not read Pi's current context. History was not replaced or repaired." },
      messages: [],
      dialogs: [],
    })),
  );

export const emptySnapshot = (sessionId: string): Snapshot => ({
  state: { sessionId, isStreaming: false },
  messages: [],
  dialogs: [],
});
