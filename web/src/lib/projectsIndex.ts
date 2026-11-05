/**
 * The Projects index, from what the browser already holds: every project with the folders its
 * sessions run in, how many sessions it has and when one last moved. It sends no request, reads no
 * Git, starts no Pi and opens no history. The index is for scanning: a row carries no state; that
 * lives on the project's home, except done, which is the index's own grouping: done projects sit
 * in their own group below the open ones.
 */
import { isProjectDone, type Project } from "../../../shared/wire.ts";
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
 * then one row per open project, newest activity first, with projects without sessions last, by
 * name; and under Done, one row per done project, the most recently marked done first.
 */
export type ProjectsIndexView =
  | { kind: "loading" }
  | { kind: "index"; rows: ProjectsIndexRow[]; done: ProjectsIndexRow[] };

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
  const all = state.projects.map((project): ProjectsIndexRow => {
    const m = members.get(project.id);
    return {
      project,
      folders: m?.folders ?? [],
      count: m?.count ?? 0,
      updatedAt: m?.updatedAt,
    };
  });
  const rows = all.filter((r) => !isProjectDone(r.project));
  rows.sort((a, b) => {
    if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    if (a.updatedAt || b.updatedAt) return a.updatedAt ? -1 : 1;
    return byName(a.project.name, b.project.name);
  });
  const done = all.filter((r) => isProjectDone(r.project));
  done.sort(
    (a, b) =>
      (b.project.doneAt ?? "").localeCompare(a.project.doneAt ?? "") ||
      byName(a.project.name, b.project.name),
  );
  return { kind: "index", rows, done };
}

/** A row's context line: the folders and the count ("piano, api · 3 sessions"), or that it is empty. */
export function projectsIndexContext(row: ProjectsIndexRow): string {
  if (row.count === 0) return "No sessions yet";
  const count = row.count === 1 ? "1 session" : `${row.count} sessions`;
  return `${row.folders.join(", ")} · ${count}`;
}
