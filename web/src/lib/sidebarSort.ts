import type { OutcomeProject, ProjectView, SessionReference } from "@shared/wire";

/** How a sidebar section orders its groups. "added" is the registry's own order. */
export type SidebarSort = "added" | "name" | "recent";
export type SidebarSection = "projects" | "repositories";
export const SIDEBAR_SORTS: ReadonlyArray<{ value: SidebarSort; label: string }> = [
  { value: "added", label: "Order added" },
  { value: "name", label: "Name" },
  { value: "recent", label: "Recent activity" },
];
export const DEFAULT_SIDEBAR_SORT: SidebarSort = "added";

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
/** ISO timestamps order as text; a group with no activity sorts last. */
const latest = (times: Iterable<string | undefined>) => {
  let max = "";
  for (const time of times) if (time && time > max) max = time;
  return max;
};

function order<T>(items: readonly T[], sort: SidebarSort, name: (item: T) => string, activity: (item: T) => string): T[] {
  if (sort === "added") return [...items];
  return items
    .map((item, index) => ({ item, index, name: name(item), activity: sort === "recent" ? activity(item) : "" }))
    .sort((a, b) => (a.activity < b.activity ? 1 : a.activity > b.activity ? -1 : 0) || byName(a.name, b.name) || a.index - b.index)
    .map(({ item }) => item);
}

/** A repository's activity is its most recently updated session. */
export function sortRepositories<T extends Pick<ProjectView, "name" | "sessions">>(repositories: readonly T[], sort: SidebarSort): T[] {
  return order(repositories, sort, r => r.name, r => latest(r.sessions.map(s => s.updatedAt)));
}

/** A project's activity is its most recently updated member session. */
export function sortOutcomeProjects<T extends Pick<OutcomeProject, "id" | "name">>(
  projects: readonly T[], references: ReadonlyArray<Pick<SessionReference, "outcomeProjectId" | "updatedAt">>, sort: SidebarSort,
): T[] {
  return order(projects, sort, p => p.name, p => latest(references.filter(s => s.outcomeProjectId === p.id).map(s => s.updatedAt)));
}
