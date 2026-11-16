import type {
  RenderMsg,
  SessionCursor,
  SessionEvent,
  SessionState,
  SessionStats,
  Snapshot,
} from "./wire.ts";

export const isWorking = (
  state: Pick<SessionState, "isStreaming" | "isCompacting" | "isRetrying">,
): boolean => !!(state.isStreaming || state.isCompacting || state.isRetrying);

export const emptySnapshot = (sessionId: string): Snapshot => ({
  state: { sessionId, isStreaming: false },
  messages: [],
  dialogs: [],
});

export const withLastKnownStats = (
  state: SessionState,
  stats: SessionStats | undefined,
): SessionState => ({ ...state, ...stats, contextIsLastKnown: true });

export type CursorStep = "next" | "duplicate" | "gap" | "other-generation";

type Position = Pick<SessionCursor, "generation" | "sequence">;

export function cursorStep(last: Position | null | undefined, frame: Position): CursorStep {
  if (!last || frame.generation !== last.generation) return "other-generation";
  if (frame.sequence <= last.sequence) return "duplicate";
  return frame.sequence === last.sequence + 1 ? "next" : "gap";
}

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

export function applySessionEvent(snapshot: Snapshot, event: SessionEvent): Snapshot {
  switch (event._tag) {
    case "snapshot":
      return event.snapshot;
    case "state":
      return {
        ...snapshot,
        state: event.state,
        pending: event.state.isStreaming ? snapshot.pending : undefined,
      };
    case "queue_update":
      return { ...snapshot, state: { ...snapshot.state, queuedMessages: event.messages } };
    case "submission":
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
    case "response_completed":
    case "notice":
      return snapshot;
  }
}
