import type { ClientCommand, ServerMessage } from "@shared/wire";
import type { Notify } from "../../../web/src/shared/state/client.ts";
import {
  type CorrelatedRequestOptions,
  correlatedRequests,
  type RequestOutcome,
} from "../../../web/src/shared/transport/correlatedRequest.ts";

export type DataControlsRequest =
  | { kind: "count"; requestId: string }
  | { kind: "archive"; requestId: string }
  | { kind: "unarchive"; requestId: string; cwd: string; sessionId: string };

export interface DataControlsState {
  request: DataControlsRequest | undefined;
  count: number | undefined;
  countFailed: boolean;
}

export interface DataControlsOptions extends CorrelatedRequestOptions {
  notify: Notify;
}

type DataControlsResult = Extract<ServerMessage, { _tag: "data_controls_result" }>["result"];
type Mutation = Exclude<DataControlsRequest["kind"], "count">;

const receipt = (message: ServerMessage) =>
  message._tag === "data_controls_result" ? message : undefined;

const FAILED: Record<Mutation, string> = {
  archive: "Could not archive sessions",
  unarchive: "Could not unarchive session",
};
const UNCONFIRMED: Record<Mutation, string> = {
  archive: "Archive all may have finished; check Archived sessions",
  unarchive: "Unarchive may have finished; check Archived sessions",
};

function mutationNotice(
  kind: Mutation,
  outcome: Exclude<RequestOutcome<DataControlsResult>, { status: "confirmed" }>,
): { message: string; level: "error" | "warning" } {
  switch (outcome.status) {
    case "not-sent":
      return { message: FAILED[kind], level: "error" };
    case "failed":
      return { message: `${FAILED[kind]}: ${outcome.error.detail}`, level: "error" };
    case "unconfirmed":
      return {
        message:
          outcome.reason === "connection-lost"
            ? `Connection lost. ${UNCONFIRMED[kind]} after reconnecting.`
            : `No reply. ${UNCONFIRMED[kind]}.`,
        level: "warning",
      };
  }
}

export function archiveConfirmation(state: DataControlsState, connected: boolean) {
  return {
    open: state.count !== undefined,
    title: `Archive ${state.count ?? 0} sessions?`,
    busy: state.request?.kind === "archive",
    disabled: !connected || state.request !== undefined || !(state.count && state.count > 0),
  };
}

export function createDataControls({ notify, ...options }: DataControlsOptions) {
  const { client } = options;
  const requests = correlatedRequests(options);
  let state: DataControlsState = { request: undefined, count: undefined, countFailed: false };
  let active: { cancel: () => void } | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<DataControlsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const begin = (
    request: (requestId: string) => DataControlsRequest,
    command: (requestId: string) => ClientCommand,
  ) => {
    if (state.request || !client.getState().connected) return;
    active = requests.send({
      command,
      receipt,
      pending: (requestId) => publish({ request: request(requestId), countFailed: false }),
      settle: (outcome) => {
        active = undefined;
        const kind = state.request?.kind;
        if (outcome.status === "confirmed") {
          publish({
            request: undefined,
            count: kind === "count" ? outcome.result.count : undefined,
          });
          return;
        }
        publish({ request: undefined, count: undefined, countFailed: kind === "count" });
        if (kind && kind !== "count") {
          const { message, level } = mutationNotice(kind, outcome);
          notify(message, level);
        }
      },
    });
  };
  const open = () => {
    if (state.request || !client.getState().connected) return;
    publish({ count: undefined });
    begin(
      (requestId) => ({ kind: "count", requestId }),
      (requestId) => ({ _tag: "archive_sessions_count", requestId }),
    );
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
        if (!client.getState().connected && !state.request && state.count !== undefined)
          publish({ count: undefined });
      });
      return () => {
        stopState();
        active?.cancel();
        active = undefined;
        publish({ request: undefined, count: undefined });
      };
    },
    open,
    cancel: () => {
      if (!state.request) publish({ count: undefined });
    },
    archive: () => {
      if (archiveConfirmation(state, client.getState().connected).disabled) return;
      begin(
        (requestId) => ({ kind: "archive", requestId }),
        (requestId) => ({ _tag: "archive_all_sessions", requestId }),
      );
    },
    unarchive: ({ cwd, sessionId }: { cwd: string; sessionId: string }) => {
      if (state.count !== undefined) return;
      begin(
        (requestId) => ({ kind: "unarchive", requestId, cwd, sessionId }),
        (requestId) => ({ _tag: "unarchive_session", requestId, cwd, sessionId }),
      );
    },
  };
}
