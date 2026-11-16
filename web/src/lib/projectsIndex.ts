import type { Project } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { isProjectDone } from "./projectCommands.ts";
import { sessionCatalog } from "./sessionCatalog.ts";
import { byName } from "./sidebarView.ts";

export interface ProjectsIndexRow {
  project: Project;
  folders: string[];
  count: number;
  updatedAt: string | undefined;
}

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

export function projectsIndexContext(row: ProjectsIndexRow): string {
  if (row.count === 0) return "No sessions yet";
  const count = row.count === 1 ? "1 session" : `${row.count} sessions`;
  return `${row.folders.join(", ")} · ${count}`;
}
