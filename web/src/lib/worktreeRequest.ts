/**
 * One deliberate worktree operation in the picker: creating a branch or selecting a discovered
 * checkout. A request is sent once and never retried automatically; it ends with its own receipt
 * (matched by request ID), a timeout or a lost connection, and the last two tell the user to
 * rediscover before retrying because the checkout may already have changed. Discovery of the
 * folder's worktrees travels with it, since rediscovery resets the operation. Pure and React-free;
 * the picker dispatches events, sends the returned command and runs the timer.
 */
import type { ClientCommand, ServerMessage, WorktreeFacts } from "@shared/wire";

export type WorktreeRequestKind = "create" | "select";

export type WorktreeRequestStatus =
  | { status: "idle" }
  | { status: "pending"; requestId: string; kind: WorktreeRequestKind }
  | { status: "failed"; detail: string };

export interface WorktreeRequest {
  request: WorktreeRequestStatus;
  /** Discovery was requested and has not answered yet. */
  refreshing: boolean;
}

export const initialWorktreeRequest: WorktreeRequest = { request: { status: "idle" }, refreshing: false };

/** How long a pending operation waits for its receipt before failing. */
export const RECEIPT_TIMEOUT_MS = 75_000;

export type WorktreeIntent =
  | { kind: "create"; folder: string; branch: string; hooks: boolean }
  | { kind: "select"; folder: string; path: string };

export type WorktreeEvent =
  /** `requestId` is supplied by the caller so the transition stays pure. */
  | { type: "start"; intent: WorktreeIntent; requestId: string }
  | { type: "receipt"; receipt: Extract<ServerMessage, { _tag: "worktree_result" }> | null }
  | { type: "timeout" }
  | { type: "disconnected" }
  /** Ask the folder's repository again, keeping the operation's outcome on screen. */
  | { type: "refresh"; folder: string | undefined }
  /** The picker opened on a folder: forget any operation and discover afresh. */
  | { type: "rediscover"; folder: string | undefined }
  /** Discovery answered. */
  | { type: "answered" }
  /** The user moved on from a failure. */
  | { type: "dismiss" };

export interface WorktreeTransition {
  state: WorktreeRequest;
  /** Send exactly this, once. */
  command?: ClientCommand;
  /** The operation succeeded with this checkout. */
  ready?: string;
}

const NO_RECEIPT = "No creation/selection receipt. Refresh discovery and inspect the checkout before retrying; it may already exist.";
const CONNECTION_LOST = "Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout.";

const command = (intent: WorktreeIntent, requestId: string): ClientCommand => intent.kind === "create"
  ? { _tag: "create_worktree", requestId, folder: intent.folder, branch: intent.branch, hooks: intent.hooks }
  : { _tag: "add_worktree", requestId, folder: intent.folder, path: intent.path };

const discover = (state: WorktreeRequest, folder: string | undefined): WorktreeTransition =>
  folder ? { state: { ...state, refreshing: true }, command: { _tag: "worktrees", folder } } : { state };

export function transition(state: WorktreeRequest, event: WorktreeEvent): WorktreeTransition {
  const pending = state.request.status === "pending" ? state.request : undefined;
  switch (event.type) {
    case "start":
      if (pending) return { state };
      return { state: { ...state, request: { status: "pending", requestId: event.requestId, kind: event.intent.kind } }, command: command(event.intent, event.requestId) };
    case "receipt": {
      if (!pending || event.receipt?.requestId !== pending.requestId) return { state };
      const { result } = event.receipt;
      if (result.status === "error") return { state: { ...state, request: { status: "failed", detail: result.detail } } };
      return { state: { ...state, request: { status: "idle" } }, ready: result.path };
    }
    case "timeout":
      return pending ? { state: { ...state, request: { status: "failed", detail: NO_RECEIPT } } } : { state };
    case "disconnected":
      return pending ? { state: { ...state, request: { status: "failed", detail: CONNECTION_LOST } } } : { state };
    case "refresh":
      return discover(state, event.folder);
    case "rediscover":
      return discover({ ...state, request: { status: "idle" } }, event.folder);
    case "answered":
      return { state: { ...state, refreshing: false } };
    case "dismiss":
      return state.request.status === "failed" ? { state: { ...state, request: { status: "idle" } } } : { state };
  }
}

export const worktreeLabel = (worktree: WorktreeFacts) => worktree.branch ?? worktree.path.split("/").filter(Boolean).at(-1) ?? "Detached HEAD";

/** Literal matching avoids unrelated fuzzy hits and preserves discovery order. */
export function filterWorktrees(all: readonly WorktreeFacts[], query: string): readonly WorktreeFacts[] {
  const needle = query.trim().toLowerCase();
  return needle ? all.filter(w => [worktreeLabel(w), w.path].some(text => text.toLowerCase().includes(needle))) : all;
}
