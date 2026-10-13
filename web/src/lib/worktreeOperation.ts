/**
 * The worktree picker's work against one folder's repository: discovering its worktrees, and one
 * deliberate operation at a time, creating a branch or selecting a discovered checkout (INV-06).
 * An operation is sent once and never retried automatically; it ends with its own receipt
 * (matched by request ID), a timeout or a lost connection, and the last two tell the user to
 * rediscover before retrying because the checkout may already have changed. Discovery is
 * refreshing until each request this picker sent for the folder has been answered, so an older
 * answer never stands in for a newer request. Nothing here depends on React or render timing.
 */
import type { ClientCommand, WorktreeDiscovery, WorktreeFacts } from "@shared/wire";
import type { Client } from "./client.ts";

export type WorktreeRequestKind = "create" | "select";

export type WorktreeRequestStatus =
  | { status: "idle" }
  | { status: "pending"; requestId: string; kind: WorktreeRequestKind }
  | { status: "failed"; detail: string; unconfirmed: boolean };

export interface WorktreeOperationState {
  /** The folder the picker was last opened on. */
  folder: string | undefined;
  /** This picker's latest discovery of that folder; undefined until one answers. */
  discovery: WorktreeDiscovery | undefined;
  /** Discovery was requested and has not answered yet. */
  refreshing: boolean;
  request: WorktreeRequestStatus;
}

/** How long a pending operation waits for its receipt before failing. */
export const RECEIPT_TIMEOUT_MS = 75_000;

/** Timers, behind a seam so the policy runs in Node. */
export interface WorktreeTimers {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

export interface WorktreeOperationOptions {
  client: Pick<Client, "getState" | "subscribe" | "send" | "listen">;
  newRequestId?: () => string;
  timers?: WorktreeTimers;
  /** The operation succeeded with this checkout. */
  ready?: (path: string) => void;
}

export interface WorktreeOperation {
  getState: () => WorktreeOperationState;
  subscribe: (listener: () => void) => () => void;
  /** Hears receipts, discoveries and the connection; returns the stop function, which also drops the timer. */
  start: () => () => void;
  /** The picker opened on a folder: forget a settled outcome and discover afresh. */
  open: (folder: string | undefined) => void;
  /** Ask the folder's repository again, keeping the operation's outcome on screen. */
  refresh: () => void;
  create: (branch: string, hooks: boolean) => void;
  select: (path: string) => void;
  /** The user moved on from a failure. */
  dismiss: () => void;
}

const NO_RECEIPT =
  "No creation/selection receipt. Refresh discovery and inspect the checkout before retrying; it may already exist.";
const CONNECTION_LOST =
  "Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout.";

const IDLE: WorktreeRequestStatus = { status: "idle" };

const browserTimers: WorktreeTimers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function createWorktreeOperation({
  client,
  newRequestId = () => crypto.randomUUID(),
  timers = browserTimers,
  ready = () => {},
}: WorktreeOperationOptions): WorktreeOperation {
  let state: WorktreeOperationState = {
    folder: undefined,
    discovery: undefined,
    refreshing: false,
    request: IDLE,
  };
  /** Discovery requests sent per folder that have not been answered. */
  const awaiting = new Map<string, number>();
  const discoveries = new Map<string, WorktreeDiscovery>();
  let timer: unknown;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<Pick<WorktreeOperationState, "folder" | "request">> = {}) => {
    const folder = "folder" in patch ? patch.folder : state.folder;
    const next: WorktreeOperationState = {
      folder,
      discovery: folder === undefined ? undefined : discoveries.get(folder),
      refreshing: folder !== undefined && (awaiting.get(folder) ?? 0) > 0,
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

  const settle = (request: WorktreeRequestStatus) => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    publish({ request });
  };

  const pendingId = () =>
    state.request.status === "pending" ? state.request.requestId : undefined;

  const discover = () => {
    const { folder } = state;
    if (folder === undefined || !client.getState().connected) return;
    awaiting.set(folder, (awaiting.get(folder) ?? 0) + 1);
    publish();
    client.send({ _tag: "worktrees", folder });
  };

  const begin = (kind: WorktreeRequestKind, command: (requestId: string) => ClientCommand) => {
    if (pendingId() !== undefined || !client.getState().connected) return;
    const requestId = newRequestId();
    publish({ request: { status: "pending", requestId, kind } });
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (pendingId() === requestId)
        settle({ status: "failed", detail: NO_RECEIPT, unconfirmed: true });
    }, RECEIPT_TIMEOUT_MS);
    client.send(command(requestId));
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
        // Requests on the lost connection are never answered; a pending one may still have run.
        awaiting.clear();
        if (pendingId() !== undefined)
          settle({ status: "failed", detail: CONNECTION_LOST, unconfirmed: true });
        else publish();
      });
      const stopMessages = client.listen((m) => {
        if (m._tag === "worktrees") {
          discoveries.set(m.folder, m.discovery);
          const left = (awaiting.get(m.folder) ?? 0) - 1;
          if (left > 0) awaiting.set(m.folder, left);
          else awaiting.delete(m.folder);
          publish();
        } else if (m._tag === "worktree_result" && m.requestId === pendingId()) {
          if (m.result.status === "error")
            settle({
              status: "failed",
              detail: m.result.detail,
              unconfirmed: m.result.unconfirmed === true,
            });
          else {
            settle(IDLE);
            ready(m.result.path);
          }
        }
      });
      return () => {
        stopState();
        stopMessages();
        if (timer !== undefined) timers.clearTimeout(timer);
        timer = undefined;
      };
    },
    open: (folder) => {
      // A pending operation keeps its receipt; anything settled is forgotten.
      publish({ folder, request: pendingId() === undefined ? IDLE : state.request });
      discover();
    },
    refresh: discover,
    create: (branch, hooks) => {
      const { folder } = state;
      const name = branch.trim();
      if (folder === undefined || !name) return;
      begin("create", (requestId) => ({
        _tag: "create_worktree",
        requestId,
        folder,
        branch: name,
        hooks,
      }));
    },
    select: (path) => {
      const { folder } = state;
      if (folder === undefined) return;
      begin("select", (requestId) => ({ _tag: "add_worktree", requestId, folder, path }));
    },
    dismiss: () => {
      if (state.request.status === "failed") publish({ request: IDLE });
    },
  };
}

export const worktreeLabel = (worktree: WorktreeFacts) =>
  worktree.branch ?? worktree.path.split("/").filter(Boolean).at(-1) ?? "Detached HEAD";

/** Literal matching avoids unrelated fuzzy hits and preserves discovery order. */
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
