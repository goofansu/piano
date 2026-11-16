import type { FolderView, Project, SessionReference, WorktreeView } from "@shared/wire";
import { type AppState, isSession, sessionKey } from "../store.ts";
import { findProject } from "./projectCommands.ts";

export type SessionActivity = "working" | "done" | "idle" | "off";

export interface SessionEntry {
  cwd: string;
  sessionId: string;
  title: string | undefined;
  label: string;
  createdAt: string;
  updatedAt: string;
  folderPath: string | undefined;
  folder: string;
  branch: string;
  projectId: string | undefined;
  project: Project | undefined;
  archived: boolean;
  pinned: boolean;
  listed: boolean;
  activity: SessionActivity;
  selected: boolean;
  unavailable: SessionReference["unavailable"];
  hint: string | undefined;
  disabled: boolean;
}

export function sessionLabel(title: string | undefined): string {
  return title || "Untitled";
}

export function sessionOpenable(ref: Pick<SessionReference, "unavailable">): boolean {
  return ref.unavailable !== "history";
}

export const HISTORY_UNAVAILABLE = {
  title: "History unavailable",
  description: "Restore the Pi session file to open it.",
} as const;

export const SESSION_ARCHIVED = "Session archived";

export type SessionAddress =
  | { kind: "select"; cwd: string; sessionId: string }
  | { kind: "unavailable"; reason: "missing" | "history" | "archived" };

export function sessionAddress(
  state: Pick<AppState, "sessionReferences">,
  sessionId: string,
): SessionAddress {
  const ref = state.sessionReferences.find((r) => r.sessionId === sessionId);
  if (!ref) return { kind: "unavailable", reason: "missing" };
  if (ref.archived) return { kind: "unavailable", reason: "archived" };
  if (!sessionOpenable(ref)) return { kind: "unavailable", reason: "history" };
  return { kind: "select", cwd: ref.cwd, sessionId };
}

const HINTS = {
  history: `${HISTORY_UNAVAILABLE.title}. ${HISTORY_UNAVAILABLE.description}`,
  checkout: "Folder missing. History can be read; restore the folder to continue.",
} as const;

export interface SessionDirectory {
  folder: FolderView | undefined;
  checkout: WorktreeView | undefined;
  folderName: string;
}

export function sessionDirectories(state: AppState): (cwd: string | undefined) => SessionDirectory {
  const folderOf = new Map<string, FolderView>();
  for (const f of state.folders)
    for (const w of f.worktrees) if (!folderOf.has(w.path)) folderOf.set(w.path, f);
  return (cwd) => {
    const folder = cwd === undefined ? undefined : folderOf.get(cwd);
    const checkout = folder?.worktrees.find((w) => w.path === cwd);
    const folderName =
      folder?.name ?? (cwd === undefined ? "" : cwd.split("/").filter(Boolean).at(-1) || cwd);
    return { folder, checkout, folderName };
  };
}

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
    const { folder, folderName } = directoryOf(ref.cwd);
    const project = findProject(state, ref.projectId);
    const host = hosts.get(key);
    return {
      cwd: ref.cwd,
      sessionId: ref.sessionId,
      title: ref.title,
      label: host?.starting ? "Starting" : sessionLabel(ref.title),
      createdAt: ref.createdAt,
      updatedAt: ref.updatedAt,
      folderPath: folder?.path,
      folder: folderName,
      branch: ref.branch ?? "",
      projectId: ref.projectId,
      project,
      archived: ref.archived,
      pinned: !!ref.pinned,
      listed: !ref.archived && (!!folder || !!project),
      activity: host?.working ? "working" : done.has(key) ? "done" : host ? "idle" : "off",
      selected: isSession(current, ref),
      unavailable: ref.unavailable,
      hint: ref.unavailable && HINTS[ref.unavailable],
      disabled: !!host?.starting || !sessionOpenable(ref),
    };
  });
}

export function sessionCatalog(state: AppState): SessionEntry[] {
  return entries(state).filter((s) => !s.archived);
}

export function archivedSessionCatalog(state: AppState): SessionEntry[] {
  return entries(state)
    .filter((s) => s.archived)
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

export function inSidebarGroups(s: Pick<SessionEntry, "listed" | "pinned">): boolean {
  return s.listed && !s.pinned;
}

export function recentSessions(state: AppState): SessionEntry[] {
  return sessionCatalog(state)
    .filter((s) => !s.disabled)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

export function catalogEntry(state: AppState, sessionId: string): SessionEntry | undefined {
  return entries(state).find((s) => s.sessionId === sessionId);
}

export interface SessionDestination {
  sessionId: string;
  cwd: string;
  label: string;
}

export function sessionDestination(
  state: AppState,
  sessionId: string,
): SessionDestination | "unlisted" {
  if (sessionAddress(state, sessionId).kind !== "select") return "unlisted";
  const entry = catalogEntry(state, sessionId);
  return entry && !entry.disabled ? { sessionId, cwd: entry.cwd, label: entry.label } : "unlisted";
}
