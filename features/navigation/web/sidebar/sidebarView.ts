import type { FolderView, Project } from "@shared/wire";
import { byName } from "../../../../web/src/shared/lib/byName.ts";
import { isProjectDone } from "../../../../web/src/shared/lib/projects.ts";
import type { SortBy } from "../../../../web/src/shared/navigation/sidebarPreferences.ts";

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
export function sortSessions<T extends SessionLike>(sessions: readonly T[], sort: SortBy): T[] {
  return order(
    sessions,
    sort,
    (s) => s.title ?? "￿",
    (s) => s.updatedAt ?? "",
  );
}

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
export function projectGroups<
  P extends Pick<Project, "id" | "name" | "doneAt">,
  S extends SessionLike & { projectId?: string },
>(
  projects: readonly P[],
  sessions: readonly S[],
  sort: SortBy,
): { open: Array<SessionGroup<P, S>>; done: Array<SessionGroup<P, S>> } {
  const group = (project: P): SessionGroup<P, S> => ({
    project,
    sessions: sortSessions(
      sessions.filter((s) => s.projectId === project.id),
      sort,
    ),
  });
  const az = (a: SessionGroup<P, S>, b: SessionGroup<P, S>) =>
    byName(a.project?.name ?? "", b.project?.name ?? "");
  const ungrouped: SessionGroup<P, S> = {
    project: null,
    sessions: sortSessions(
      sessions.filter((s) => !s.projectId),
      sort,
    ),
  };
  return {
    open: [
      ...projects
        .filter((p) => !isProjectDone(p))
        .map(group)
        .sort(az),
      ungrouped,
    ],
    done: projects.filter(isProjectDone).map(group).sort(az),
  };
}

const NAMED_DAYS = 7;
const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export interface DateGroup {
  key: string;
  label: string;
}

export const localMidnight = (date: Date, days = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const isoDay = (day: Date) =>
  [day.getFullYear(), day.getMonth() + 1, day.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, "0"))
    .join("-");

const OLDER: DateGroup = { key: "Older", label: "Older" };
const UNKNOWN: DateGroup = { key: "Unknown date", label: "Unknown date" };

function groupAt(now: Date, bucket: number): DateGroup {
  if (bucket === NAMED_DAYS) return OLDER;
  if (bucket > NAMED_DAYS) return UNKNOWN;
  const day = localMidnight(now, -bucket);
  const label =
    bucket === 0
      ? "Today"
      : bucket === 1
        ? "Yesterday"
        : dayFormat.format(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
  return { key: isoDay(day), label };
}

function bucketOf(updatedAt: string | undefined, now: Date): number {
  const time = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (Number.isNaN(time)) return NAMED_DAYS + 1;
  for (let days = 0; days < NAMED_DAYS; days++)
    if (time >= localMidnight(now, -days).getTime()) return days;
  return NAMED_DAYS;
}

export function dateGroup(updatedAt: string | undefined, now = new Date()): DateGroup {
  return groupAt(now, bucketOf(updatedAt, now));
}

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
