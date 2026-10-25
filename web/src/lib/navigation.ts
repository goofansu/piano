/**
 * What is on screen and how it maps to the address bar. The client owns the main pane's view (a
 * session or a page); navigation owns what sits over it (Settings, the selected session's areas
 * and PR, the palette), reconciles the address bar's route with the registry once it
 * loads, and keeps the URL and title following the screen. A page's address and title are decided
 * once, in `pageAddress`. Sessions are addressed by ID, never by directory. Nothing here depends on
 * render timing.
 */
import { type AppState, type Page, sessionKey } from "../store.ts";
import type { Client } from "./client.ts";
import { findProject } from "./projectCommands.ts";
import { parseRoute, type Route, routePath, type SettingsSection } from "./routes.ts";
import { catalogEntry } from "./sessionCatalog.ts";

/**
 * One tab in the selected session's Surface area: its Changes, or a file a link opened. A file
 * remembers the area its latest link was in, so closing it one area at a time returns there.
 */
export type SurfaceTab = "changes" | { kind: "file"; path: string; from: SessionArea };

/** What the Surface area shows beside (or, one area at a time, instead of) the Agent area. */
export interface Surface {
  /** Open tabs in the order they were opened: each new one, Changes included, at the end. */
  tabs: SurfaceTab[];
  /** The key (`tabKey`) of the tab shown. */
  active: string;
}

/**
 * A file's one spelling, so each file opens one tab: `.`, `..` and repeated slashes resolved, and
 * a path inside the session's directory relative to it, as a link in its transcript names it.
 * A directory reached through a symlink still has a spelling of its own; only the server sees it.
 */
function filePath(path: string, cwd: string | undefined): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part !== ".." || !absolute) parts.push(part);
  }
  const resolved = (absolute ? "/" : "") + parts.join("/");
  if (!absolute || !cwd) return resolved || ".";
  const root = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  return resolved.startsWith(`${root}/`) ? resolved.slice(root.length + 1) : resolved;
}

/** A tab's identity: one Changes, and one tab per file path. */
export const tabKey = (tab: SurfaceTab): string =>
  tab === "changes" ? "changes" : `file:${tab.path}`;

/** The tab shown, if the area is open. */
export const activeTab = (surface: Surface | null): SurfaceTab | undefined =>
  surface?.tabs.find((tab) => tabKey(tab) === surface.active);

/** The session's two areas: the conversation and its composer, and the Surface area. */
export type SessionArea = "agent" | "surface";

/**
 * Which of the session's areas show: side by side, the Agent area always and the Surface area
 * while it has tabs; one area at a time, the one the user moved to last.
 */
export function shownAreas(state: Pick<NavigationState, "surface" | "area" | "single">): {
  agent: boolean;
  surface: boolean;
} {
  const surface = !!state.surface && (!state.single || state.area === "surface");
  return { agent: !state.single || !surface, surface };
}

/**
 * Whether a Surface tab closes: side by side every tab does (its strip X, Escape, Hide changes);
 * one area at a time only a file does, from its toolbar, and Changes stays, Agent being the way
 * back from it.
 */
export const closable = (tab: SurfaceTab, single: boolean): boolean => !single || tab !== "changes";

export interface NavigationState {
  /** The open Settings section; the view underneath stays mounted (INV-02). */
  settings: SettingsSection | null;
  /**
   * Counts the requests to open Settings, including repeats of the section already open. A section
   * that reveals part of a page reads it so asking again reveals it again (INV-07).
   */
  settingsRequest: number;
  /** The Surface area's tabs; `null` while it has none, and so is hidden. */
  surface: Surface | null;
  /**
   * The area the user moved to last: the one a single-view layout shows. Only showing a surface
   * moves it there; files changing or the agent finishing never do.
   */
  area: SessionArea;
  /**
   * Counts the requests to show a surface, including repeats of the one already shown, so asking
   * again focuses it without reopening or refreshing it.
   */
  surfaceRequest: number;
  /** Whether the session is laid out one area at a time, as its available width decides. */
  single: boolean;
  /** The session header's Views menu, which the palette can open too. */
  views: boolean;
  pullRequest: boolean;
  palette: boolean;
}

/** The browser's address bar and title, behind a seam so the policy runs in Node. */
export interface AddressBar {
  location: () => { pathname: string; search: string };
  push: (path: string) => void;
  replace: (path: string) => void;
  setTitle: (title: string) => void;
  /** Back/forward; returns the unsubscribe function. */
  onPop: (listener: () => void) => () => void;
}

/**
 * Where the selected session's Surface area outlives a reload of this browser tab, behind a seam
 * so the policy runs in Node. Any call may throw.
 */
export interface SurfaceMemory {
  read: () => string | null;
  write: (value: string | null) => void;
}

export interface NavigationOptions {
  client: Pick<Client, "getState" | "subscribe" | "select" | "dispatch">;
  address: AddressBar;
  /** Without one, a reload starts every session on its Agent area. */
  memory?: SurfaceMemory;
  /** Called on every move the user or history makes, e.g. to close the mobile sidebar. */
  moved?: () => void;
}

export interface Navigation {
  getState: () => NavigationState;
  subscribe: (listener: () => void) => () => void;
  /** Applies the address bar's route and follows client and history changes; returns the stop function. */
  start: () => () => void;
  select: (cwd: string, sessionId: string | null) => void;
  /** A page in the main pane; it leaves Settings. The moves below each open one page. */
  openPage: (page: Page) => void;
  /** The New page, optionally in a directory or for a project. */
  openNew: (cwd?: string, projectId?: string) => void;
  /** The Projects index. */
  openProjects: () => void;
  /** A project's home. */
  openProject: (projectId: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  /** Shows Changes, opening its tab at the end if needed, or focuses it; never a toggle. */
  openChanges: () => void;
  /**
   * Shows a file's tab, opening it at the end if needed; an open file, however spelled, is read
   * again. `from` is the area the link was in, which closing the file returns to, even when it was
   * already open; without one (the palette), the area shown one at a time, or Agent side by side.
   */
  openFile: (path: string, from?: SessionArea) => void;
  /** Shows an open tab by its key. */
  selectTab: (key: string) => void;
  /**
   * Closes a tab that is `closable`; its neighbour shows. Closing the last hides the area, and one
   * area at a time a file opened from the Agent area returns there.
   */
  closeTab: (key: string) => void;
  /** Shows the Agent area in a single-view layout, keeping the surface for the next visit. */
  showAgent: () => void;
  /** The session reports its layout as its available width changes. */
  setSingle: (single: boolean) => void;
  setViews: (open: boolean) => void;
  openPullRequest: () => void;
  closePullRequest: () => void;
  setPalette: (open: boolean) => void;
}

/** A route that opens a page; a session needs the registry to find its directory, and Settings sits over the view. */
type PageRoute = Exclude<Route, { kind: "session" | "settings" }>;

function routePage(route: PageRoute): Page {
  switch (route.kind) {
    case "new":
      return { kind: "new", projectId: route.projectId };
    case "projects":
      return { kind: "projects" };
    case "project":
      return { kind: "project", projectId: route.projectId };
  }
}

/** A page's address and title; Session not found keeps the missing session's address. */
function pageAddress(state: AppState, page: Page): { route: Route; title: string } {
  switch (page.kind) {
    case "new":
      return {
        route: { kind: "new", projectId: page.projectId },
        title: findProject(state, page.projectId)?.name || "New session",
      };
    case "projects":
      return { route: { kind: "projects" }, title: "Projects" };
    case "project":
      return {
        route: { kind: "project", projectId: page.projectId },
        title: findProject(state, page.projectId)?.name || "Project",
      };
    case "missing-session":
      return { route: { kind: "session", sessionId: page.sessionId }, title: "Session not found" };
  }
}

/** The client's first view for a route, so a session URL never renders the New page while the registry loads. */
export function initialView(route: Route): AppState["view"] {
  if (route.kind === "session") return { kind: "session" };
  return route.kind === "settings" ? { kind: "new" } : routePage(route);
}

export type RouteDecision =
  | { kind: "wait" }
  | { kind: "settings"; section: SettingsSection }
  | { kind: "open"; page: Page }
  /** Back or forward onto the page already on screen keeps it as it is, such as the New page's directory. */
  | { kind: "keep" }
  | { kind: "select"; cwd: string; sessionId: string };

/** What applying a route to the current state means. A session needs its directory, which only the registry knows. */
export function decideRoute(route: Route, state: AppState): RouteDecision {
  if (route.kind === "settings") return { kind: "settings", section: route.section };
  if (route.kind !== "session") {
    const page = routePage(route);
    const shown = state.view.kind === "session" ? null : pageAddress(state, state.view).route;
    return shown && routePath(shown) === routePath(route)
      ? { kind: "keep" }
      : { kind: "open", page };
  }
  if (!state.registryLoaded) return { kind: "wait" };
  const session = catalogEntry(state, route.sessionId);
  return session
    ? { kind: "select", cwd: session.cwd, sessionId: session.sessionId }
    : { kind: "open", page: { kind: "missing-session", sessionId: route.sessionId } };
}

export interface Address {
  path: string;
  /** Whether a change of path adds a history entry or replaces the current one. */
  mode: "push" | "replace";
  title: string;
}

/** The URL and title for the screen, or null while there is nothing to address (a new session not yet created). */
export function addressFor(
  state: AppState,
  settings: SettingsSection | null,
  currentPathname: string,
): Address | null {
  const sessionId = (state.session ?? state.selecting)?.sessionId;
  const shown: { route: Route; title: string } | null =
    state.view.kind !== "session"
      ? pageAddress(state, state.view)
      : sessionId
        ? {
            route: { kind: "session", sessionId },
            // "Session" only until the catalog knows the session.
            title: catalogEntry(state, sessionId)?.label ?? "Session",
          }
        : null;
  if (!shown) return null;
  const path = routePath(settings ? { kind: "settings", section: settings } : shown.route);
  // The bare root is an alias for /new and a query string carries nothing: replace those, push real moves.
  const mode =
    currentPathname === "/" || currentPathname === "/settings" || currentPathname === path
      ? "replace"
      : "push";
  return { path, mode, title: `${settings ? "Settings" : shown.title} - Piano` };
}

const panelOwner = (s: AppState) => (s.session ? sessionKey(s.session) : null);

/** What a reload brings back: one session's tabs and the area it was on. */
interface KeptSurface {
  owner: string;
  surface: Surface | null;
  area: SessionArea;
}

const isArea = (value: unknown): value is SessionArea => value === "agent" || value === "surface";

const isTab = (value: unknown): value is SurfaceTab =>
  value === "changes" ||
  (typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "file" &&
    typeof (value as { path?: unknown }).path === "string" &&
    isArea((value as { from?: unknown }).from));

/** The surface `owner` kept, or null when it kept none or what is stored does not decode. */
function decodeKept(
  raw: string | null,
  owner: string,
): { surface: Surface; area: SessionArea } | null {
  if (raw === null) return null;
  let value: Partial<KeptSurface> | null;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const surface = value?.owner === owner ? value.surface : null;
  if (
    !surface ||
    !isArea(value?.area) ||
    !Array.isArray(surface.tabs) ||
    !surface.tabs.every(isTab) ||
    !surface.tabs.some((tab) => tabKey(tab) === surface.active)
  )
    return null;
  return { surface: { tabs: surface.tabs, active: surface.active }, area: value.area };
}

export function createNavigation({
  client,
  address,
  memory,
  moved = () => {},
}: NavigationOptions): Navigation {
  // A route read from the address bar (on start, or on back/forward) that has not been applied yet.
  let wanted: Route | null = parseRoute(address.location());
  let state: NavigationState = {
    settings: wanted.kind === "settings" ? wanted.section : null,
    settingsRequest: 0,
    surface: null,
    area: "agent",
    surfaceRequest: 0,
    single: false,
    views: false,
    pullRequest: false,
    palette: false,
  };
  let notified = state;
  let owner = panelOwner(client.getState());
  let depth = 0;
  // A user or history move always re-checks the address; otherwise only the screen's inputs changing does.
  let moving = false;
  let synced: unknown[] = [];
  let kept: { owner: string | null; surface: Surface | null; area: SessionArea } | undefined;

  /** The surface this browser tab kept for `key` before a reload. */
  const recall = (key: string) => {
    try {
      return decodeKept(memory?.read() ?? null, key);
    } catch {
      return null;
    }
  };

  /** Keeps the shown session's surface, and forgets it once no session is on screen. */
  const remember = () => {
    if (!memory) return;
    // While a session URL loads there is no owner yet, and what it kept must survive.
    if (!owner && client.getState().view.kind === "session") return;
    if (kept?.owner === owner && kept.surface === state.surface && kept.area === state.area) return;
    kept = { owner, surface: state.surface, area: state.area };
    try {
      memory.write(
        owner
          ? JSON.stringify({
              owner,
              surface: state.surface,
              area: state.area,
            } satisfies KeptSurface)
          : null,
      );
    } catch {
      /* storage unavailable: a reload starts on the Agent area */
    }
  };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<NavigationState>) => {
    state = { ...state, ...patch };
  };

  /** Runs one move; the route, panels and address settle once at the end, as one history entry. */
  const batch = (fn: () => void) => {
    moving = true;
    depth++;
    try {
      fn();
    } finally {
      depth--;
    }
    if (depth === 0) settle();
  };

  const select = (cwd: string, sessionId: string | null) =>
    batch(() => {
      moved();
      set({ settings: null });
      client.select(cwd, sessionId);
    });

  const applyWanted = () => {
    if (!wanted) return;
    const decision = decideRoute(wanted, client.getState());
    if (decision.kind === "wait") return;
    wanted = null;
    // Applying a settings route, on load or on back/forward, is a request of its own.
    if (decision.kind === "settings")
      set({ settings: decision.section, settingsRequest: state.settingsRequest + 1 });
    else if (decision.kind === "open") client.dispatch({ type: "open", page: decision.page });
    else if (decision.kind === "select") select(decision.cwd, decision.sessionId);
  };

  function settle() {
    depth++;
    try {
      applyWanted();
      const next = panelOwner(client.getState());
      if (next !== owner) {
        owner = next;
        // Inspection belongs to one session: another one starts with only its Agent area. The
        // session this browser tab showed last comes back as it was left, as after a reload.
        const back = next ? recall(next) : null;
        set({
          surface: back?.surface ?? null,
          area: back?.area ?? "agent",
          views: false,
          pullRequest: false,
        });
      }
      remember();
    } finally {
      depth--;
    }
    // The address bar follows the screen; a route that is still being applied already matches it.
    // Changes elsewhere in the client (drafts, hosts, catalogs) leave both URL and title as they are.
    const c = client.getState();
    const inputs = [
      c.view,
      c.session,
      c.selecting,
      c.folders,
      c.projects,
      c.sessionReferences,
      state.settings,
    ];
    const changed = moving || inputs.some((input, i) => input !== synced[i]);
    moving = false;
    if (!wanted && changed) {
      synced = inputs;
      const { pathname, search } = address.location();
      const target = addressFor(client.getState(), state.settings, pathname);
      if (target) {
        if (target.path !== pathname + search)
          (target.mode === "replace" ? address.replace : address.push)(target.path);
        address.setTitle(target.title);
      }
    }
    if (state !== notified) {
      notified = state;
      for (const listener of listeners) listener();
    }
  }

  /** A user's move to a page; it leaves Settings. */
  const open = (page: Page) =>
    batch(() => {
      set({ settings: null });
      client.dispatch({ type: "open", page });
      moved();
    });

  /** Shows `surface` in the Surface area as a request of its own; it leaves Settings. */
  const show = (surface: Surface) =>
    batch(() => {
      set({
        settings: null,
        surface,
        area: "surface",
        surfaceRequest: state.surfaceRequest + 1,
        views: false,
      });
      moved();
    });

  const closeSettings = () =>
    batch(() => {
      set({ settings: null });
      moved();
    });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      const stopClient = client.subscribe(() => {
        if (depth === 0) settle();
      });
      const stopPop = address.onPop(() =>
        batch(() => {
          moved();
          const route = parseRoute(address.location());
          set({ settings: route.kind === "settings" ? route.section : null });
          wanted = route;
        }),
      );
      settle();
      return () => {
        stopClient();
        stopPop();
      };
    },
    select,
    openPage: open,
    openNew: (cwd, projectId) => open({ kind: "new", cwd, projectId }),
    openProjects: () => open({ kind: "projects" }),
    openProject: (projectId) => open({ kind: "project", projectId }),
    openSettings: (section = "providers") =>
      batch(() => {
        // Asking for the section already open is still a request; what it reveals is revealed again.
        set({ settings: section, settingsRequest: state.settingsRequest + 1 });
        moved();
      }),
    closeSettings,
    openChanges: () => {
      const tabs = state.surface?.tabs ?? [];
      show({
        tabs: tabs.includes("changes") ? tabs : [...tabs, "changes"],
        active: "changes",
      });
    },
    openFile: (spelled, from = shownAreas(state).agent ? "agent" : "surface") => {
      const path = filePath(spelled, client.getState().session?.cwd);
      const tabs = state.surface?.tabs ?? [];
      // A fresh tab object for an open file: the viewer reads it again, as clicking a link did,
      // and closing it returns to the area of this, the latest, link.
      const tab: SurfaceTab = { kind: "file", path, from };
      const key = tabKey(tab);
      const at = tabs.findIndex((t) => tabKey(t) === key);
      show({ tabs: at < 0 ? [...tabs, tab] : tabs.with(at, tab), active: key });
    },
    selectTab: (key) => {
      if (!state.surface?.tabs.some((tab) => tabKey(tab) === key)) return;
      show({ ...state.surface, active: key });
    },
    closeTab: (key) =>
      batch(() => {
        const surface = state.surface;
        const at = surface?.tabs.findIndex((tab) => tabKey(tab) === key) ?? -1;
        if (!surface || at < 0 || !closable(surface.tabs[at], state.single)) return;
        const closing = surface.tabs[at];
        const tabs = surface.tabs.toSpliced(at, 1);
        if (!tabs.length) return set({ surface: null, area: "agent" });
        const active =
          surface.active === key ? tabKey(tabs[Math.min(at, tabs.length - 1)]) : surface.active;
        const back =
          state.single &&
          surface.active === key &&
          closing !== "changes" &&
          closing.from === "agent";
        set({ surface: { tabs, active }, area: back ? "agent" : state.area });
      }),
    showAgent: () => batch(() => set({ area: "agent" })),
    setSingle: (single) => batch(() => set({ single, views: single ? false : state.views })),
    setViews: (open) => batch(() => set({ views: open })),
    openPullRequest: () =>
      batch(() => {
        set({ settings: null, pullRequest: true });
        moved();
      }),
    closePullRequest: () => batch(() => set({ pullRequest: false })),
    setPalette: (open) => batch(() => set({ palette: open })),
  };
}

/** This browser tab's sessionStorage: a reload keeps the surface, a new tab starts without it. */
export const browserSurfaceMemory: SurfaceMemory = {
  read: () => sessionStorage.getItem("piano.surface"),
  write: (value) =>
    value === null
      ? sessionStorage.removeItem("piano.surface")
      : sessionStorage.setItem("piano.surface", value),
};

/** The real address bar. Globals are read only when called, so this module loads in Node. */
export const browserAddressBar: AddressBar = {
  location: () => location,
  push: (path) => history.pushState(null, "", path),
  replace: (path) => history.replaceState(null, "", path),
  setTitle: (title) => {
    document.title = title;
  },
  onPop: (listener) => {
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  },
};
