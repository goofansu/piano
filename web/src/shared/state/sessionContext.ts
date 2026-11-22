import type {
  FolderView,
  HostInfo,
  Project,
  SessionPullRequestLink,
  SessionReference,
  Workspace,
} from "@shared/wire";
import { sameSession } from "../../../../shared/wire.ts";
import { findProject } from "../lib/projects.ts";
import { type DraftKey, sessionDraftKey } from "./draftKey.ts";
import { sessionDirectories, sessionLabel, sessionOpenable } from "./sessionCatalog.ts";
import { startPage } from "./startPage.ts";
import { type AppState, isSession } from "./state.ts";

export type SessionRef = { cwd: string; sessionId: string };

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
