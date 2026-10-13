/**
 * The one fold over a session's wire events. PiSessions keeps its retained snapshot with it and
 * the browser keeps its view with it, so a snapshot followed by its live events gives every tab
 * the state the server would hand a newly attached one (INV-05).
 */
import type { SessionEvent, SessionState, SessionStats, Snapshot } from "./wire.ts";

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
      return { ...snapshot, messages: event.messages };
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
        },
      };
    case "notice":
      return snapshot;
  }
}
