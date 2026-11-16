import type { ClientCommand, WorktreeDiscovery, WorktreeFacts } from "@shared/wire";
import type { Client } from "./client.ts";
import { branchLabel } from "./format.ts";

export type WorktreeRequestKind = "create" | "select";

export type WorktreeRequestStatus =
  | { status: "idle" }
  | { status: "pending"; requestId: string; kind: WorktreeRequestKind }
  | { status: "failed"; detail: string; unconfirmed: boolean };

export interface WorktreeOperationState {
  folder: string | undefined;
  discovery: WorktreeDiscovery | undefined;
  refreshing: boolean;
  request: WorktreeRequestStatus;
}

export const RECEIPT_TIMEOUT_MS = 75_000;

export interface WorktreeTimers {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

export interface WorktreeOperationOptions {
  client: Pick<Client, "getState" | "subscribe" | "send" | "listen">;
  newRequestId?: () => string;
  timers?: WorktreeTimers;
  ready?: (path: string) => void;
}

export interface WorktreeOperation {
  getState: () => WorktreeOperationState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  open: (folder: string | undefined) => void;
  refresh: () => void;
  create: (branch: string, hooks: boolean) => void;
  select: (path: string) => void;
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
  const awaiting = new Map<string, { requestId: string; trailing: boolean }>();
  const discoveries = new Map<string, WorktreeDiscovery>();
  let timer: unknown;
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

  const settle = (request: WorktreeRequestStatus) => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    publish({ request });
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
        awaiting.clear();
        if (pendingId() !== undefined)
          settle({ status: "failed", detail: CONNECTION_LOST, unconfirmed: true });
        else publish();
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

export interface WorktreesForm {
  creating: boolean;
  branch: string;
  hooks: boolean;
  query: string;
}

export interface WorktreesViewInput<Folder extends { discovery: WorktreeDiscovery }> {
  state: WorktreeOperationState;
  folder: Folder | undefined;
  connected: boolean;
  form: WorktreesForm;
}

export interface WorktreesFailure {
  title: string;
  lines: readonly string[];
  details?: string;
}

export interface WorktreesView<Folder> {
  discovery: WorktreeDiscovery | undefined;
  target: Folder | undefined;
  visible: readonly WorktreeFacts[];
  pending: boolean;
  busy: boolean;
  canStart: boolean;
  canSubmit: boolean;
  createFromQuery: string | undefined;
  emptyText: string;
  failure: WorktreesFailure | undefined;
  notices: { disconnected: string | undefined; discoveryError: string | undefined };
}

const HOOKS_HINT =
  "For unapproved hooks, review and approve them in a terminal, or leave hooks off.";

export function worktreesView<Folder extends { discovery: WorktreeDiscovery }>({
  state,
  folder,
  connected,
  form,
}: WorktreesViewInput<Folder>): WorktreesView<Folder> {
  const discovery = folder && (state.discovery ?? folder.discovery);
  const ready = discovery?.status === "ready" ? discovery : undefined;
  const target = ready ? folder : undefined;
  const { request } = state;
  const pending = request.status === "pending";
  const canStart = connected && !pending;
  const needle = form.query.trim();
  let failure: WorktreesFailure | undefined;
  if (request.status === "failed")
    failure = request.unconfirmed
      ? {
          title: "Worktree operation not confirmed",
          lines: [
            "Refresh discovery before retrying.",
            ...(form.creating && form.hooks ? [HOOKS_HINT] : []),
          ],
          details: request.detail,
        }
      : {
          title: form.creating ? "Could not create the worktree" : "Could not open the worktree",
          lines: [request.detail],
        };
  return {
    discovery,
    target,
    visible: filterWorktrees(ready?.worktrees ?? [], form.query),
    pending,
    busy: pending || !connected || state.refreshing,
    canStart,
    canSubmit: canStart && target !== undefined && form.branch.trim() !== "",
    createFromQuery: target && needle ? needle : undefined,
    emptyText: discovery?.status === "non-git" ? "Non-Git directory" : "No worktree matches.",
    failure,
    notices: {
      disconnected: connected ? undefined : "Disconnected — showing last observation.",
      discoveryError: discovery?.status === "error" ? discovery.detail : undefined,
    },
  };
}
