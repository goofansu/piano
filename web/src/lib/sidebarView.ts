import type { FolderView, Project, SessionInfo, SessionReference } from "@shared/wire";

/** How the sidebar lists sessions: by folder, project, date, or as one list. */
export type GroupBy = "folder" | "project" | "date" | "none";
export type SortBy = "name" | "recent";
export interface SidebarView { groupBy: GroupBy; sortBy: SortBy }
export const DEFAULT_SIDEBAR_VIEW: SidebarView = { groupBy: "date", sortBy: "recent" };
export const GROUP_BY: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "date", label: "Date" },
  { value: "folder", label: "Folder" },
  { value: "project", label: "Project" },
  { value: "none", label: "None" },
];
/** Choices are alphabetical by label, with no grouping last. */
export const SORT_BY: ReadonlyArray<{ value: SortBy; label: string }> = [
  { value: "recent", label: "Activity" },
  { value: "name", label: "Name" },
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
export function folderGroups<T extends Pick<FolderView, "name" | "sessions">>(folders: readonly T[], sort: SortBy): T[] {
  return order(folders.map(f => ({ ...f, sessions: sortSessions(f.sessions, sort) })), sort, f => f.name, f => latest(f.sessions.map(s => s.updatedAt)));
}

export interface SessionGroup<P, S> { project: P | null; sessions: S[] }
/**
 * Projects in the chosen order, then one group for the listed sessions that belong to no project.
 * Members come from the registry references, so a member whose folder was closed still appears.
 */
export function projectGroups<P extends Pick<Project, "id" | "name">, R extends Pick<SessionReference, "cwd" | "sessionId" | "projectId" | "title" | "updatedAt">, S extends Pick<SessionInfo, "cwd" | "sessionId" | "title" | "updatedAt">>(
  projects: readonly P[], references: readonly R[], listed: readonly S[], sort: SortBy,
): Array<SessionGroup<P, R> | SessionGroup<P, S>> {
  const groups = projects.map((project): SessionGroup<P, R> => ({ project, sessions: sortSessions(references.filter(s => s.projectId === project.id), sort) }));
  const filed = new Set(references.filter(s => s.projectId).map(s => `${s.cwd}\n${s.sessionId}`));
  const ungrouped: SessionGroup<P, S> = { project: null, sessions: sortSessions(listed.filter(s => !filed.has(`${s.cwd}\n${s.sessionId}`)), sort) };
  return [...order(groups, sort, g => g.project?.name ?? "", g => latest(g.sessions.map(s => s.updatedAt))), ungrouped];
}

/** Listed sessions across folders, by local calendar date; unknown times stay visible last. */
export function dateGroups<S extends SessionLike>(folders: ReadonlyArray<{ sessions: readonly S[] }>, sort: SortBy, now = new Date()): Array<{ label: string; sessions: S[] }> {
  const labels = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older", "Unknown date"];
  const groups = labels.map(label => ({ label, sessions: [] as S[] }));
  // Local midnights, not elapsed 24-hour periods: DST days can be shorter or longer.
  const boundaries = [0, 1, 7, 30].map(days => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime());
  for (const session of folders.flatMap(f => f.sessions)) {
    const time = session.updatedAt ? Date.parse(session.updatedAt) : Number.NaN;
    const bucket = Number.isNaN(time) ? 5 : boundaries.findIndex(boundary => time >= boundary);
    groups[bucket === -1 ? 4 : bucket]!.sessions.push(session);
  }
  return groups.filter(g => g.sessions.length > 0).map(g => ({ ...g, sessions: sortSessions(g.sessions, sort) }));
}

/** Every listed session as one list. */
export function flatSessions<S extends SessionLike>(folders: ReadonlyArray<{ sessions: readonly S[] }>, sort: SortBy): S[] {
  return sortSessions(folders.flatMap(f => f.sessions), sort);
}
