/**
 * The session catalog: which sessions exist and how each one appears. The sidebar groups it,
 * the command palette ranks it, and routing and the document title look sessions up in it.
 * Each entry is one registry reference, placed in its open folder and joined with the host
 * broadcast, the only source of running state.
 */
import type { FolderView, Project, SessionReference, WorktreeView } from "@shared/wire";
import { type AppState, isSession, sessionKey } from "../store.ts";
import { findProject } from "./projectCommands.ts";

/** Working: Pi is streaming. Done: finished while not on screen. Idle: running, waiting. Off: no process. */
export type SessionActivity = "working" | "done" | "idle" | "off";

export interface SessionEntry {
  cwd: string;
  sessionId: string;
  /** The registry's saved title, raw: what Rename edits. */
  title: string | undefined;
  /** What the session is called on screen (see `sessionLabel`). */
  label: string;
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

/**
 * What a session is called on screen, wherever it is named: its title, else "Untitled". The
 * fallback is display copy only; Rename starts from the raw title, never from this.
 */
export function sessionLabel(title: string | undefined): string {
  return title || "Untitled";
}

const HINTS = {
  history: "History unavailable. Restore the Pi session file to open it.",
  checkout: "Folder missing. History can be read; restore the folder to continue.",
} as const;

/**
 * Where a session runs: its directory placed among the registered folders. Only that; project
 * membership is independent of the directory (see the glossary), so callers read the project,
 * title and saved branch from the session's reference.
 */
export interface SessionDirectory {
  /** The registered folder holding the directory; undefined once that folder is closed. */
  folder: FolderView | undefined;
  /** The folder's checkout at the directory. */
  checkout: WorktreeView | undefined;
  /** The folder's name, else the directory's last segment; empty without a directory. */
  folderName: string;
  /** A linked worktree's directory name; undefined for the folder's own checkout. */
  worktreeName: string | undefined;
}

/** A worktree's directory without the `folder.` prefix Worktrunk gives it, since the folder is named beside it. */
export function worktreeName(folder: string, path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.startsWith(`${folder}.`) ? base.slice(folder.length + 1) : base;
}

/**
 * Places session directories among `state`'s folders: catalog rows and the selected session's
 * header both read where a session runs from this. A directory is known before the session's
 * reference is (a first message on its way), so this takes the directory alone.
 */
export function sessionDirectories(state: AppState): (cwd: string | undefined) => SessionDirectory {
  const folderOf = new Map<string, FolderView>();
  // The first folder listing a directory holds it, as `folderFor` answers.
  for (const f of state.folders)
    for (const w of f.worktrees) if (!folderOf.has(w.path)) folderOf.set(w.path, f);
  return (cwd) => {
    const folder = cwd === undefined ? undefined : folderOf.get(cwd);
    const checkout = folder?.worktrees.find((w) => w.path === cwd);
    const folderName = folder?.name ?? cwd?.split("/").pop() ?? "";
    return {
      folder,
      checkout,
      folderName,
      worktreeName:
        checkout && !checkout.root ? worktreeName(folderName, checkout.path) : undefined,
    };
  };
}

/**
 * The registered folder whose worktrees include `cwd`, the first one listing it, as
 * `sessionDirectories` places it; undefined once that folder is closed. One lookup scans the
 * folders instead of indexing them all.
 */
export function folderFor(state: AppState, cwd: string | undefined): FolderView | undefined {
  return cwd === undefined
    ? undefined
    : state.folders.find((f) => f.worktrees.some((w) => w.path === cwd));
}

function entries(state: AppState): SessionEntry[] {
  const directoryOf = sessionDirectories(state);
  const hosts = new Map(state.hosts.map((h) => [sessionKey(h), h]));
  const done = new Set(state.done);
  const current = state.session ?? state.selecting;
  return state.sessionReferences.map((ref) => {
    const key = sessionKey(ref);
    const { folder, folderName, worktreeName } = directoryOf(ref.cwd);
    const project = findProject(state, ref.projectId);
    const host = hosts.get(key);
    return {
      cwd: ref.cwd,
      sessionId: ref.sessionId,
      title: ref.title,
      label: sessionLabel(ref.title),
      createdAt: ref.createdAt,
      updatedAt: ref.updatedAt,
      folderPath: folder?.path,
      folder: folderName,
      branch: ref.branch ?? "",
      inWorktree: worktreeName !== undefined,
      projectId: ref.projectId,
      project,
      archived: ref.archived,
      pinned: !!ref.pinned,
      listed: !ref.archived && (!!folder || !!project),
      activity: host?.streaming ? "working" : done.has(key) ? "done" : host ? "idle" : "off",
      selected: isSession(current, ref),
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

/** Whether the sidebar's groups hold a session: listed and not pinned, since Pinned holds those. */
export function inSidebarGroups(s: Pick<SessionEntry, "listed" | "pinned">): boolean {
  return s.listed && !s.pinned;
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

/** Where a session opens: its catalog directory, and what a link to it says. */
export interface SessionDestination {
  sessionId: string;
  cwd: string;
  label: string;
}

/**
 * Whether a session can be opened, and where: the one rule every link to a session follows. A
 * session opens when the catalog offers it (it is not archived, as `sessionCatalog` decides for
 * the sidebar and palette) and its history is there, at the catalog's directory; otherwise it is
 * "unlisted" and nothing offers to open it. A `/s/<id>` address resolves through `catalogEntry`
 * instead, so it still names an archived session.
 */
export function sessionDestination(
  state: AppState,
  sessionId: string,
): SessionDestination | "unlisted" {
  const entry = sessionCatalog(state).find((s) => s.sessionId === sessionId);
  return entry && !entry.disabled ? { sessionId, cwd: entry.cwd, label: entry.label } : "unlisted";
}
