import type { FolderView, Project } from "@shared/wire";

/** How the sidebar lists sessions: by folder, project, date, or as one list. */
export type GroupBy = "folder" | "project" | "date" | "none";
export type SortBy = "name" | "recent";
export interface SidebarView {
  groupBy: GroupBy;
  sortBy: SortBy;
  /** Each session row adds a line with its branch, and its folder unless its group names it. */
  folderAndBranch: boolean;
}
export const DEFAULT_SIDEBAR_VIEW: SidebarView = {
  groupBy: "date",
  sortBy: "recent",
  folderAndBranch: false,
};
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

/**
 * The sidebar names each of the last seven local calendar days: Today, Yesterday, then the date
 * ("Oct 29"); anything last touched before that week is Older. Local midnights, not elapsed
 * 24-hour periods: DST days can be shorter or longer.
 */
const NAMED_DAYS = 7;
/** Day headings are English like Today and Yesterday, so one fixed format, not the browser locale. */
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export interface DateGroup {
  /** Stable per calendar day ("2026-10-29") so a collapse remembers that day, not its distance from today. */
  key: string;
  label: string;
}

const localMidnight = (now: Date, daysAgo: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
const isoDay = (day: Date) =>
  [day.getFullYear(), day.getMonth() + 1, day.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, "0"))
    .join("-");

const OLDER: DateGroup = { key: "Older", label: "Older" };
const UNKNOWN: DateGroup = { key: "Unknown date", label: "Unknown date" };

/** Group `bucket`: one per named day back from today, then Older, then Unknown date. */
function groupAt(now: Date, bucket: number): DateGroup {
  if (bucket === 0) return { key: "Today", label: "Today" };
  if (bucket === 1) return { key: "Yesterday", label: "Yesterday" };
  if (bucket === NAMED_DAYS) return OLDER;
  if (bucket > NAMED_DAYS) return UNKNOWN;
  const day = localMidnight(now, bucket);
  return { key: isoDay(day), label: dayFormat.format(day) };
}

/** The bucket of a session last touched at `updatedAt`: days before `now`, or the Older or Unknown date bucket. */
function bucketOf(updatedAt: string | undefined, now: Date): number {
  const time = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (Number.isNaN(time)) return NAMED_DAYS + 1;
  for (let days = 0; days < NAMED_DAYS; days++)
    if (time >= localMidnight(now, days).getTime()) return days;
  return NAMED_DAYS;
}

/** The date group of a session last touched at `updatedAt`, as of `now`. */
export function dateGroup(updatedAt: string | undefined, now = new Date()): DateGroup {
  return groupAt(now, bucketOf(updatedAt, now));
}

/** Listed sessions by local calendar day, newest day first; empty days are omitted and unknown times stay visible last. */
export function dateGroups<S extends SessionLike>(
  sessions: readonly S[],
  sort: SortBy,
  now = new Date(),
): Array<DateGroup & { sessions: S[] }> {
  const buckets = Array.from({ length: NAMED_DAYS + 2 }, () => [] as S[]);
  for (const session of sessions) buckets[bucketOf(session.updatedAt, now)]!.push(session);
  return buckets.flatMap((bucket, index) =>
    bucket.length === 0 ? [] : [{ ...groupAt(now, index), sessions: sortSessions(bucket, sort) }],
  );
}
