import type { ClientCommand, ServerMessage, WorktreeDiscovery, WorktreeFacts } from "@shared/wire";
import {
  type CorrelatedRequestOptions,
  correlatedRequests,
  type RequestOutcome,
} from "./correlatedRequest.ts";
import { branchLabel } from "./format.ts";

export type WorktreeRequestStatus =
  | { status: "idle" }
  | { status: "pending"; requestId: string }
  | { status: "failed"; detail: string; unconfirmed: boolean };

export interface WorktreeOperationState {
  folder: string | undefined;
  discovery: WorktreeDiscovery | undefined;
  refreshing: boolean;
  request: WorktreeRequestStatus;
}

export interface WorktreeOperationOptions extends CorrelatedRequestOptions {
  ready?: (path: string) => void;
}

export interface WorktreeOperation {
  getState: () => WorktreeOperationState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  open: (folder: string | undefined) => void;
  refresh: () => void;
  select: (path: string) => void;
  dismiss: () => void;
}

const NO_RECEIPT =
  "No selection receipt. Refresh discovery and inspect the checkout before retrying.";
const CONNECTION_LOST =
  "Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout.";
const NOT_SENT = "Request not sent. Retry when Piano reconnects.";

type WorktreeResult = Extract<ServerMessage, { _tag: "worktree_result" }>["result"];

const receipt = (message: ServerMessage) =>
  message._tag === "worktree_result" ? message : undefined;

const failure = (
  outcome: Exclude<RequestOutcome<WorktreeResult>, { status: "confirmed" }>,
): WorktreeRequestStatus => {
  switch (outcome.status) {
    case "not-sent":
      return { status: "failed", detail: NOT_SENT, unconfirmed: false };
    case "failed":
      return {
        status: "failed",
        detail: outcome.error.detail,
        unconfirmed: outcome.error.unconfirmed === true,
      };
    case "unconfirmed":
      return {
        status: "failed",
        detail: outcome.reason === "connection-lost" ? CONNECTION_LOST : NO_RECEIPT,
        unconfirmed: true,
      };
  }
};

const IDLE: WorktreeRequestStatus = { status: "idle" };

export function createWorktreeOperation({
  ready = () => {},
  ...options
}: WorktreeOperationOptions): WorktreeOperation {
  const { client } = options;
  const requests = correlatedRequests(options);
  let state: WorktreeOperationState = {
    folder: undefined,
    discovery: undefined,
    refreshing: false,
    request: IDLE,
  };
  const awaiting = new Map<string, { requestId: string; trailing: boolean }>();
  const discoveries = new Map<string, WorktreeDiscovery>();
  let active: { cancel: () => void } | undefined;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<Pick<WorktreeOperationState, "folder" | "request">> = {}) => {
    const folder = "folder" in patch ? patch.folder : state.folder;
    const next: WorktreeOperationState = {
      folder,
      discovery: folder === undefined ? undefined : discoveries.get(folder),
      refreshing: folder !== undefined && awaiting.has(folder),
      request: patch.request ?? state.request,
    };
    if (
      next.folder === state.folder &&
      next.discovery === state.discovery &&
      next.refreshing === state.refreshing &&
      next.request === state.request
    )
      return;
    state = next;
    for (const listener of listeners) listener();
  };

  const pendingId = () =>
    state.request.status === "pending" ? state.request.requestId : undefined;

  const sendDiscovery = (folder: string) => {
    const requestId = crypto.randomUUID();
    awaiting.set(folder, { requestId, trailing: false });
    publish();
    client.send({ _tag: "worktrees", folder, requestId });
  };

  const discover = () => {
    const { folder } = state;
    if (folder === undefined || !client.getState().connected) return;
    const pending = awaiting.get(folder);
    if (pending) pending.trailing = true;
    else sendDiscovery(folder);
  };

  const begin = (command: (requestId: string) => ClientCommand) => {
    if (pendingId() !== undefined || !client.getState().connected) return;
    active = requests.send({
      command,
      receipt,
      pending: (requestId) => publish({ request: { status: "pending", requestId } }),
      settle: (outcome) => {
        active = undefined;
        if (outcome.status !== "confirmed") {
          publish({ request: failure(outcome) });
          return;
        }
        publish({ request: IDLE });
        ready(outcome.result.path);
      },
    });
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      let connected = client.getState().connected;
      const stopState = client.subscribe(() => {
        const now = client.getState().connected;
        if (now === connected) return;
        connected = now;
        if (now) return;
        awaiting.clear();
        publish();
      });
      const stopMessages = client.listen((m) => {
        if (m._tag === "worktrees") {
          const pending = awaiting.get(m.folder);
          if (!pending || pending.requestId !== m.requestId) return;
          discoveries.set(m.folder, m.discovery);
          if (pending.trailing) sendDiscovery(m.folder);
          else {
            awaiting.delete(m.folder);
            publish();
          }
        }
      });
      return () => {
        stopState();
        stopMessages();
        active?.cancel();
        active = undefined;
      };
    },
    open: (folder) => {
      publish({ folder, request: pendingId() === undefined ? IDLE : state.request });
      discover();
    },
    refresh: discover,
    select: (path) => {
      const { folder } = state;
      if (folder === undefined) return;
      begin((requestId) => ({ _tag: "add_worktree", requestId, folder, path }));
    },
    dismiss: () => {
      if (state.request.status === "failed") publish({ request: IDLE });
    },
  };
}

export const worktreeLabel = (worktree: WorktreeFacts) =>
  branchLabel(worktree.branch, worktree.detached);

export function filterWorktrees(
  all: readonly WorktreeFacts[],
  query: string,
): readonly WorktreeFacts[] {
  const needle = query.trim().toLowerCase();
  return needle
    ? all.filter((w) =>
        [worktreeLabel(w), w.path].some((text) => text.toLowerCase().includes(needle)),
      )
    : all;
}

export interface WorktreesViewInput {
  state: WorktreeOperationState;
  folder: { discovery: WorktreeDiscovery } | undefined;
  connected: boolean;
  query: string;
}

export interface WorktreesFailure {
  title: string;
  lines: readonly string[];
  details?: string;
}

export interface WorktreesView {
  discovery: WorktreeDiscovery | undefined;
  visible: readonly WorktreeFacts[];
  pending: boolean;
  busy: boolean;
  emptyText: string;
  failure: WorktreesFailure | undefined;
  notices: { disconnected: string | undefined; discoveryError: string | undefined };
}

export function worktreesView({
  state,
  folder,
  connected,
  query,
}: WorktreesViewInput): WorktreesView {
  const discovery = folder && (state.discovery ?? folder.discovery);
  const ready = discovery?.status === "ready" ? discovery : undefined;
  const { request } = state;
  const pending = request.status === "pending";
  let failure: WorktreesFailure | undefined;
  if (request.status === "failed")
    failure = request.unconfirmed
      ? {
          title: "Worktree operation not confirmed",
          lines: ["Refresh discovery before retrying."],
          details: request.detail,
        }
      : {
          title: "Could not open the worktree",
          lines: [request.detail],
        };
  return {
    discovery,
    visible: filterWorktrees(ready?.worktrees ?? [], query),
    pending,
    busy: pending || !connected || state.refreshing,
    emptyText: discovery?.status === "non-git" ? "Non-Git directory" : "No worktree matches.",
    failure,
    notices: {
      disconnected: connected ? undefined : "Disconnected — showing last observation.",
      discoveryError: discovery?.status === "error" ? discovery.detail : undefined,
    },
  };
}
