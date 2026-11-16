/**
 * Data controls sends each intent once. Only a correlated server receipt settles it; losing
 * the connection or timing out never replays a mutation. The server owns eligibility (including
 * held locks not in the host broadcast), registry updates and success toasts.
 */
import type { ClientCommand } from "@shared/wire";
import type { Client } from "./client.ts";

export type DataControlsRequest =
  | { kind: "count"; requestId: string }
  | { kind: "archive"; requestId: string }
  | { kind: "unarchive"; requestId: string; cwd: string; sessionId: string };

export interface DataControlsState {
  request: DataControlsRequest | undefined;
  /** A fresh server count opens the confirmation; undefined means it is closed. */
  count: number | undefined;
  countFailed: boolean;
}

export const DATA_CONTROLS_TIMEOUT_MS = 75_000;

export interface DataControlsOptions {
  client: Pick<Client, "getState" | "subscribe" | "send" | "listen">;
  failure: (message: string) => void;
  newRequestId?: () => string;
  timers?: {
    setTimeout: (run: () => void, ms: number) => unknown;
    clearTimeout: (timer: unknown) => void;
  };
}

/** The count is a server observation, never an estimate from the visible session catalog. */
export function archiveConfirmation(state: DataControlsState, connected: boolean) {
  return {
    open: state.count !== undefined,
    title: `Archive ${state.count ?? 0} sessions?`,
    busy: state.request?.kind === "archive",
    disabled: !connected || state.request !== undefined || !(state.count && state.count > 0),
  };
}

export function createDataControls({
  client,
  failure,
  newRequestId = () => crypto.randomUUID(),
  timers = {
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
}: DataControlsOptions) {
  let state: DataControlsState = { request: undefined, count: undefined, countFailed: false };
  let timer: unknown;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<DataControlsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const clearTimer = () => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  };
  const fail = () => {
    const request = state.request;
    if (!request) return;
    clearTimer();
    publish({ request: undefined, count: undefined, countFailed: request.kind === "count" });
    // Reads have no toast; their retry stays on the page. Mutations fail once, with fixed copy.
    if (request.kind !== "count")
      failure(
        request.kind === "unarchive" ? "Could not unarchive session" : "Could not archive sessions",
      );
  };
  const begin = (request: DataControlsRequest, command: ClientCommand) => {
    if (state.request || !client.getState().connected) return;
    publish({ request, countFailed: false });
    timer = timers.setTimeout(() => {
      if (state.request?.requestId === request.requestId) fail();
    }, DATA_CONTROLS_TIMEOUT_MS);
    try {
      // An uncertain send may have reached the server. Await its receipt, never resend.
      if (client.send(command) === "not-sent") fail();
    } catch {
      fail();
    }
  };
  const open = () => {
    if (state.request || !client.getState().connected) return;
    publish({ count: undefined });
    const requestId = newRequestId();
    begin({ kind: "count", requestId }, { _tag: "archive_sessions_count", requestId });
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      const stopState = client.subscribe(() => {
        if (client.getState().connected) return;
        if (state.request) fail();
        // A count from a lost connection must be fetched again, not reused on reconnect.
        else if (state.count !== undefined) publish({ count: undefined });
      });
      const stopMessages = client.listen((message) => {
        if (
          message._tag !== "data_controls_result" ||
          message.requestId !== state.request?.requestId
        )
          return;
        if (message.result.status === "error") {
          fail();
          return;
        }
        const kind = state.request.kind;
        clearTimer();
        publish({ request: undefined, count: kind === "count" ? message.result.count : undefined });
      });
      return () => {
        stopState();
        stopMessages();
        clearTimer();
        // Fence late receipts when this page is left, including React's effect restart.
        publish({ request: undefined, count: undefined });
      };
    },
    open,
    cancel: () => {
      if (!state.request) publish({ count: undefined });
    },
    archive: () => {
      if (archiveConfirmation(state, client.getState().connected).disabled) return;
      const requestId = newRequestId();
      begin({ kind: "archive", requestId }, { _tag: "archive_all_sessions", requestId });
    },
    unarchive: ({ cwd, sessionId }: { cwd: string; sessionId: string }) => {
      if (state.count !== undefined) return;
      const requestId = newRequestId();
      begin(
        { kind: "unarchive", requestId, cwd, sessionId },
        { _tag: "unarchive_session", requestId, cwd, sessionId },
      );
    },
  };
}
