import type { FolderView, Project } from "@shared/wire";
import type { AppState } from "../store.ts";
import { machineMemory } from "./machineMemory.ts";
import {
  createPreference,
  type Preference,
  type PreferenceStorage,
  parseJson,
} from "./preference.ts";
import { isProjectDone } from "./projectCommands.ts";
import { folderFor, inSidebarGroups, type SessionEntry, sessionCatalog } from "./sessionCatalog.ts";
import { sessionReference } from "./sessionContext.ts";
import {
  dateGroup,
  dateGroups,
  folderGroups,
  localMidnight,
  projectGroups,
  type SidebarView,
  sortSessions,
} from "./sidebarView.ts";

export const PINNED = "pinned";

export type SessionRowDetails = "branch" | "folder-and-branch";

export interface PinnedSection {
  key: typeof PINNED;
  open: boolean;
  sessions: SessionEntry[];
  details: SessionRowDetails | undefined;
}

export type SidebarSection = { details: SessionRowDetails | undefined } & (
  | { kind: "folder"; key: string; open: boolean; folder: FolderView; sessions: SessionEntry[] }
  | {
      kind: "project";
      key: string;
      open: boolean;
      project: Project | null;
      done: boolean;
      sessions: SessionEntry[];
    }
  | { kind: "date"; key: string; open: boolean; label: string; sessions: SessionEntry[] }
);

export type ProjectSection = Extract<SidebarSection, { kind: "project" }>;

export type SidebarBody =
  | { kind: "loading" }
  | { kind: "empty"; text: string }
  | { kind: "sections"; sections: SidebarSection[]; done: ProjectSection[] };

export interface SidebarList {
  pinned: PinnedSection | null;
  body: SidebarBody | null;
}

export function adjacentSidebarSession(
  list: SidebarList,
  current: { cwd: string; sessionId: string | null } | null,
  direction: -1 | 1,
): SessionEntry | undefined {
  const rows = [
    ...(list.pinned?.open ? list.pinned.sessions : []),
    ...(list.body?.kind === "sections"
      ? [...list.body.sections, ...list.body.done].flatMap((s) => (s.open ? s.sessions : []))
      : []),
  ];
  const selected = rows.findIndex(
    (row) => row.cwd === current?.cwd && row.sessionId === current.sessionId,
  );
  const start = selected < 0 && direction === -1 ? rows.length : selected;
  for (let i = start + direction; i >= 0 && i < rows.length; i += direction) {
    if (!rows[i].disabled) return rows[i];
  }
  return undefined;
}

export interface SidebarClock {
  now: () => Date;
  wakeAfter: (ms: number, wake: () => void) => () => void;
  onResume: (wake: () => void) => () => void;
}

export interface SidebarPreferences {
  openGroups: Preference<readonly string[]>;
  closedGroups: Preference<readonly string[]>;
  pinnedOpen: Preference<boolean>;
}

const keyList = (raw: string | null): readonly string[] => {
  const stored = parseJson(raw);
  return Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : [];
};

export function sidebarPreferences(
  machineId: string,
  storage?: PreferenceStorage,
): SidebarPreferences {
  return {
    openGroups: machineMemory(machineId, "openGroups", storage).preference<readonly string[]>({
      decode: keyList,
    }),
    closedGroups: createPreference<readonly string[]>({
      key: "piano.closedGroups",
      decode: keyList,
      storage,
    }),
    pinnedOpen: createPreference<boolean>({
      key: "piano.pinnedOpen",
      decode: (raw) => parseJson(raw) !== false,
      storage,
    }),
  };
}

export interface SidebarListEnvironment {
  clock: SidebarClock;
  preferences: SidebarPreferences;
}

export interface SidebarListModel {
  list: (state: AppState, view: SidebarView) => SidebarList;
  sync: (state: AppState, view: SidebarView) => void;
  toggle: (key: string, open: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
}

const NO_FOLDERS = "No folders yet. Start a session in any folder and it appears here.";
const NO_SESSIONS = "No sessions yet. Start one and it appears here.";

const projectKey = (id: string) => `project:${id}`;
const dateKey = (group: string) => `date:${group}`;
const isDateKey = (key: string) => key.startsWith("date:");

function selectedKey(list: SidebarList): string | undefined {
  if (list.pinned?.sessions.some((s) => s.selected)) return PINNED;
  if (list.body?.kind !== "sections") return undefined;
  const section = [...list.body.sections, ...list.body.done].find((s) =>
    s.sessions.some((row) => row.selected),
  );
  return section?.key;
}

function startingKey(state: AppState, cwd: string, view: SidebarView, today: Date) {
  switch (view.groupBy) {
    case "folder":
      return folderFor(state, cwd)?.path;
    case "date":
      return dateKey(dateGroup(today.toISOString(), today).key);
    default:
      return undefined;
  }
}

function rowDetails(
  view: SidebarView,
  sessions: readonly SessionEntry[],
  folderNamed = false,
): SessionRowDetails | undefined {
  if (!view.folderAndBranch) return undefined;
  if (!folderNamed) return "folder-and-branch";
  return sessions.some((s) => s.branch) ? "branch" : undefined;
}

function buildList(
  state: AppState,
  view: SidebarView,
  today: Date,
  isOpen: (key: string) => boolean,
): SidebarList {
  if (!state.registryLoaded) return { pinned: null, body: { kind: "loading" } };
  const catalog = sessionCatalog(state);
  const pinnedSessions = sortSessions(
    catalog.filter((s) => s.pinned),
    view.sortBy,
  );
  const pinned: PinnedSection | null =
    pinnedSessions.length > 0
      ? {
          key: PINNED,
          open: isOpen(PINNED),
          sessions: pinnedSessions,
          details: rowDetails(view, pinnedSessions),
        }
      : null;
  const listed = catalog.filter(inSidebarGroups);
  const empty = (text: string): SidebarList => ({
    pinned,
    body: pinned ? null : { kind: "empty", text },
  });
  const sections = (list: SidebarSection[], done: ProjectSection[] = []): SidebarList => ({
    pinned,
    body: { kind: "sections", sections: list, done },
  });

  switch (view.groupBy) {
    case "folder":
      if (state.folders.length === 0) return empty(NO_FOLDERS);
      return sections(
        folderGroups(state.folders, listed, view.sortBy).map(({ folder, sessions }) => ({
          kind: "folder",
          key: folder.path,
          open: isOpen(folder.path),
          folder,
          sessions,
          details: rowDetails(view, sessions, true),
        })),
      );
    case "project": {
      const groups = projectGroups(state.projects, listed, view.sortBy);
      if (state.projects.length === 0 && groups.open.every((g) => g.sessions.length === 0))
        return empty(NO_SESSIONS);
      const section =
        (done: boolean) =>
        ({ project, sessions }: (typeof groups.open)[number]): ProjectSection => {
          const key = projectKey(project?.id ?? "");
          const details = rowDetails(view, sessions);
          return { kind: "project", key, open: isOpen(key), project, done, sessions, details };
        };
      return sections(groups.open.map(section(false)), groups.done.map(section(true)));
    }
    case "date": {
      const groups = dateGroups(listed, view.sortBy, today);
      if (groups.length === 0) return empty(NO_SESSIONS);
      return sections(
        groups.map(({ key: group, label, sessions }) => {
          const key = dateKey(group);
          const details = rowDetails(view, sessions);
          return { kind: "date", key, open: isOpen(key), label, sessions, details };
        }),
      );
    }
  }
}

export function createSidebarList({
  clock,
  preferences,
}: SidebarListEnvironment): SidebarListModel {
  let open: ReadonlySet<string> = new Set(preferences.openGroups.get());
  let closed: ReadonlySet<string> = new Set(preferences.closedGroups.get());
  let today = localMidnight(clock.now());
  let revealed: string | null = null;
  let projects: ReadonlySet<string> | null = null;
  let doneProjects: ReadonlySet<string> | null = null;
  const listeners = new Set<() => void>();
  let cache: {
    facts: Pick<
      AppState,
      "registryLoaded" | "folders" | "sessionReferences" | "projects" | "hosts" | "done"
    >;
    cwd: string | undefined;
    sessionId: string | null | undefined;
    view: SidebarView;
    open: ReadonlySet<string>;
    closed: ReadonlySet<string>;
    pinnedOpen: boolean;
    today: Date;
    list: SidebarList;
  } | null = null;

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const isOpen = (key: string, pinnedOpen: boolean) =>
    key === PINNED ? pinnedOpen : isDateKey(key) ? !closed.has(key) : open.has(key);
  const setOpen = (keys: readonly string[], value: boolean) => {
    if (keys.includes(PINNED)) preferences.pinnedOpen.set(value);
    const pinnedOpen = preferences.pinnedOpen.get();
    const changed = keys.filter((k) => k !== PINNED && isOpen(k, pinnedOpen) !== value);
    if (changed.length === 0) return;
    const nextOpen = new Set(open);
    const nextClosed = new Set(closed);
    for (const key of changed) {
      const [set, add] = isDateKey(key) ? [nextClosed, !value] : [nextOpen, value];
      if (add) set.add(key);
      else set.delete(key);
    }
    if (nextOpen.size !== open.size) {
      open = nextOpen;
      preferences.openGroups.set([...open]);
    }
    if (nextClosed.size !== closed.size) {
      closed = nextClosed;
      preferences.closedGroups.set([...closed]);
    }
    notify();
  };
  const refreshDay = () => {
    const day = localMidnight(clock.now());
    if (day.getTime() === today.getTime()) return;
    today = day;
    notify();
  };

  const list: SidebarListModel["list"] = (state, view) => {
    const pinnedOpen = preferences.pinnedOpen.get();
    const current = state.session ?? state.selecting;
    const { registryLoaded, folders, sessionReferences, projects, hosts, done } = state;
    if (
      cache?.facts.registryLoaded === registryLoaded &&
      cache.facts.folders === folders &&
      cache.facts.sessionReferences === sessionReferences &&
      cache.facts.projects === projects &&
      cache.facts.hosts === hosts &&
      cache.facts.done === done &&
      cache.cwd === current?.cwd &&
      cache.sessionId === current?.sessionId &&
      cache.view === view &&
      cache.open === open &&
      cache.closed === closed &&
      cache.pinnedOpen === pinnedOpen &&
      cache.today === today
    )
      return cache.list;
    const built = buildList(state, view, today, (key) => isOpen(key, pinnedOpen));
    cache = {
      facts: { registryLoaded, folders, sessionReferences, projects, hosts, done },
      cwd: current?.cwd,
      sessionId: current?.sessionId,
      view,
      open,
      closed,
      pinnedOpen,
      today,
      list: built,
    };
    return built;
  };

  return {
    list,
    sync: (state, view) => {
      const current = state.session ?? state.selecting;
      if (current) {
        const sessionId = current.sessionId ?? null;
        const referenced =
          sessionId && sessionReference(state, { cwd: current.cwd, sessionId }) !== undefined;
        const key = referenced
          ? selectedKey(list(state, view))
          : startingKey(state, current.cwd, view, today);
        if (key) {
          const target = JSON.stringify([current.cwd, sessionId, view.groupBy, key]);
          if (target !== revealed) {
            revealed = target;
            setOpen([key], true);
          }
        }
      }
      if (state.registryLoaded) {
        const ids = state.projects.map((p) => p.id);
        const seen = projects;
        if (!seen || ids.length !== seen.size || ids.some((id) => !seen.has(id))) {
          projects = new Set(ids);
          if (seen) setOpen(ids.filter((id) => !seen.has(id)).map(projectKey), true);
        }
        const nowDone = new Set(state.projects.filter(isProjectDone).map((p) => p.id));
        const wasDone = doneProjects;
        if (wasDone) {
          const known = new Set(ids);
          setOpen([...nowDone].filter((id) => !wasDone.has(id)).map(projectKey), false);
          setOpen(
            [...wasDone].filter((id) => known.has(id) && !nowDone.has(id)).map(projectKey),
            true,
          );
        }
        doneProjects = nowDone;
      }
    },
    toggle: (key, value) => setOpen([key], value),
    subscribe: (listener) => {
      listeners.add(listener);
      const unsubscribe = preferences.pinnedOpen.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    start: () => {
      let cancel = () => {};
      const wake = () => {
        cancel();
        refreshDay();
        const now = clock.now();
        cancel = clock.wakeAfter(localMidnight(now, 1).getTime() - now.getTime(), wake);
      };
      wake();
      const stopResume = clock.onResume(wake);
      return () => {
        cancel();
        stopResume();
      };
    },
  };
}

export const browserSidebarClock: SidebarClock = {
  now: () => new Date(),
  wakeAfter: (ms, wake) => {
    const timer = setTimeout(wake, ms);
    return () => clearTimeout(timer);
  },
  onResume: (wake) => {
    window.addEventListener("focus", wake);
    return () => window.removeEventListener("focus", wake);
  },
};
