/**
 * The sidebar's session list: the Pinned section, then the chosen grouping's sections, each with
 * the key it is opened by and whether it is open. One model owns what is listed, which groups are
 * open (remembered per browser), the selection's group opening, and the clock that rolls date
 * groups over at local midnight, so the Sidebar only renders what `list` returns and calls
 * `toggle`. Relative, not @/: module tests load this file directly in Node.
 */
import type { FolderView, Project } from "@shared/wire";
import type { AppState } from "../store.ts";
import {
  createPreference,
  type Preference,
  type PreferenceStorage,
  parseJson,
} from "./preference.ts";
import { folderFor, inSidebarGroups, type SessionEntry, sessionCatalog } from "./sessionCatalog.ts";
import { sessionReference } from "./sessionContext.ts";
import {
  dateGroup,
  dateGroups,
  folderGroups,
  projectGroups,
  type SidebarView,
  sortSessions,
} from "./sidebarView.ts";

/** The Pinned section's key, the same under every grouping. */
export const PINNED = "pinned";

/**
 * The line beneath each title when View options shows folder and branch: the branch, and the
 * folder too unless the row's group already names it.
 */
export type SessionRowDetails = "branch" | "folder-and-branch";

export interface PinnedSection {
  key: typeof PINNED;
  open: boolean;
  /** Pinned sessions in the chosen order, wherever their folder is. */
  sessions: SessionEntry[];
  details: SessionRowDetails | undefined;
}

/**
 * One section of the grouping. Folder, project and date groups open and close; their keys stay the
 * same whichever grouping is chosen, so switching away and back keeps them as the user left them.
 */
export type SidebarSection = { details: SessionRowDetails | undefined } & (
  | { kind: "folder"; key: string; open: boolean; folder: FolderView; sessions: SessionEntry[] }
  /** Active projects in order, then always the No project group (`project: null`). */
  | {
      kind: "project";
      key: string;
      open: boolean;
      project: Project | null;
      sessions: SessionEntry[];
    }
  /** Date groups start open; the rest start closed. */
  | { kind: "date"; key: string; open: boolean; label: string; sessions: SessionEntry[] }
  /** No grouping: every listed session in one section. */
  | { kind: "list"; key: string; sessions: SessionEntry[] }
);

export type SidebarBody =
  | { kind: "loading" }
  | { kind: "empty"; text: string }
  | { kind: "sections"; sections: SidebarSection[] };

export interface SidebarList {
  /** Null while nothing is pinned, and before the registry arrives. */
  pinned: PinnedSection | null;
  /** Null when pinned rows stand in for the empty state, so nothing shows below them. */
  body: SidebarBody | null;
}

/** Local time and its wake-ups, behind a seam so the date rollover runs in Node. */
export interface SidebarClock {
  now: () => Date;
  /** Calls `wake` once after `ms`; returns the cancel function. */
  wakeAfter: (ms: number, wake: () => void) => () => void;
  /** Calls `wake` when the page comes back, which also catches sleep and clock changes; returns the unsubscribe function. */
  onResume: (wake: () => void) => () => void;
}

/** What the sidebar list remembers per browser. */
export interface SidebarPreferences {
  /** Folder and project groups left open. */
  openGroups: Preference<readonly string[]>;
  /** Date groups left closed. */
  closedGroups: Preference<readonly string[]>;
  /** Pinned starts open and stays as the user leaves it. */
  pinnedOpen: Preference<boolean>;
}

const keyList = (raw: string | null): readonly string[] => {
  const stored = parseJson(raw);
  return Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : [];
};

export function sidebarPreferences(storage?: PreferenceStorage): SidebarPreferences {
  return {
    openGroups: createPreference<readonly string[]>({
      key: "piano.openProjects",
      decode: keyList,
      storage,
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
  /** The same list until sidebar facts, the view, today's date or open groups change; transcript updates reuse it. */
  list: (state: AppState, view: SidebarView) => SidebarList;
  /**
   * After a render: a new selection, grouping or owning group opens the group holding the selected
   * session (Pinned for a pinned one); the same one again does not, so a registry refresh never
   * undoes a collapse. A project that appears after the registry loaded opens.
   */
  sync: (state: AppState, view: SidebarView) => void;
  /** The user opened or collapsed the section with this key; kept until the user changes it. */
  toggle: (key: string, open: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  /** Follows the clock so date groups roll over at local midnight; returns the stop function. */
  start: () => () => void;
}

const NO_FOLDERS = "No folders yet. Start a session in any folder and it appears here.";
const NO_SESSIONS = "No sessions yet. Start one and it appears here.";

/** Project groups share the open set with folders, keyed apart from paths; the empty id is the No project group. */
const projectKey = (id: string) => `project:${id}`;
const dateKey = (group: string) => `date:${group}`;
const isDateKey = (key: string) => key.startsWith("date:");
const localMidnight = (date: Date, days = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** The section listing the selected session, the one `list` built: Pinned for a pinned one. */
function selectedKey(list: SidebarList): string | undefined {
  if (list.pinned?.sessions.some((s) => s.selected)) return PINNED;
  if (list.body?.kind !== "sections") return undefined;
  const section = list.body.sections.find((s) => s.sessions.some((row) => row.selected));
  // No grouping has nothing to open.
  return section && section.kind !== "list" ? section.key : undefined;
}

/**
 * The section a session without a reference yet (one being started) will list under: its folder,
 * or Today. Its project arrives with its reference, so until then no project group opens.
 */
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

/**
 * What a section's rows show beneath their titles. A folder group names the folder, so its rows
 * add only the branch, and none at all when no row has one (a non-Git folder): an empty line
 * would only make every row taller.
 */
function rowDetails(
  view: SidebarView,
  sessions: readonly SessionEntry[],
  folderNamed = false,
): SessionRowDetails | undefined {
  if (!view.folderAndBranch) return undefined;
  if (!folderNamed) return "folder-and-branch";
  return sessions.some((s) => s.branch) ? "branch" : undefined;
}

/**
 * One catalog for every grouping, so switching the grouping never changes which sessions are
 * listed. A pinned session shows only under Pinned; the groupings take the listed rest.
 */
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
  const sections = (list: SidebarSection[]): SidebarList => ({
    pinned,
    body: { kind: "sections", sections: list },
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
      if (state.projects.length === 0 && groups.every((g) => g.sessions.length === 0))
        return empty(NO_SESSIONS);
      return sections(
        groups.map(({ project, sessions }) => {
          const key = projectKey(project?.id ?? "");
          const details = rowDetails(view, sessions);
          return { kind: "project", key, open: isOpen(key), project, sessions, details };
        }),
      );
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
    default: {
      // No grouping; a stored view is not validated, so an unknown grouping lists the same way.
      const sessions = sortSessions(listed, view.sortBy);
      if (sessions.length === 0) return empty(NO_SESSIONS);
      const details = rowDetails(view, sessions);
      return sections([{ kind: "list", key: "list", sessions, details }]);
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
  /** The last selection, grouping and owning section opened. */
  let revealed: string | null = null;
  /** Project ids already seen once the registry loaded; null before then. */
  let projects: ReadonlySet<string> | null = null;
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
  /** Pinned and date groups remember being closed; folders and projects remember being open. */
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
    // These are buildList/sessionCatalog's inputs. The reducer replaces session snapshots on
    // every streaming event, but only the current identity contributes to sidebar rows.
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
        // A listed session opens the section that lists it, so an archived or unlisted one opens none.
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

/** The real clock: timers and window focus. Globals are read only when called, so this module loads in Node. */
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
