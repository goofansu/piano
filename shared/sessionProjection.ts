/**
 * The one fold over a session's wire events. PiSessions keeps its retained snapshot with it and
 * the browser keeps its view with it, so a snapshot followed by its live events gives every tab
 * the state the server would hand a newly attached one (INV-05).
 */
import type {
  RenderMsg,
  SessionCursor,
  SessionEvent,
  SessionState,
  SessionStats,
  Snapshot,
} from "./wire.ts";

/** Pi has session-level work in flight: a run, a compaction or an automatic retry. */
export const isWorking = (
  state: Pick<SessionState, "isStreaming" | "isCompacting" | "isRetrying">,
): boolean => !!(state.isStreaming || state.isCompacting || state.isRetrying);

/** A Snapshot with no history: a session Pi has not written yet, or no session at all. */
export const emptySnapshot = (sessionId: string): Snapshot => ({
  state: { sessionId, isStreaming: false },
  messages: [],
  dialogs: [],
});

/** Pi's state seeded with the registry's last known statistics, shown as last known until Pi
 * reads them back. */
export const withLastKnownStats = (
  state: SessionState,
  stats: SessionStats | undefined,
): SessionState => ({ ...state, ...stats, contextIsLastKnown: true });

/** Where a live frame's cursor stands against the last one folded in: the one after it, one
 * already folded, one past frames that were missed, or one from another incarnation of the child
 * (or with nothing folded yet). The cursor is the only ordering an attachment has, so every
 * consumer of live frames classifies them here and decides only its reaction. */
export type CursorStep = "next" | "duplicate" | "gap" | "other-generation";

type Position = Pick<SessionCursor, "generation" | "sequence">;

export function cursorStep(last: Position | null | undefined, frame: Position): CursorStep {
  if (!last || frame.generation !== last.generation) return "other-generation";
  if (frame.sequence <= last.sequence) return "duplicate";
  return frame.sequence === last.sequence + 1 ? "next" : "gap";
}

/** Execution previews belong to their context's calls, not to a second session history. Keep
 * uncorrelated startup/extension executions: only Pi removing a known owner proves obsolescence.
 * Nested calls may name their parent explicitly or encode it as a parent/child ID. */
function contextTools(snapshot: Snapshot, messages: ReadonlyArray<RenderMsg>) {
  const calls = (messages: ReadonlyArray<RenderMsg>) =>
    new Set(
      messages.flatMap((message) => [
        ...(message.toolCalls?.map((call) => call.id) ?? []),
        ...(message.toolCallId ? [message.toolCallId] : []),
        ...(message.nestedCalls?.map((call) => call.id) ?? []),
      ]),
    );
  const current = calls(messages);
  const removed = calls(snapshot.messages);
  for (const id of current) removed.delete(id);
  if (!removed.size || !snapshot.tools?.length) return snapshot.tools;
  // Propagate through explicitly named parents too, even when children arrive before parents.
  let changed = true;
  while (changed) {
    changed = false;
    for (const tool of snapshot.tools) {
      if (removed.has(tool.id) || current.has(tool.id)) continue;
      let obsolete = tool.parentId !== undefined && removed.has(tool.parentId);
      for (let i = tool.id.indexOf("/"); !obsolete && i > 0; i = tool.id.indexOf("/", i + 1))
        obsolete = removed.has(tool.id.slice(0, i));
      if (obsolete) {
        removed.add(tool.id);
        changed = true;
      }
    }
  }
  return snapshot.tools.filter((tool) => !removed.has(tool.id));
}

/** The snapshot after `event`. Events that change nothing return the same snapshot. */
export function applySessionEvent(snapshot: Snapshot, event: SessionEvent): Snapshot {
  switch (event._tag) {
    case "snapshot":
      return event.snapshot;
    case "state":
      // A partial reply belongs to a run; once the run is over it is either final or gone.
      return {
        ...snapshot,
        state: event.state,
        pending: event.state.isStreaming ? snapshot.pending : undefined,
      };
    case "queue_update":
      return { ...snapshot, state: { ...snapshot.state, queuedMessages: event.messages } };
    case "submission":
      // IDs order submissions within one child: a late outcome never replaces newer input's.
      if (snapshot.state.submission && event.submission.id < snapshot.state.submission.id)
        return snapshot;
      return { ...snapshot, state: { ...snapshot.state, submission: event.submission } };
    case "message_update":
      return { ...snapshot, pending: event.message };
    case "message_end":
      return {
        ...snapshot,
        messages: [...snapshot.messages, event.message],
        pending: event.message.role === "assistant" ? undefined : snapshot.pending,
      };
    case "context":
      return {
        ...snapshot,
        messages: event.messages,
        tools: contextTools(snapshot, event.messages),
      };
    case "tool_update": {
      const tools = snapshot.tools ?? [];
      const index = tools.findIndex((tool) => tool.id === event.tool.id);
      return {
        ...snapshot,
        tools: index < 0 ? [...tools, event.tool] : tools.with(index, event.tool),
      };
    }
    case "dialog":
      return snapshot.dialogs.some(
        (d) => d.id === event.dialog.id && d.generation === event.dialog.generation,
      )
        ? snapshot
        : { ...snapshot, dialogs: [...snapshot.dialogs, event.dialog] };
    case "dialog_resolved":
      return {
        ...snapshot,
        dialogs: snapshot.dialogs.filter(
          (d) => d.id !== event.resolution.id || d.generation !== event.resolution.generation,
        ),
      };
    case "closed":
      // A stopped child has no activity, queue, partial reply or answerable dialog; its history
      // remains, and its live context is no longer observed.
      return {
        ...snapshot,
        pending: undefined,
        dialogs: [],
        state: {
          ...snapshot.state,
          isStreaming: false,
          isCompacting: false,
          isRetrying: false,
          isStopping: false,
          queuedMessages: [],
          contextIsLastKnown: true,
          closure: event.closure,
          preview: null,
        },
      };
    case "response_completed":
    case "notice":
      return snapshot;
  }
}
