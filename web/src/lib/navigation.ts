/**
 * What is on screen and how it maps to the address bar. The client owns the main pane's view (a
 * session or a page); navigation owns what sits over it (Settings, the selected session's right
 * sidebar and PR, the palette), reconciles the address bar's route with the registry once it
 * loads, and keeps the URL and title following the screen. A page's address and title are decided
 * once, in `pageAddress`. Sessions are addressed by ID, never by directory. Nothing here depends on
 * render timing.
 */
import { type AppState, type Page, sessionKey } from "../store.ts";
import type { Client } from "./client.ts";
import { findProject } from "./projectCommands.ts";
import { parseRoute, type Route, routePath, type SettingsSection } from "./routes.ts";
import { catalogEntry } from "./sessionCatalog.ts";

/** What the selected session's right sidebar shows: its Changes, or a file a link opened. */
export type SidebarPanel = "changes" | { kind: "file"; path: string };
/**
 * Something that belongs to the selected session and closes when that session changes: a right
 * sidebar view, or the PR. The sidebar is nonmodal, so the PR opens over it without replacing it.
 */
export type Panel = SidebarPanel | "pr";

export interface NavigationState {
  /** The open Settings section; the view underneath stays mounted (INV-02). */
  settings: SettingsSection | null;
  /**
   * Counts the requests to open Settings, including repeats of the section already open. A section
   * that reveals part of a page reads it so asking again reveals it again (INV-07).
   */
  settingsRequest: number;
  sidebar: SidebarPanel | null;
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

export interface NavigationOptions {
  client: Pick<Client, "getState" | "subscribe" | "select" | "dispatch">;
  address: AddressBar;
  /** Called on every move the user or history makes, e.g. to close the mobile sidebar. */
  moved?: () => void;
}

export interface Navigation {
  getState: () => NavigationState;
  subscribe: (listener: () => void) => () => void;
  /** Applies the address bar's route and follows client and history changes; returns the stop function. */
  start: () => () => void;
  select: (cwd: string, sessionId: string | null) => void;
  /** The New page, optionally in a directory or for a project. */
  openNew: (cwd?: string, projectId?: string) => void;
  /** The Projects index. */
  openProjects: () => void;
  /** A project's home. */
  openProject: (projectId: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  openPanel: (panel: Panel) => void;
  closeSidebar: () => void;
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
            title: catalogEntry(state, sessionId)?.title || "Session",
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

export function createNavigation({
  client,
  address,
  moved = () => {},
}: NavigationOptions): Navigation {
  // A route read from the address bar (on start, or on back/forward) that has not been applied yet.
  let wanted: Route | null = parseRoute(address.location());
  let state: NavigationState = {
    settings: wanted.kind === "settings" ? wanted.section : null,
    settingsRequest: 0,
    sidebar: null,
    pullRequest: false,
    palette: false,
  };
  let notified = state;
  let owner = panelOwner(client.getState());
  let depth = 0;
  // A user or history move always re-checks the address; otherwise only the screen's inputs changing does.
  let moving = false;
  let synced: unknown[] = [];
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
        set({ sidebar: null, pullRequest: false });
      }
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
    openPanel: (panel) =>
      batch(() => {
        set(
          panel === "pr"
            ? { settings: null, pullRequest: true }
            : { settings: null, sidebar: panel },
        );
        moved();
      }),
    closeSidebar: () => batch(() => set({ sidebar: null })),
    closePullRequest: () => batch(() => set({ pullRequest: false })),
    setPalette: (open) => batch(() => set({ palette: open })),
  };
}

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
