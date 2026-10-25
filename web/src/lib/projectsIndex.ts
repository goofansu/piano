/**
 * The Projects index, from what the browser already holds: every project with the folders its
 * sessions run in, how many sessions it has and when one last moved. It sends no request, reads no
 * Git, starts no Pi and opens no history. The index is for scanning: a row carries no state; that
 * lives on the project's home.
 */
import type { Project } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { sessionCatalog } from "./sessionCatalog.ts";
import { byName } from "./sidebarView.ts";

export interface ProjectsIndexRow {
  project: Project;
  /** Names of the folders its sessions run in, the most recently active first, each once. */
  folders: string[];
  /** Member sessions, archived ones left out. */
  count: number;
  /** The newest member's last activity; undefined for a project without sessions. */
  updatedAt: string | undefined;
}

/**
 * What `/projects` shows: `loading` until the first registry message says which projects exist,
 * then one row per project, newest activity first. Projects without sessions come last, by name.
 */
export type ProjectsIndexView = { kind: "loading" } | { kind: "index"; rows: ProjectsIndexRow[] };

export function projectsIndex(state: AppState): ProjectsIndexView {
  if (!state.registryLoaded) return { kind: "loading" };
  const members = new Map<string, { folders: string[]; count: number; updatedAt: string }>();
  const sessions = sessionCatalog(state).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const s of sessions) {
    if (!s.projectId) continue;
    const m = members.get(s.projectId) ?? { folders: [], count: 0, updatedAt: s.updatedAt };
    m.count++;
    if (!m.folders.includes(s.folder)) m.folders.push(s.folder);
    members.set(s.projectId, m);
  }
  const rows = state.projects.map((project): ProjectsIndexRow => {
    const m = members.get(project.id);
    return {
      project,
      folders: m?.folders ?? [],
      count: m?.count ?? 0,
      updatedAt: m?.updatedAt,
    };
  });
  rows.sort((a, b) => {
    if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    if (a.updatedAt || b.updatedAt) return a.updatedAt ? -1 : 1;
    return byName(a.project.name, b.project.name);
  });
  return { kind: "index", rows };
}

/** A row's context line: the folders and the count ("piano, api · 3 sessions"), or that it is empty. */
export function projectsIndexContext(row: ProjectsIndexRow): string {
  if (row.count === 0) return "No sessions yet";
  const count = row.count === 1 ? "1 session" : `${row.count} sessions`;
  return `${row.folders.join(", ")} · ${count}`;
}
