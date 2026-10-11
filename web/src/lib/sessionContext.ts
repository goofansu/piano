/**
 * Pure selectors for "where and how is the selected session": its folder, checkout, workspace,
 * project and readiness. Header, palette, sidebar and session view read these instead of each
 * looking the session up in the folder list themselves.
 */
import type { FolderView, Project, ProjectTrust, SessionClosure, SessionReference, Workspace, WorktreeView } from "@shared/wire";
// Relative, not @shared: module tests load this file directly in Node.
import { isWorking } from "../../../shared/sessionProjection.ts";
import type { AppState } from "../store.ts";

type SessionRef = { cwd: string; sessionId: string };

/** The registered folder whose worktrees include `cwd`; undefined once that folder is closed. */
export function folderFor(state: AppState, cwd: string | undefined): FolderView | undefined {
  return cwd === undefined ? undefined : state.folders.find(f => f.worktrees.some(w => w.path === cwd));
}

/** The folder's checkout at `cwd`: its root (the `main` worktree) or one of its worktrees. */
export function checkoutFor(state: AppState, cwd: string | undefined): WorktreeView | undefined {
  return folderFor(state, cwd)?.worktrees.find(w => w.path === cwd);
}

/**
 * The registry's workspace for a directory. The registry keeps a workspace for every folder,
 * worktree and session directory, and keeps it when the folder is closed, so this is the one
 * identity behind both the Changes preview and the session's pull request.
 */
export function workspaceFor(state: AppState, cwd: string | undefined): Workspace | undefined {
  return cwd === undefined ? undefined : state.workspaces.find(w => w.path === cwd);
}

/** Pi's trust outcome for a directory: the latest probe, else what discovery recorded for a known worktree. */
export function directoryTrust(state: AppState, cwd: string): ProjectTrust | undefined {
  return state.trusts[cwd] ?? state.folders.flatMap(f => f.worktrees).find(w => w.path === cwd)?.trust;
}

export interface FocusedDirectory {
  cwd: string;
  /** The selected session's checkout is gone, so Pi cannot be asked about it. */
  checkoutMissing: boolean;
}

/** The directory the main pane is about: the New page's directory, else the selected session's. */
export function focusedDirectory(state: AppState): FocusedDirectory | undefined {
  if (state.view.kind === "new") return state.view.cwd ? { cwd: state.view.cwd, checkoutMissing: false } : undefined;
  const session = state.view.kind === "session" ? state.session : null;
  return session ? { cwd: session.cwd, checkoutMissing: !!session.state.checkoutMissing } : undefined;
}

/** Where slash completion discovers commands; a new revision invalidates pending discovery. */
export interface CompletionTarget {
  cwd: string;
  /** Only for a live child; discovery must not start a saved session. */
  sessionId?: string;
  revision: string;
}

/**
 * Slash completion for the focused directory, once it can be asked: on the New page while
 * connected, for a session once its attachment is ready. The revision changes when the
 * attachment, its child, the directory's trust or its model catalog is replaced.
 */
export function completionTarget(state: AppState): CompletionTarget | undefined {
  const focus = focusedDirectory(state);
  const session = state.view.kind === "session" ? state.session : null;
  if (!focus || !state.connected || (session && !sessionReady(state))) return undefined;
  const revision = [state.selectionId, session?.cursor?.generation, session?.hosted, directoryTrust(state, focus.cwd)?.trusted, state.catalogs[focus.cwd]?.fetchedAt].join(":");
  return { cwd: focus.cwd, sessionId: session?.hosted ? session.sessionId ?? undefined : undefined, revision };
}

/** The registry reference behind a session row, so membership is read from one place. */
export function sessionReference(state: AppState, session: SessionRef): SessionReference | undefined {
  return state.sessionReferences.find(s => s.cwd === session.cwd && s.sessionId === session.sessionId);
}

export function sessionProject(state: AppState, session: SessionRef | null | undefined): Project | undefined {
  const id = session && sessionReference(state, session)?.projectId;
  return id ? state.projects.find(p => p.id === id) : undefined;
}

/** Session actions go out only on a current, settled attachment. */
export function sessionReady(state: AppState): boolean {
  return state.connected && !state.resync && !state.selecting && state.selectionId !== null;
}

/** The session is the one selected or being selected, whose attachment `sessionReady` describes. */
export function isSelectedSession(state: AppState, target: SessionRef): boolean {
  const current = state.session ?? state.selecting;
  return !!current && current.cwd === target.cwd && current.sessionId === target.sessionId;
}

/**
 * Registry mutations (rename, archive, delete) may be sent for this session: always over a live
 * connection, and for the selected session only once its attachment is settled, so a resync or a
 * selection in flight cannot race the change. Other sessions do not wait on the selected one.
 */
export function sessionMutable(state: AppState, target: SessionRef): boolean {
  return state.connected && (!isSelectedSession(state, target) || sessionReady(state));
}

/** Pi cannot run where the checkout or history is gone, and renaming starts Pi. */
export function sessionCheckoutMissing(state: AppState, target: SessionRef): boolean {
  return (state.session?.cwd === target.cwd && !!state.session.state.checkoutMissing) || !!sessionReference(state, target)?.unavailable;
}

/** A worktree's directory without the `folder.` prefix Worktrunk gives it, since the folder is named beside it. */
export function worktreeName(folder: string, path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.startsWith(`${folder}.`) ? base.slice(folder.length + 1) : base;
}

export interface SessionContext {
  /** Session actions may be sent (see `sessionReady`). */
  ready: boolean;
  /** The selected session's directory, or the one a first message is starting in. */
  cwd: string | undefined;
  folder: FolderView | undefined;
  checkout: WorktreeView | undefined;
  /** Folder name, else the directory's last segment; Zed's `folder ⇄ worktree / ⑂ branch`. */
  folderName: string;
  /** `main` for the folder's own checkout, else the worktree's directory name; undefined when not a known checkout. */
  worktreeName: string | undefined;
  /** Git's branch for the selected session's checkout, while discovery is ready. */
  branch: string | undefined;
  title: string;
  sessionId: string | undefined;
  project: Project | undefined;
  /** Registry identity of the selected session's directory: addresses its pull request. */
  workspace: Workspace | undefined;
  /** The workspace Changes previews: none for a non-Git folder. */
  changesWorkspace: Workspace | undefined;
  /** Changes can open: a Git workspace whose checkout is still there. */
  canOpenChanges: boolean;
  checkoutMissing: boolean;
}

/** Everything the header, palette and session view show about the selected session's location. */
export function sessionContext(state: AppState): SessionContext {
  const session = state.session;
  const cwd = session?.cwd ?? state.pendingCreate?.cwd;
  const folder = folderFor(state, cwd);
  const checkout = folder?.worktrees.find(w => w.path === cwd);
  const folderName = folder?.name ?? cwd?.split("/").pop() ?? "";
  const ref = session?.sessionId ? { cwd: session.cwd, sessionId: session.sessionId } : undefined;
  const info = ref && (sessionReference(state, ref) ?? folder?.sessions.find(s => s.cwd === ref.cwd && s.sessionId === ref.sessionId));
  const workspace = workspaceFor(state, session?.cwd);
  const checkoutMissing = !!session?.state.checkoutMissing;
  const changesWorkspace = checkout?.status === "non-git" ? undefined : workspace;
  return {
    ready: sessionReady(state),
    cwd,
    folder,
    checkout,
    folderName,
    worktreeName: checkout && (checkout.root ? "main" : worktreeName(folderName, checkout.path)),
    branch: session && folder?.discovery.status === "ready" ? checkout?.branch ?? undefined : undefined,
    title: session?.state.sessionName || info?.title || "Untitled",
    sessionId: session?.sessionId ?? undefined,
    project: sessionProject(state, ref),
    workspace,
    changesWorkspace,
    canOpenChanges: !!changesWorkspace && !checkoutMissing,
    checkoutMissing,
  };
}

export type ReplyActivity = "starting" | "working";

export interface SessionActivity {
  /** One word or phrase for the session's state, announced to screen readers. */
  status: string;
  /** Pi is streaming, compacting or retrying. */
  streaming: boolean;
  /** What the reply area's Piano keys show, if anything. */
  replyActivity: ReplyActivity | undefined;
  /** Sent but not yet in the transcript: created with a first message, submitting, or running. */
  firstMessageOnItsWay: boolean;
  /** The last input's outcome when it needs words; the running state already says the rest. */
  submissionText: string | undefined;
}

/** The selected session's activity. `display` is the transcript display: Messages hides pending text. */
export function sessionActivity(state: AppState, display: "everything" | "messages"): SessionActivity {
  const t = state.session;
  const input = state.pendingCreate;
  const streaming = !!t && isWorking(t.state);
  const activity = [
    t?.dialogs.length ? "Waiting for input" : null,
    t?.state.isCompacting ? "Compacting" : null,
    t?.state.isRetrying ? "Retrying" : null,
  ].filter(Boolean).join(" · ");
  const submission = t?.state.submission;
  const starting = input?.outcome === "starting";
  let replyActivity: ReplyActivity | undefined;
  // Messages only hides pending text, so it cannot replace the working indicator.
  if (display === "messages" || !t?.pending?.text) {
    if (starting) replyActivity = "starting";
    else if (streaming) replyActivity = "working";
  }
  const inputText = input ? {
    starting: undefined, // The reply area's Piano keys provide startup feedback.
    submitted: undefined,
    handled: "Command handled.",
    rejected: "Message rejected.",
    uncertain: "Delivery uncertain — inspect the session list before deciding whether to send again. Piano will not resend automatically.",
  }[input.outcome] : undefined;
  const submissionText = input ? inputText : (submission ? {
    submitting: "Submitting — waiting for Pi.",
    started: undefined, // Running/ready state already describes the work.
    queued: undefined, // The queue itself shows pending input.
    handled: "Command handled.",
    rejected: "Message rejected.",
    uncertain: "Delivery uncertain — inspect the session and queue before deciding whether to send again. Piano will not resend automatically.",
  }[submission.outcome] : undefined);
  // A dialog the first input opened needs the user, so it outranks startup.
  const status = starting && !t?.dialogs.length ? "Starting"
    : !t && input ? "Delivery uncertain"
    : !state.connected || (t !== null && !sessionReady(state)) ? "Reconnecting"
    : !t ? "Loading"
    : t.state.checkoutMissing ? "Read-only"
    : t.state.closure ? "Exited"
    : activity || (streaming ? "Working" : t.hosted ? "Ready" : "Not running");
  return { status, streaming, replyActivity, firstMessageOnItsWay: !!t && (submission?.outcome === "submitting" || streaming), submissionText };
}

/** Whether a stop needs the person's attention: anything but a quiet release or a clean exit
 * may have cut work short. Toast and banner both follow this, never the display text. */
export const closureNeedsAttention = (closure: SessionClosure | undefined): closure is SessionClosure =>
  !!closure && closure._tag !== "released" && !(closure._tag === "exited" && closure.code === 0);
