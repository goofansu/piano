/**
 * What is on screen and how it maps to the address bar. The client owns the main pane's view
 * (session, New page, missing session); navigation owns what sits over it (Settings, the selected
 * session's Changes or PR panel, the palette), reconciles the address bar's route with the
 * registry once it loads, and keeps the URL and title following the screen. Sessions are
 * addressed by ID, never by directory. Nothing here depends on render timing.
 */
import type { AppState } from "../store.ts";
import type { Client } from "./client.ts";
import { parseRoute, type Route, routePath, type SettingsSection } from "./routes.ts";
import { catalogEntry } from "./sessionCatalog.ts";

/** A sheet or popover that belongs to the selected session; it closes when that session changes. */
export type Panel = "changes" | "pr" | "file";

export interface NavigationState {
  /** The open Settings section; the view underneath stays mounted (INV-02). */
  settings: SettingsSection | null;
  /**
   * Counts the requests to open Settings, including repeats of the section already open. A section
   * that reveals part of a page reads it so asking again reveals it again (INV-07).
   */
  settingsRequest: number;
  panel: Panel | null;
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
  /** The New page, optionally in a directory or for a project (a project's home). */
  openNew: (cwd?: string, projectId?: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  openPanel: (panel: Panel) => void;
  closePanel: () => void;
  setPalette: (open: boolean) => void;
}

/** The client's first view for a route, so a session URL never renders the New page while the registry loads. */
export function initialView(route: Route): AppState["view"] {
  return route.kind === "session"
    ? { kind: "session" }
    : { kind: "new", projectId: route.kind === "new" ? route.projectId : undefined };
}

export type RouteDecision =
  | { kind: "wait" }
  | { kind: "settings"; section: SettingsSection }
  | { kind: "new"; projectId?: string }
  /** Back or forward onto the New page already on screen keeps whatever directory it had. */
  | { kind: "keep" }
  | { kind: "select"; cwd: string; sessionId: string }
  | { kind: "missing"; sessionId: string };

/** What applying a route to the current state means. A session needs its directory, which only the registry knows. */
export function decideRoute(route: Route, state: AppState): RouteDecision {
  if (route.kind === "settings") return { kind: "settings", section: route.section };
  if (route.kind === "new")
    return state.view.kind === "new" && state.view.projectId === route.projectId
      ? { kind: "keep" }
      : { kind: "new", projectId: route.projectId };
  if (!state.registryLoaded) return { kind: "wait" };
  const session = catalogEntry(state, route.sessionId);
  return session
    ? { kind: "select", cwd: session.cwd, sessionId: session.sessionId }
    : { kind: "missing", sessionId: route.sessionId };
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
  const current = state.session ?? state.selecting;
  const route: Route | null =
    state.view.kind === "new"
      ? { kind: "new", projectId: state.view.projectId }
      : state.view.kind === "missing-session"
        ? { kind: "session", sessionId: state.view.sessionId }
        : current?.sessionId
          ? { kind: "session", sessionId: current.sessionId }
          : null;
  if (!route) return null;
  const path = routePath(settings ? { kind: "settings", section: settings } : route);
  // The bare root is an alias for /new and a query string carries nothing: replace those, push real moves.
  const mode =
    currentPathname === "/" || currentPathname === "/settings" || currentPathname === path
      ? "replace"
      : "push";
  const title = settings
    ? "Settings"
    : state.view.kind === "missing-session"
      ? "Session not found"
      : route.kind === "new"
        ? (route.projectId && state.projects.find((p) => p.id === route.projectId)?.name) ||
          "New session"
        : catalogEntry(state, route.sessionId)?.title || "Session";
  return { path, mode, title: `${title} - Piano` };
}

const panelOwner = (s: AppState) =>
  s.session ? `${s.session.cwd}\n${s.session.sessionId ?? ""}` : null;

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
    panel: null,
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
    else if (decision.kind === "new")
      client.dispatch({ type: "new", projectId: decision.projectId });
    else if (decision.kind === "select") select(decision.cwd, decision.sessionId);
    else if (decision.kind === "missing")
      client.dispatch({ type: "missing-session", sessionId: decision.sessionId });
  };

  function settle() {
    depth++;
    try {
      applyWanted();
      const next = panelOwner(client.getState());
      if (next !== owner) {
        owner = next;
        set({ panel: null });
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
    openNew: (cwd, projectId) =>
      batch(() => {
        set({ settings: null });
        client.dispatch({ type: "new", cwd, projectId });
        moved();
      }),
    openSettings: (section = "providers") =>
      batch(() => {
        // Asking for the section already open is still a request; what it reveals is revealed again.
        set({ settings: section, settingsRequest: state.settingsRequest + 1 });
        moved();
      }),
    closeSettings,
    openPanel: (panel) =>
      batch(() => {
        set({ settings: null, panel });
        moved();
      }),
    closePanel: () => batch(() => set({ panel: null })),
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
