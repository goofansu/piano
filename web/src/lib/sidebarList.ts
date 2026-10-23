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
import { folderFor, type SessionEntry, sessionCatalog } from "./sessionCatalog.ts";
import { sessionReference } from "./sessionContext.ts";
import {
  dateGroups,
  folderGroups,
  projectGroups,
  type SidebarView,
  sortSessions,
} from "./sidebarView.ts";

/** The Pinned section's key, the same under every grouping. */
export const PINNED = "pinned";

export interface PinnedSection {
  key: typeof PINNED;
  open: boolean;
  /** Pinned sessions in the chosen order, wherever their folder is. */
  sessions: SessionEntry[];
}

/**
 * One section of the grouping. Folder and project groups open and close; their keys stay the same
 * whichever grouping is chosen, so switching away and back keeps them as the user left them.
 */
export type SidebarSection =
  | { kind: "folder"; key: string; open: boolean; folder: FolderView; sessions: SessionEntry[] }
  /** Active projects in order, then always the No project group (`project: null`). */
  | {
      kind: "project";
      key: string;
      open: boolean;
      project: Project | null;
      sessions: SessionEntry[];
    }
  | { kind: "date"; key: string; label: string; sessions: SessionEntry[] }
  /** No grouping: every listed session in one section. */
  | { kind: "list"; key: string; sessions: SessionEntry[] };

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
  /** Pinned starts open and stays as the user leaves it. */
  pinnedOpen: Preference<boolean>;
}

export function sidebarPreferences(storage?: PreferenceStorage): SidebarPreferences {
  return {
    openGroups: createPreference<readonly string[]>({
      key: "piano.openProjects",
      decode: (raw) => {
        const stored = parseJson(raw);
        return Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : [];
      },
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
const localMidnight = (date: Date, days = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** The section holding a session: Pinned for a pinned one, else its folder or project group. */
function ownerKey(
  state: AppState,
  session: { cwd: string; sessionId: string | null },
  view: SidebarView,
): string | undefined {
  const member = session.sessionId
    ? sessionReference(state, { cwd: session.cwd, sessionId: session.sessionId })
    : undefined;
  if (member?.pinned) return PINNED;
  if (view.groupBy === "folder") return folderFor(state, session.cwd)?.path;
  if (view.groupBy !== "project") return undefined;
  return projectKey(member?.projectId ?? "");
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
      ? { key: PINNED, open: isOpen(PINNED), sessions: pinnedSessions }
      : null;
  const listed = catalog.filter((s) => s.listed && !s.pinned);
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
        })),
      );
    case "project": {
      const groups = projectGroups(state.projects, listed, view.sortBy);
      if (state.projects.length === 0 && groups.every((g) => g.sessions.length === 0))
        return empty(NO_SESSIONS);
      return sections(
        groups.map(({ project, sessions }) => {
          const key = projectKey(project?.id ?? "");
          return { kind: "project", key, open: isOpen(key), project, sessions };
        }),
      );
    }
    case "date": {
      const groups = dateGroups(listed, view.sortBy, today);
      if (groups.length === 0) return empty(NO_SESSIONS);
      return sections(
        groups.map(({ label, sessions }) => ({
          kind: "date",
          key: `date:${label}`,
          label,
          sessions,
        })),
      );
    }
    default: {
      // No grouping; a stored view is not validated, so an unknown grouping lists the same way.
      const sessions = sortSessions(listed, view.sortBy);
      if (sessions.length === 0) return empty(NO_SESSIONS);
      return sections([{ kind: "list", key: "list", sessions }]);
    }
  }
}

export function createSidebarList({
  clock,
  preferences,
}: SidebarListEnvironment): SidebarListModel {
  let open: ReadonlySet<string> = new Set(preferences.openGroups.get());
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
    pinnedOpen: boolean;
    today: Date;
    list: SidebarList;
  } | null = null;

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const setOpen = (keys: readonly string[], value: boolean) => {
    const changed = keys.filter((k) => k !== PINNED && open.has(k) !== value);
    if (keys.includes(PINNED)) preferences.pinnedOpen.set(value);
    if (changed.length === 0) return;
    const next = new Set(open);
    for (const key of changed) {
      if (value) next.add(key);
      else next.delete(key);
    }
    open = next;
    preferences.openGroups.set([...open]);
    notify();
  };
  const refreshDay = () => {
    const day = localMidnight(clock.now());
    if (day.getTime() === today.getTime()) return;
    today = day;
    notify();
  };

  return {
    list: (state, view) => {
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
        cache.pinnedOpen === pinnedOpen &&
        cache.today === today
      )
        return cache.list;
      const isOpen = (key: string) => (key === PINNED ? pinnedOpen : open.has(key));
      const list = buildList(state, view, today, isOpen);
      cache = {
        facts: { registryLoaded, folders, sessionReferences, projects, hosts, done },
        cwd: current?.cwd,
        sessionId: current?.sessionId,
        view,
        open,
        pinnedOpen,
        today,
        list,
      };
      return list;
    },
    sync: (state, view) => {
      const current = state.session ?? state.selecting;
      if (current) {
        const sessionId = current.sessionId ?? null;
        const key = ownerKey(state, { cwd: current.cwd, sessionId }, view);
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
