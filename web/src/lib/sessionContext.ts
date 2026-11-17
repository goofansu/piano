import type {
  FolderView,
  HostInfo,
  Project,
  SessionPullRequestLink,
  SessionReference,
  Workspace,
} from "@shared/wire";
import { isWorking } from "../../../shared/sessionProjection.ts";
import { workUnderWay } from "../../../shared/sessionStatus.ts";
import { sameSession } from "../../../shared/wire.ts";
import { type AppState, isSession } from "../store.ts";
import { directoryTrust } from "./directoryTrust.ts";
import { abbrevHome, branchLabel } from "./format.ts";
import { type DraftKey, sessionDraftKey } from "./messageDraft.ts";
import { findProject } from "./projectCommands.ts";
import { sessionDirectories, sessionLabel, sessionOpenable } from "./sessionCatalog.ts";
import { startPage } from "./startPage.ts";
import { submissionReceipt } from "./submissionReceipt.ts";

export type SessionRef = { cwd: string; sessionId: string };

export type DirectoryTrigger =
  | { kind: "none" }
  | { kind: "checkout"; folder: string; branchLabel?: string }
  | { kind: "path"; label: string };

export interface DirectoryRoot {
  path: string;
  label: string;
  selected: boolean;
}

export interface DirectoryChoices {
  trigger: DirectoryTrigger;
  roots: DirectoryRoot[];
  worktreesFolder: FolderView | undefined;
}

export function startPlace(
  state: AppState,
  cwd: string,
  projectId: string | undefined,
): { project?: string; folder?: string; branch?: string } {
  const { checkout, folderName } = sessionDirectories(state)(cwd || undefined);
  return {
    project: findProject(state, projectId)?.name,
    folder: folderName || undefined,
    branch: checkout?.branch ?? undefined,
  };
}

export function directoryChoices(
  state: AppState,
  cwd: string,
  startsSessionIn: (state: AppState, cwd: string) => boolean,
): DirectoryChoices {
  const { folder, checkout } = sessionDirectories(state)(cwd || undefined);
  const trigger: DirectoryTrigger = !cwd
    ? { kind: "none" }
    : folder && checkout
      ? {
          kind: "checkout",
          folder: folder.name,
          ...(!checkout.root && {
            branchLabel: branchLabel(checkout.branch, checkout.facts?.detached ?? false),
          }),
        }
      : { kind: "path", label: abbrevHome(cwd) };
  const roots = state.folders.flatMap((f) =>
    f.worktrees
      .filter((w) => w.root && startsSessionIn(state, w.path))
      .map((w) => ({
        path: w.path,
        label: f.name,
        selected: w.path === cwd,
      })),
  );
  return { trigger, roots, worktreesFolder: checkout ? folder : undefined };
}

export function workspaceFor(state: AppState, cwd: string | undefined): Workspace | undefined {
  return cwd === undefined ? undefined : state.workspaces.find((w) => w.path === cwd);
}

export function checkoutMissingAt(state: AppState, cwd: string): boolean {
  return (
    (state.session?.cwd === cwd && !!state.session.state.checkoutMissing) ||
    state.sessionReferences.some((r) => r.cwd === cwd && r.unavailable === "checkout") ||
    state.folders.some((f) =>
      f.worktrees.some((w) => w.root && w.path === cwd && w.status === "missing"),
    )
  );
}

export interface FocusedDirectory {
  cwd: string;
  checkoutMissing: boolean;
}

export function focusedDirectory(state: AppState): FocusedDirectory | undefined {
  const page = startPage(state.view);
  if (page)
    return page.cwd
      ? { cwd: page.cwd, checkoutMissing: checkoutMissingAt(state, page.cwd) }
      : undefined;
  const session = state.view.kind === "session" ? state.session : null;
  return session
    ? { cwd: session.cwd, checkoutMissing: checkoutMissingAt(state, session.cwd) }
    : undefined;
}

export interface CompletionTarget {
  cwd: string;
  session?: { workspaceId: string; sessionId: string };
  revision: string;
}

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
  const workspaceId = workspaceFor(state, session.cwd)?.id;
  return workspaceId
    ? { cwd: focus.cwd, session: { workspaceId, sessionId: session.sessionId }, revision }
    : undefined;
}

export function sessionReference(
  state: AppState,
  session: SessionRef,
): SessionReference | undefined {
  return state.sessionReferences.find((s) => sameSession(s, session));
}

export function sessionProject(
  state: AppState,
  session: SessionRef | null | undefined,
): Project | undefined {
  return findProject(state, session && sessionReference(state, session)?.projectId);
}

export function sessionReady(state: AppState): boolean {
  return state.connected && !state.resync && !state.selecting && state.selectionId !== null;
}

export function isSelectedSession(state: AppState, target: SessionRef): boolean {
  const current = state.session ?? state.selecting;
  return isSession(current, target);
}

export function sessionReferenceChangeable(state: AppState, target: SessionRef): boolean {
  const reference = sessionReference(state, target);
  return state.connected && !!reference && !reference.archived;
}

export function sessionMutable(state: AppState, target: SessionRef): boolean {
  return (
    sessionReferenceChangeable(state, target) &&
    (!isSelectedSession(state, target) || sessionReady(state))
  );
}

export function hostOf(state: AppState, target: SessionRef): HostInfo | undefined {
  return state.hosts.find((host) => sameSession(host, target));
}

export function sessionWorking(state: AppState, target: SessionRef): boolean {
  const session = state.session;
  if (session && isSession(session, target)) return workUnderWay(session.state);
  return !!hostOf(state, target)?.working;
}

export function sessionCheckoutMissing(state: AppState, target: SessionRef): boolean {
  const reference = sessionReference(state, target);
  return checkoutMissingAt(state, target.cwd) || (!!reference && !sessionOpenable(reference));
}

export type SessionInputMode =
  | "writable"
  | "not-ready"
  | "starting"
  | "archived"
  | "checkout-missing"
  | "no-session";

export function sessionInputMode(state: AppState): SessionInputMode {
  const t = state.session;
  if (!t) return "no-session";
  if (t.sessionId && sessionReference(state, { cwd: t.cwd, sessionId: t.sessionId })?.archived)
    return "archived";
  if (checkoutMissingAt(state, t.cwd)) return "checkout-missing";
  if (state.pendingCreate?.outcome === "starting") return "starting";
  return sessionReady(state) ? "writable" : "not-ready";
}

const keepsDraft = (mode: SessionInputMode): boolean =>
  mode === "writable" || mode === "not-ready" || mode === "starting";

export interface SessionContext {
  cwd: string | undefined;
  folder: FolderView | undefined;
  folderName: string | undefined;
  branch: string | undefined;
  detachedHead: string | undefined;
  githubRepo: string | undefined;
  branchUrl: string | undefined;
  title: string;
  sessionId: string | undefined;
  workspace: Workspace | undefined;
  changesWorkspace: Workspace | undefined;
  canOpenChanges: boolean;
  changesUnavailable: string | undefined;
  pullRequestTarget: PullRequestTarget | undefined;
  pullRequest: SessionPullRequestLink | null | undefined;
  checkoutMissing: boolean;
  draftKey: DraftKey | null;
}

export interface PullRequestTarget {
  workspaceId: string;
  sessionId: string;
}

export function sessionContext(state: AppState): SessionContext {
  const session = state.session;
  const cwd = session?.cwd ?? state.pendingCreate?.cwd;
  const ref = session?.sessionId ? { cwd: session.cwd, sessionId: session.sessionId } : undefined;
  const reference = ref && sessionReference(state, ref);
  const { folder, checkout, folderName } = sessionDirectories(state)(cwd);
  const workspace = workspaceFor(state, session?.cwd);
  const checkoutMissing = !!session && checkoutMissingAt(state, session.cwd);
  const changesWorkspace = checkout?.status === "non-git" ? undefined : workspace;
  const canOpenChanges = !!changesWorkspace && !checkoutMissing;
  const branch = reference?.branch ?? undefined;
  const github = checkout?.facts?.branch === branch ? checkout?.facts?.github : undefined;
  return {
    cwd,
    folder,
    folderName: cwd === undefined ? undefined : folderName,
    branch,
    detachedHead:
      checkout?.status === "current" && checkout.facts?.detached ? checkout.facts.head : undefined,
    githubRepo: folder?.discovery.status === "ready" ? folder.discovery.githubRepo : undefined,
    branchUrl: github
      ? `https://github.com/${github.repo}/tree/${github.branch.split("/").map(encodeURIComponent).join("/")}`
      : undefined,
    title: sessionLabel(session?.state.sessionName || reference?.title),
    sessionId: session?.sessionId ?? undefined,
    workspace,
    changesWorkspace,
    canOpenChanges,
    changesUnavailable:
      !session || canOpenChanges
        ? undefined
        : checkoutMissing
          ? "Checkout removed"
          : workspace && !changesWorkspace
            ? "Not a Git repository"
            : "Changes unavailable",
    pullRequestTarget:
      canOpenChanges && changesWorkspace && session?.sessionId
        ? { workspaceId: changesWorkspace.id, sessionId: session.sessionId }
        : undefined,
    pullRequest: reference?.pullRequest,
    checkoutMissing,
    draftKey: session && keepsDraft(sessionInputMode(state)) ? sessionDraftKey(session) : null,
  };
}

export interface SessionPlace {
  name: string;
  repository: boolean;
  ref: { kind: "branch" | "commit"; name: string } | undefined;
}

export function sessionPlace({
  folderName,
  githubRepo,
  branch,
  detachedHead,
}: Pick<SessionContext, "folderName" | "githubRepo" | "branch" | "detachedHead">):
  | SessionPlace
  | undefined {
  if (folderName === undefined) return undefined;
  return {
    name: githubRepo ?? folderName,
    repository: githubRepo !== undefined,
    ref: detachedHead
      ? { kind: "commit", name: detachedHead.slice(0, 10) }
      : branch
        ? { kind: "branch", name: branch }
        : undefined,
  };
}

export type ReplyActivity = "starting" | "working";

export interface SessionActivity {
  status: string;
  replyActivity: ReplyActivity | undefined;
}

export function sessionActivity(state: AppState, messagesOnly: boolean): SessionActivity {
  const t = state.session;
  const mode = sessionInputMode(state);
  const receipt = submissionReceipt(state);
  const streaming = !!t && isWorking(t.state);
  const working = !!t && workUnderWay(t.state);
  const activity = [
    t?.dialogs.length ? "Waiting for input" : null,
    t?.state.isCompacting ? "Compacting" : null,
    t?.state.isRetrying ? "Retrying" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const starting = receipt?.phase === "starting";
  let replyActivity: ReplyActivity | undefined;
  if (messagesOnly || !t?.pending?.text) {
    if (starting) replyActivity = "starting";
    else if (streaming) replyActivity = "working";
  }
  const status =
    starting && !t?.dialogs.length
      ? "Starting"
      : !t && receipt
        ? receipt.phase === "rejected"
          ? "Message rejected"
          : receipt.phase === "not_sent"
            ? "Not sent"
            : "Delivery uncertain"
        : !state.connected || (t !== null && !sessionReady(state))
          ? "Reconnecting"
          : !t
            ? "Loading"
            : mode === "archived"
              ? "Archived"
              : mode === "checkout-missing"
                ? "Read-only"
                : t.state.closure
                  ? "Exited"
                  : activity || (working ? "Working" : t.hosted ? "Ready" : "Not running");
  return { status, replyActivity };
}

export interface SessionPane {
  list: boolean;
  skeleton: boolean;
  placeholder: string | undefined;
  composerDisabled: boolean;
  editorDisabled: boolean;
}

const inputOnItsWay = (t: NonNullable<AppState["session"]>): boolean =>
  t.state.submission?.outcome === "submitting" || isWorking(t.state);

export function sessionPane(state: AppState): SessionPane {
  const t = state.session;
  const input = state.pendingCreate;
  const onItsWay = !!t && inputOnItsWay(t);
  const hasContent = !!t && (t.messages.length > 0 || !!t.pending);
  const mode = sessionInputMode(state);
  return {
    list: !!t || !!input,
    skeleton: !input && !state.selectionFailure && !(t && (hasContent || !onItsWay)),
    placeholder: t && !input && !hasContent && !onItsWay ? "No messages yet." : undefined,
    composerDisabled: mode !== "writable",
    editorDisabled: mode !== "writable" && mode !== "not-ready",
  };
}
