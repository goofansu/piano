/**
 * The session catalog: which sessions exist and how each one appears. The sidebar groups it,
 * the command palette ranks it, and routing and the document title look sessions up in it.
 * Each entry is one registry reference, placed in its open folder and joined with the host
 * broadcast, the only source of running state.
 */
import type { FolderView, Project, SessionReference, WorktreeView } from "@shared/wire";
import { type AppState, sessionKey } from "../store.ts";
import { findProject } from "./projectCommands.ts";

/** Working: Pi is streaming. Done: finished while not on screen. Idle: running, waiting. Off: no process. */
export type SessionActivity = "working" | "done" | "idle" | "off";

export interface SessionEntry {
  cwd: string;
  sessionId: string;
  title: string | undefined;
  createdAt: string;
  updatedAt: string;
  /** The registered folder holding the session's directory; undefined once that folder is closed. */
  folderPath: string | undefined;
  /** The folder's name, else the directory's last segment. */
  folder: string;
  /** Git's branch for the session's checkout; empty when unknown. */
  branch: string;
  /** The session runs in one of the folder's worktrees, not the folder's own checkout. */
  inWorktree: boolean;
  projectId: string | undefined;
  /** The project the session belongs to, when that project exists. */
  project: Project | undefined;
  archived: boolean;
  pinned: boolean;
  /**
   * Eligible for regular sidebar groups: its folder is open, or it belongs to an active project.
   * Pinned sessions appear separately above these groups even when their folder is closed.
   * A closed folder takes its unfiled sessions out of the sidebar; project members stay, under
   * every grouping, since membership does not depend on where a session runs.
   */
  listed: boolean;
  activity: SessionActivity;
  /** The session on screen, or the one being opened. */
  selected: boolean;
  unavailable: SessionReference["unavailable"];
  /** Why the session cannot be used normally, for its tooltip and screen readers. */
  hint: string | undefined;
  /** Its history is gone, so it cannot be opened. */
  disabled: boolean;
}

const HINTS = {
  history: "History unavailable. Restore the Pi session file to open it.",
  checkout: "Folder missing. History can be read; restore the folder to continue.",
} as const;

/** Where a session runs and what the registry calls it: the one reading of a session reference. */
export interface SessionLocation {
  /** The registered folder holding the directory; undefined once that folder is closed. */
  folder: FolderView | undefined;
  /** The folder's checkout at the directory. */
  checkout: WorktreeView | undefined;
  /** The folder's name, else the directory's last segment; empty without a directory. */
  folderName: string;
  /** A linked worktree's directory name; undefined for the folder's own checkout. */
  worktreeName: string | undefined;
  /** The reference's branch (Git's, or the one saved for a worktree Git no longer lists). */
  branch: string | undefined;
  /** The project the session belongs to, when that project exists. */
  project: Project | undefined;
  /** The registry's title, if any. */
  title: string | undefined;
}

/** A worktree's directory without the `folder.` prefix Worktrunk gives it, since the folder is named beside it. */
export function worktreeName(folder: string, path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.startsWith(`${folder}.`) ? base.slice(folder.length + 1) : base;
}

/**
 * Locates sessions in `state`: catalog rows and the selected session's header both read where a
 * session runs from this. `cwd` is the session's directory, known before its reference is (a first
 * message on its way); `ref` is its registry reference once there is one.
 */
export function sessionLocator(
  state: AppState,
): (cwd: string | undefined, ref: SessionReference | undefined) => SessionLocation {
  const folderOf = new Map<string, FolderView>();
  // The first folder listing a directory holds it, as `folderFor` answers.
  for (const f of state.folders)
    for (const w of f.worktrees) if (!folderOf.has(w.path)) folderOf.set(w.path, f);
  return (cwd, ref) => {
    const folder = cwd === undefined ? undefined : folderOf.get(cwd);
    const checkout = folder?.worktrees.find((w) => w.path === cwd);
    const folderName = folder?.name ?? cwd?.split("/").pop() ?? "";
    return {
      folder,
      checkout,
      folderName,
      worktreeName:
        checkout && !checkout.root ? worktreeName(folderName, checkout.path) : undefined,
      branch: ref?.branch ?? undefined,
      project: findProject(state, ref?.projectId),
      title: ref?.title,
    };
  };
}

/** The registered folder whose worktrees include `cwd`; undefined once that folder is closed. */
export function folderFor(state: AppState, cwd: string | undefined): FolderView | undefined {
  return sessionLocator(state)(cwd, undefined).folder;
}

function entries(state: AppState): SessionEntry[] {
  const locate = sessionLocator(state);
  const hosts = new Map(state.hosts.map((h) => [sessionKey(h), h]));
  const done = new Set(state.done);
  const current = state.session ?? state.selecting;
  return state.sessionReferences.map((ref) => {
    const key = sessionKey(ref);
    const { folder, folderName, worktreeName, branch, project, title } = locate(ref.cwd, ref);
    const host = hosts.get(key);
    return {
      cwd: ref.cwd,
      sessionId: ref.sessionId,
      title,
      createdAt: ref.createdAt,
      updatedAt: ref.updatedAt,
      folderPath: folder?.path,
      folder: folderName,
      branch: branch ?? "",
      inWorktree: worktreeName !== undefined,
      projectId: ref.projectId,
      project,
      archived: ref.archived,
      pinned: !!ref.pinned,
      listed: !ref.archived && (!!folder || (!!project && !project.archived)),
      activity: host?.streaming ? "working" : done.has(key) ? "done" : host ? "idle" : "off",
      selected: !!current && current.cwd === ref.cwd && current.sessionId === ref.sessionId,
      unavailable: ref.unavailable,
      hint: ref.unavailable && HINTS[ref.unavailable],
      disabled: ref.unavailable === "history",
    };
  });
}

/** Every session that is not archived, display-ready. `listed` says which ones the sidebar shows. */
export function sessionCatalog(state: AppState): SessionEntry[] {
  return entries(state).filter((s) => !s.archived);
}

/** The palette's order: every session that is not archived, newest created first, wherever its folder is. */
export function recentSessions(state: AppState): SessionEntry[] {
  return sessionCatalog(state).sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
  );
}

/** One session by its ID, archived or not: what a `/s/<id>` address resolves to. */
export function catalogEntry(state: AppState, sessionId: string): SessionEntry | undefined {
  return entries(state).find((s) => s.sessionId === sessionId);
}

/** Where a session opens: its catalog directory and title. */
export interface SessionDestination {
  sessionId: string;
  cwd: string;
  title: string;
}

/**
 * Whether a session can be opened, and where: the one rule every link to a session follows. A
 * session opens when the catalog knows it and its history is there, at the catalog's directory;
 * otherwise it is "unlisted" and nothing offers to open it.
 */
export function sessionDestination(
  state: AppState,
  sessionId: string,
): SessionDestination | "unlisted" {
  const entry = catalogEntry(state, sessionId);
  return entry && !entry.disabled
    ? { sessionId, cwd: entry.cwd, title: entry.title || "Untitled" }
    : "unlisted";
}
