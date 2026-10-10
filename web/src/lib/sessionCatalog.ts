/**
 * The session catalog: which sessions exist and how each one appears. The sidebar groups it,
 * the command palette ranks it, and routing and the document title look sessions up in it,
 * instead of each joining the registry references, folder rows and host broadcast themselves.
 */
import type { FolderView, Project, SessionReference } from "@shared/wire";
import { type AppState, sessionKey } from "../store.ts";

/** Working: Pi is streaming. Done: finished while not on screen. Idle: running, waiting. Off: no process. */
export type SessionActivity = "working" | "done" | "idle" | "off";

export interface SessionEntry {
  cwd: string;
  sessionId: string;
  title: string | undefined;
  createdAt: string | undefined;
  updatedAt: string | undefined;
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
  /**
   * Shown in the sidebar: its folder is open, or it belongs to a project that is not archived.
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

function entries(state: AppState): SessionEntry[] {
  const folderOf = new Map<string, FolderView>();
  for (const f of state.folders) for (const w of f.worktrees) folderOf.set(w.path, f);
  const listedInfo = new Map(state.folders.flatMap(f => f.sessions).map(s => [sessionKey(s), s]));
  const projects = new Map(state.projects.map(p => [p.id, p]));
  const hosts = new Map(state.hosts.map(h => [sessionKey(h), h]));
  const done = new Set(state.done);
  const current = state.session ?? state.selecting;
  // Every reference, then any folder row the registry has not referenced (a stale broadcast).
  const known = new Set(state.sessionReferences.map(sessionKey));
  const rows: Array<SessionReference & { createdAt?: string }> = [
    ...state.sessionReferences,
    ...[...listedInfo.values()].filter(s => !known.has(sessionKey(s))).map(s => ({ ...s, archived: false })),
  ];
  return rows.map(ref => {
    const key = sessionKey(ref);
    const info = listedInfo.get(key);
    const folder = folderOf.get(ref.cwd);
    const checkout = folder?.worktrees.find(w => w.path === ref.cwd);
    const project = ref.projectId ? projects.get(ref.projectId) : undefined;
    const host = hosts.get(key);
    return {
      cwd: ref.cwd,
      sessionId: ref.sessionId,
      title: ref.title ?? info?.title,
      createdAt: info?.createdAt ?? ref.createdAt,
      updatedAt: ref.updatedAt ?? info?.updatedAt,
      folderPath: folder?.path,
      folder: folder?.name ?? ref.cwd.split("/").pop() ?? ref.cwd,
      branch: info?.branch ?? checkout?.branch ?? "",
      inWorktree: !!checkout && !checkout.root,
      projectId: ref.projectId,
      project,
      archived: ref.archived,
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
  return entries(state).filter(s => !s.archived);
}

/** One session by its ID, archived or not: what a `/s/<id>` address resolves to. */
export function catalogEntry(state: AppState, sessionId: string): SessionEntry | undefined {
  return entries(state).find(s => s.sessionId === sessionId);
}
