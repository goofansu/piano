/**
 * Pure selectors for "where and how is the selected session": its folder, checkout, workspace,
 * project and readiness. Header, palette, sidebar and session view read these instead of each
 * looking the session up in the folder list themselves.
 */
import type {
  FolderView,
  Project,
  SessionClosure,
  SessionReference,
  Workspace,
  WorktreeView,
} from "@shared/wire";
// Relative, not @shared: module tests load this file directly in Node.
import { isWorking } from "../../../shared/sessionProjection.ts";
import type { AppState } from "../store.ts";
import { directoryTrust } from "./directoryTrust.ts";
import { abbrevHome } from "./format.ts";
import { type DraftKey, sessionDraftKey } from "./messageDraft.ts";
import { findProject } from "./projectCommands.ts";
import { folderFor, sessionLocator } from "./sessionCatalog.ts";
import { submissionReceipt } from "./submissionReceipt.ts";

type SessionRef = { cwd: string; sessionId: string };

// Where a session runs is the catalog's to decide; the folder lookup is re-exported for its callers.
export { folderFor };

/** What the New session directory picker's trigger names. */
export type DirectoryTrigger =
  | { kind: "none" }
  /** A registered checkout: its folder, plus its branch unless it is the folder's root. */
  | { kind: "checkout"; folder: string; branchLabel?: string }
  /** A directory no registered folder contains, as a home-abbreviated path. */
  | { kind: "path"; label: string };

export interface DirectoryRoot {
  path: string;
  /** The folder's name. */
  label: string;
  /** The root checkout is gone, so no session can start there. */
  disabled: boolean;
  selected: boolean;
}

export interface DirectoryChoices {
  trigger: DirectoryTrigger;
  /** Every registered folder's root checkout. */
  roots: DirectoryRoot[];
  /** The folder whose worktrees the picker offers: only when `cwd` is one of its checkouts. */
  worktreesFolder: FolderView | undefined;
}

/** The New session directory picker: its trigger, folder roots and the folder its Worktrees open. */
export function directoryChoices(state: AppState, cwd: string): DirectoryChoices {
  const folder = folderFor(state, cwd);
  const checkout = folder?.worktrees.find((w) => w.path === cwd);
  const trigger: DirectoryTrigger = !cwd
    ? { kind: "none" }
    : folder && checkout
      ? {
          kind: "checkout",
          folder: folder.name,
          ...(!checkout.root && {
            branchLabel:
              checkout.branch ?? (checkout.facts?.detached ? "Detached HEAD" : "Unknown branch"),
          }),
        }
      : { kind: "path", label: abbrevHome(cwd) };
  const roots = state.folders.flatMap((f) =>
    f.worktrees
      .filter((w) => w.root)
      .map((w) => ({
        path: w.path,
        label: f.name,
        disabled: w.status === "missing",
        selected: w.path === cwd,
      })),
  );
  return { trigger, roots, worktreesFolder: checkout ? folder : undefined };
}

/**
 * The registry's workspace for a directory. The registry keeps a workspace for every folder,
 * worktree and session directory, and keeps it when the folder is closed, so this is the one
 * identity behind both the Changes preview and the session's pull request.
 */
export function workspaceFor(state: AppState, cwd: string | undefined): Workspace | undefined {
  return cwd === undefined ? undefined : state.workspaces.find((w) => w.path === cwd);
}

export interface FocusedDirectory {
  cwd: string;
  /** The selected session's checkout is gone, so Pi cannot be asked about it. */
  checkoutMissing: boolean;
}

/** The directory the main pane is about: the New page's directory, else the selected session's. */
export function focusedDirectory(state: AppState): FocusedDirectory | undefined {
  if (state.view.kind === "new")
    return state.view.cwd ? { cwd: state.view.cwd, checkoutMissing: false } : undefined;
  const session = state.view.kind === "session" ? state.session : null;
  return session
    ? { cwd: session.cwd, checkoutMissing: !!session.state.checkoutMissing }
    : undefined;
}

/** Where slash completion discovers commands; a new revision invalidates pending discovery. */
export interface CompletionTarget {
  cwd: string;
  /** Only for a live child, addressed by its registry IDs; discovery must not start a saved session. */
  session?: { workspaceId: string; sessionId: string };
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
  const revision = [
    state.selectionId,
    session?.cursor?.generation,
    session?.hosted,
    directoryTrust(state, focus.cwd)?.trusted,
    state.catalogs[focus.cwd]?.fetchedAt,
  ].join(":");
  if (!session?.hosted || !session.sessionId) return { cwd: focus.cwd, revision };
  // A running session answers only for itself; until its workspace is known there is nothing to ask.
  const workspaceId = workspaceFor(state, session.cwd)?.id;
  return workspaceId
    ? { cwd: focus.cwd, session: { workspaceId, sessionId: session.sessionId }, revision }
    : undefined;
}

/** The registry reference behind a session row, so membership is read from one place. */
export function sessionReference(
  state: AppState,
  session: SessionRef,
): SessionReference | undefined {
  return state.sessionReferences.find(
    (s) => s.cwd === session.cwd && s.sessionId === session.sessionId,
  );
}

export function sessionProject(
  state: AppState,
  session: SessionRef | null | undefined,
): Project | undefined {
  return findProject(state, session && sessionReference(state, session)?.projectId);
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

/** Activity for either the selected session or a background session in the sidebar. */
export function sessionWorking(state: AppState, target: SessionRef): boolean {
  const session = state.session;
  if (session?.cwd === target.cwd && session.sessionId === target.sessionId)
    return isWorking(session.state) || session.state.submission?.outcome === "submitting";
  return state.hosts.some(
    (host) => host.cwd === target.cwd && host.sessionId === target.sessionId && host.streaming,
  );
}

/** Pi cannot run where the checkout or history is gone, and renaming starts Pi. */
export function sessionCheckoutMissing(state: AppState, target: SessionRef): boolean {
  return (
    (state.session?.cwd === target.cwd && !!state.session.state.checkoutMissing) ||
    !!sessionReference(state, target)?.unavailable
  );
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
  /** Linked worktree's directory name; omitted for the folder's own checkout. */
  worktreeName: string | undefined;
  /** The shared session branch: Git's when listed, otherwise the branch Piano registered. */
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
  /**
   * The selected session's draft while its composer takes input; `null` once it is read-only, so
   * quoting, Ask and extensions cannot add to a draft nobody can see or send.
   */
  draftKey: DraftKey | null;
}

/** Everything the header, palette and session view show about the selected session's location. */
export function sessionContext(state: AppState): SessionContext {
  const session = state.session;
  // Before the session exists, a first message is on its way in the directory it starts in.
  const cwd = session?.cwd ?? state.pendingCreate?.cwd;
  const ref = session?.sessionId ? { cwd: session.cwd, sessionId: session.sessionId } : undefined;
  const location = sessionLocator(state)(cwd, ref && sessionReference(state, ref));
  const { folder, checkout } = location;
  const workspace = workspaceFor(state, session?.cwd);
  const checkoutMissing = !!session?.state.checkoutMissing;
  const changesWorkspace = checkout?.status === "non-git" ? undefined : workspace;
  return {
    ready: sessionReady(state),
    cwd,
    folder,
    checkout,
    folderName: location.folderName,
    worktreeName: location.worktreeName,
    branch: location.branch,
    // Pi's live name outranks the registry's saved title.
    title: session?.state.sessionName || location.title || "Untitled",
    sessionId: session?.sessionId ?? undefined,
    project: location.project,
    workspace,
    changesWorkspace,
    canOpenChanges: !!changesWorkspace && !checkoutMissing,
    checkoutMissing,
    draftKey: session && !checkoutMissing ? sessionDraftKey(session) : null,
  };
}

export type ReplyActivity = "starting" | "working";

export interface SessionActivity {
  /** One word or phrase for the session's state, announced to screen readers. */
  status: string;
  /** What the reply area's Piano keys show, if anything. */
  replyActivity: ReplyActivity | undefined;
}

/** The selected session's activity. `messagesOnly` is the transcript display, which hides pending text. */
export function sessionActivity(state: AppState, messagesOnly: boolean): SessionActivity {
  const t = state.session;
  const receipt = submissionReceipt(state);
  const streaming = !!t && isWorking(t.state);
  const activity = [
    t?.dialogs.length ? "Waiting for input" : null,
    t?.state.isCompacting ? "Compacting" : null,
    t?.state.isRetrying ? "Retrying" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const starting = receipt?.phase === "starting";
  let replyActivity: ReplyActivity | undefined;
  // Messages only hides pending text, so it cannot replace the working indicator.
  if (messagesOnly || !t?.pending?.text) {
    if (starting) replyActivity = "starting";
    else if (streaming) replyActivity = "working";
  }
  // A dialog the first input opened needs the user, so it outranks startup.
  const status =
    starting && !t?.dialogs.length
      ? "Starting"
      : !t && receipt
        ? receipt.phase === "rejected"
          ? "Message rejected"
          : "Delivery uncertain"
        : !state.connected || (t !== null && !sessionReady(state))
          ? "Reconnecting"
          : !t
            ? "Loading"
            : t.state.checkoutMissing
              ? "Read-only"
              : t.state.closure
                ? "Exited"
                : activity || (streaming ? "Working" : t.hosted ? "Ready" : "Not running");
  return { status, replyActivity };
}

export interface SessionPane {
  /** The transcript is mounted: the selected session's, or a first message shown before it. */
  list: boolean;
  /**
   * The loading skeleton shows while the session is fetched or its first input is on its way.
   * It never shows for a first message or a failed selection, which show instead, nor once the
   * transcript or its empty state can show.
   */
  skeleton: boolean;
  /** The empty transcript's text; omitted while anything is shown or on its way. */
  placeholder: string | undefined;
  composerDisabled: boolean;
}

/**
 * Pi has the session's input but it is not in the transcript yet: submitting or running. Pi's own
 * submission, not the browser's receipt: only Pi's input reaches the transcript.
 */
const inputOnItsWay = (t: NonNullable<AppState["session"]>): boolean =>
  t.state.submission?.outcome === "submitting" || isWorking(t.state);

/**
 * What the main session pane shows while the session loads or a first message is on its way
 * (INV-03): the browser's submitted input renders at once outside Pi's history, an ordinary
 * history load uses the skeleton, and "No messages yet." only describes a settled empty session.
 */
export function sessionPane(state: AppState): SessionPane {
  const t = state.session;
  const input = state.pendingCreate;
  const onItsWay = !!t && inputOnItsWay(t);
  const hasContent = !!t && (t.messages.length > 0 || !!t.pending);
  return {
    list: !!t || !!input,
    skeleton: !input && !state.selectionFailure && !(t && (hasContent || !onItsWay)),
    placeholder: t && !input && !hasContent && !onItsWay ? "No messages yet." : undefined,
    composerDisabled: !sessionReady(state) || !t || input?.outcome === "starting",
  };
}

/** Whether a stop needs the person's attention: anything but a quiet release or a clean exit
 * may have cut work short. Toast and banner both follow this, never the display text. */
export const closureNeedsAttention = (
  closure: SessionClosure | undefined,
): closure is SessionClosure =>
  !!closure && closure._tag !== "released" && !(closure._tag === "exited" && closure.code === 0);
