import type { OutcomeProject, ProjectView, SessionInfo, SessionReference } from "@shared/wire";

/** How the sidebar lists sessions: under their folders, under their projects, or as one list. */
export type GroupBy = "folder" | "project" | "none";
export type SortBy = "name" | "recent";
export interface SidebarView { groupBy: GroupBy; sortBy: SortBy }
export const DEFAULT_SIDEBAR_VIEW: SidebarView = { groupBy: "folder", sortBy: "recent" };
export const GROUP_BY: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "folder", label: "Folder" },
  { value: "project", label: "Project" },
  { value: "none", label: "None" },
];
export const SORT_BY: ReadonlyArray<{ value: SortBy; label: string }> = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Last activity" },
];

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
/** ISO timestamps order as text; nothing known sorts last. */
const latest = (times: Iterable<string | undefined>) => {
  let max = "";
  for (const time of times) if (time && time > max) max = time;
  return max;
};
const byActivity = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

function order<T>(items: readonly T[], sort: SortBy, name: (item: T) => string, activity: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, name: name(item), activity: sort === "recent" ? activity(item) : "" }))
    .sort((a, b) => byActivity(a.activity, b.activity) || byName(a.name, b.name) || a.index - b.index)
    .map(({ item }) => item);
}

type SessionLike = { title?: string; updatedAt?: string };
/** Untitled sessions follow titled ones by name; ties keep the given order. */
export function sortSessions<T extends SessionLike>(sessions: readonly T[], sort: SortBy): T[] {
  return order(sessions, sort, s => s.title ?? "￿", s => s.updatedAt ?? "");
}

/** Folders in the chosen order, each with its sessions in that order. A folder's activity is its latest session. */
export function folderGroups<T extends Pick<ProjectView, "name" | "sessions">>(folders: readonly T[], sort: SortBy): T[] {
  return order(folders.map(f => ({ ...f, sessions: sortSessions(f.sessions, sort) })), sort, f => f.name, f => latest(f.sessions.map(s => s.updatedAt)));
}

export interface ProjectGroup<P, S> { project: P | null; sessions: S[] }
/**
 * Projects in the chosen order, then one group for the listed sessions that belong to no project.
 * Members come from the registry references, so a member whose folder was closed still appears.
 */
export function projectGroups<P extends Pick<OutcomeProject, "id" | "name">, R extends Pick<SessionReference, "cwd" | "sessionId" | "outcomeProjectId" | "title" | "updatedAt">, S extends Pick<SessionInfo, "cwd" | "sessionId" | "title" | "updatedAt">>(
  projects: readonly P[], references: readonly R[], listed: readonly S[], sort: SortBy,
): Array<ProjectGroup<P, R> | ProjectGroup<P, S>> {
  const groups = projects.map((project): ProjectGroup<P, R> => ({ project, sessions: sortSessions(references.filter(s => s.outcomeProjectId === project.id), sort) }));
  const filed = new Set(references.filter(s => s.outcomeProjectId).map(s => `${s.cwd}\n${s.sessionId}`));
  const ungrouped: ProjectGroup<P, S> = { project: null, sessions: sortSessions(listed.filter(s => !filed.has(`${s.cwd}\n${s.sessionId}`)), sort) };
  return [...order(groups, sort, g => g.project?.name ?? "", g => latest(g.sessions.map(s => s.updatedAt))), ungrouped];
}

/** Every listed session as one list. */
export function flatSessions<S extends SessionLike>(folders: ReadonlyArray<{ sessions: readonly S[] }>, sort: SortBy): S[] {
  return sortSessions(folders.flatMap(f => f.sessions), sort);
}
