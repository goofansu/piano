import type { FolderView, Project } from "@shared/wire";

/** How the sidebar lists sessions: by folder, project, date, or as one list. */
export type GroupBy = "folder" | "project" | "date" | "none";
export type SortBy = "name" | "recent";
export interface SidebarView {
  groupBy: GroupBy;
  sortBy: SortBy;
}
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

/** The one name order: case-insensitive, with numbers by value ("Q2" before "Q10"). */
const nameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const byName = (a: string, b: string) => nameCollator.compare(a, b);
/** ISO timestamps order as text; nothing known sorts last. */
const byActivity = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

function order<T>(
  items: readonly T[],
  sort: SortBy,
  name: (item: T) => string,
  activity: (item: T) => string,
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      name: name(item),
      activity: sort === "recent" ? activity(item) : "",
    }))
    .sort(
      (a, b) => byActivity(a.activity, b.activity) || byName(a.name, b.name) || a.index - b.index,
    )
    .map(({ item }) => item);
}

type SessionLike = { title?: string; updatedAt?: string };
/** Untitled sessions follow titled ones by name; ties keep the given order. */
export function sortSessions<T extends SessionLike>(sessions: readonly T[], sort: SortBy): T[] {
  return order(
    sessions,
    sort,
    (s) => s.title ?? "￿",
    (s) => s.updatedAt ?? "",
  );
}

/** Folders always A–Z; the selected sort applies only to sessions inside each folder. */
export function folderGroups<
  F extends Pick<FolderView, "path" | "name">,
  S extends SessionLike & { folderPath?: string },
>(
  folders: readonly F[],
  sessions: readonly S[],
  sort: SortBy,
): Array<{ folder: F; sessions: S[] }> {
  const groups = folders.map((folder) => ({
    folder,
    sessions: sortSessions(
      sessions.filter((s) => s.folderPath === folder.path),
      sort,
    ),
  }));
  return groups.sort((a, b) => byName(a.folder.name, b.folder.name));
}

export interface SessionGroup<P, S> {
  project: P | null;
  sessions: S[];
}
/**
 * Projects always A–Z, then No project; the selected sort applies only to sessions inside each group.
 * A member whose folder was closed is still listed (see the session catalog), so it still appears.
 */
export function projectGroups<
  P extends Pick<Project, "id" | "name">,
  S extends SessionLike & { projectId?: string },
>(projects: readonly P[], sessions: readonly S[], sort: SortBy): Array<SessionGroup<P, S>> {
  const groups = projects.map(
    (project): SessionGroup<P, S> => ({
      project,
      sessions: sortSessions(
        sessions.filter((s) => s.projectId === project.id),
        sort,
      ),
    }),
  );
  const ungrouped: SessionGroup<P, S> = {
    project: null,
    sessions: sortSessions(
      sessions.filter((s) => !s.projectId),
      sort,
    ),
  };
  return [
    ...groups.sort((a, b) => byName(a.project?.name ?? "", b.project?.name ?? "")),
    ungrouped,
  ];
}

/** The date groups in list order; a session falls in the first whose boundary it reaches. */
export const DATE_LABELS = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
  "Unknown date",
] as const;
export type DateLabel = (typeof DATE_LABELS)[number];

/** The date group of a session last touched at `updatedAt`, as of `now`. */
export function dateLabel(updatedAt: string | undefined, now = new Date()): DateLabel {
  const time = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (Number.isNaN(time)) return "Unknown date";
  // Local midnights, not elapsed 24-hour periods: DST days can be shorter or longer.
  const boundaries = [0, 1, 7, 30].map((days) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime(),
  );
  const bucket = boundaries.findIndex((boundary) => time >= boundary);
  return DATE_LABELS[bucket === -1 ? 4 : bucket]!;
}

/** Listed sessions by local calendar date; unknown times stay visible last. */
export function dateGroups<S extends SessionLike>(
  sessions: readonly S[],
  sort: SortBy,
  now = new Date(),
): Array<{ label: DateLabel; sessions: S[] }> {
  const groups = DATE_LABELS.map((label) => ({ label, sessions: [] as S[] }));
  for (const session of sessions)
    groups[DATE_LABELS.indexOf(dateLabel(session.updatedAt, now))]!.sessions.push(session);
  return groups
    .filter((g) => g.sessions.length > 0)
    .map((g) => ({ ...g, sessions: sortSessions(g.sessions, sort) }));
}
