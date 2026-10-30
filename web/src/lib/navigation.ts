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
import type { Preference } from "./preference.ts";
import { findProject } from "./projectCommands.ts";
import { parseRoute, type Route, routePath, type SettingsSection } from "./routes.ts";
import { sessionLabel } from "./sessionCatalog.ts";

/** The session's own views in the Surface area, one tab each: Changes, and Preview while an app runs. */
export type SurfaceView = "changes" | "preview";

/**
 * One tab in the selected session's Surface area: one of its views, or a file a link opened. A
 * file remembers the area its latest link was in, so closing it one area at a time returns there.
 */
export type SurfaceTab = SurfaceView | { kind: "file"; path: string; from: SessionArea };

/** Whether a tab is one of the session's views rather than an open file. */
export const isView = (tab: SurfaceTab): tab is SurfaceView => typeof tab === "string";

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

/** A tab's identity: one per view, and one tab per file path. */
export const tabKey = (tab: SurfaceTab): string => (isView(tab) ? tab : `file:${tab.path}`);

/** The tab shown, if the area is open. */
export const activeTab = (surface: Surface | null): SurfaceTab | undefined =>
  surface?.tabs.find((tab) => tabKey(tab) === surface.active);

/** The session's two areas: the conversation and its composer, and the Surface area. */
export type SessionArea = "agent" | "surface";

/**
 * The session's layout: which of its areas show, and whether the session rail does. Side by
 * side, the Agent area always, and on its right either the Surface area, while it has tabs and
 * the rail does not cover it, or the rail, while it is on: whichever came in last. One area at a
 * time, the one the user moved to last, and never the rail, which has no room there; Agent is
 * then a tab while something is open beside it.
 */
export interface SessionLayout {
  /** One area at a time, as the session's width decides. */
  single: boolean;
  agent: boolean;
  surface: boolean;
  rail: boolean;
  /** Agent exists as a tab: one area at a time, with something open beside it. */
  agentTab: boolean;
}

/** The one derivation of the layout from what navigation holds. */
function sessionLayout(
  state: Pick<NavigationState, "surface" | "area" | "single" | "rail" | "covered">,
): SessionLayout {
  if (state.single) {
    const surface = !!state.surface && state.area === "surface";
    return { single: true, agent: !surface, surface, rail: false, agentTab: !!state.surface };
  }
  const surface = !!state.surface && !state.covered;
  return { single: false, agent: true, surface, rail: state.rail && !surface, agentTab: false };
}

/**
 * The one derivation of the Surface tab on screen: none under Settings, while the rail covers the
 * Surface area or while the Agent area shows one area at a time. What reads or polls for a tab
 * (Changes reads Git, its pull request row asks GitHub) does so while it is on screen.
 */
function shownTab(
  state: Pick<NavigationState, "settings" | "surface">,
  layout: SessionLayout,
): string | null {
  return !state.settings && layout.surface && state.surface ? state.surface.active : null;
}

const sameLayout = (a: SessionLayout, b: SessionLayout) =>
  a.single === b.single &&
  a.agent === b.agent &&
  a.surface === b.surface &&
  a.rail === b.rail &&
  a.agentTab === b.agentTab;

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
   * Whether the session rail is on: one choice for every session, remembered by the browser. Side
   * by side it shows on the Agent area's right whenever the Surface area does not.
   */
  rail: boolean;
  /** Side by side, whether the rail, turned on after the Surface area, hides it; its tabs wait. */
  covered: boolean;
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
  /** What the fields above show, derived once per move; the same object while it is unchanged. */
  layout: SessionLayout;
  /** The key (`tabKey`) of the Surface tab on screen, derived once per move; `null` for none. */
  shownTab: string | null;
  /** The pull request dialog is open; never while Settings is shown. */
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
  /** Whether the session rail is on; without one it starts off and lasts for this navigation only. */
  rail?: Preference<boolean>;
  /**
   * Called on every move the user or history makes, e.g. to close the mobile sidebar: once per
   * request, whether or not it changed anything, so asking for the Agent area reveals it even
   * when it is already the area shown.
   */
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
   * Shows the session's preview beside the conversation, opening its tab at the end if needed,
   * or focuses it. It does not start, stop or reload the app.
   */
  openPreview: () => void;
  /**
   * Shows the session rail on the Agent area's right, or hides it, for every session: on hides
   * the Surface area until a tab is shown again or the rail goes off. Side by side only: one area
   * at a time the rail has no room, so the `session-rail` command is not offered there, and the
   * switch keeps for when the session is wide again.
   */
  toggleRail: () => void;
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
  const session = state.sessionReferences.find((ref) => ref.sessionId === route.sessionId);
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

/** The URL and title for the screen, or null while a deep link has not resolved. */
export function addressFor(
  state: AppState,
  settings: SettingsSection | null,
  currentPathname: string,
): Address | null {
  const sessionId = (state.session ?? state.selecting)?.sessionId;
  const ref =
    !settings && state.view.kind === "session" && sessionId
      ? state.sessionReferences.find((ref) => ref.sessionId === sessionId)
      : undefined;
  const shown: { route: Route; title: string } | null = settings
    ? { route: { kind: "settings", section: settings }, title: "Settings" }
    : state.view.kind !== "session"
      ? pageAddress(state, state.view)
      : sessionId
        ? {
            route: { kind: "session", sessionId },
            // "Session" only until the catalog knows the session.
            title: ref ? sessionLabel(ref.title) : "Session",
          }
        : state.selecting || state.pendingCreate
          ? // Creation has no addressable identity yet. Use the landing address, but keep the
            // session pane and title, including when its first message's delivery is uncertain.
            { route: { kind: "new" }, title: "Session" }
          : null;
  if (!shown) return null;
  const path = routePath(shown.route);
  // The bare root is an alias for /new and a query string carries nothing: replace those, push real moves.
  const mode =
    currentPathname === "/" || currentPathname === "/settings" || currentPathname === path
      ? "replace"
      : "push";
  return { path, mode, title: `${shown.title} - Piano` };
}

const panelOwner = (s: AppState) => (s.session ? sessionKey(s.session) : null);

/** What a reload brings back: one session's tabs, the area it was on, and whether the session
 * rail covered the tabs, so the right side comes back as it was left. */
interface KeptSurface {
  owner: string;
  surface: Surface | null;
  area: SessionArea;
  covered: boolean;
}

const isArea = (value: unknown): value is SessionArea => value === "agent" || value === "surface";

const isTab = (value: unknown): value is SurfaceTab =>
  value === "changes" ||
  value === "preview" ||
  (typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "file" &&
    typeof (value as { path?: unknown }).path === "string" &&
    isArea((value as { from?: unknown }).from));

/** The surface `owner` kept, or null when it kept none or what is stored does not decode. */
function decodeKept(
  raw: string | null,
  owner: string,
): { surface: Surface; area: SessionArea; covered: boolean } | null {
  if (raw === null) return null;
  let value: Partial<KeptSurface> | null;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const surface = value?.owner === owner ? value.surface : null;
  if (!surface || !isArea(value?.area) || !Array.isArray(surface.tabs)) return null;
  // A tab kind that no longer exists (Details was one) is left behind.
  const tabs = surface.tabs.filter(isTab);
  if (!tabs.some((tab) => tabKey(tab) === surface.active)) return null;
  // Kept by an older Piano without it: the tabs were showing.
  return {
    surface: { tabs, active: surface.active },
    area: value.area,
    covered: value.covered === true,
  };
}

export function createNavigation({
  client,
  address,
  memory,
  rail: railPreference,
  moved = () => {},
}: NavigationOptions): Navigation {
  // A route read from the address bar (on start, or on back/forward) that has not been applied yet.
  // A newer explicit page/session/Settings choice invalidates it before changing the screen.
  let wanted: Route | null = parseRoute(address.location());
  const fields = {
    surface: null,
    rail: railPreference?.get() ?? false,
    covered: false,
    area: "agent" as const,
    single: false,
  };
  let state: NavigationState = {
    settings: wanted.kind === "settings" ? wanted.section : null,
    settingsRequest: 0,
    ...fields,
    layout: sessionLayout(fields),
    // No tabs yet, so none on screen.
    shownTab: null,
    surfaceRequest: 0,
    pullRequest: false,
    palette: false,
  };
  let notified = state;
  let owner = panelOwner(client.getState());
  let depth = 0;
  // True from a move through the client (select, open) or from history (back/forward) until it
  // settles: those re-check the address even when nothing here changed. Navigation's own state
  // never changes the address, which derives from the client's inputs and the Settings section.
  let moving = false;
  let synced: unknown[] = [];
  let syncedTitle: string | undefined;
  let kept: (Omit<KeptSurface, "owner"> & { owner: string | null }) | undefined;

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
    if (
      kept?.owner === owner &&
      kept.surface === state.surface &&
      kept.area === state.area &&
      kept.covered === state.covered
    )
      return;
    kept = { owner, surface: state.surface, area: state.area, covered: state.covered };
    try {
      memory.write(
        owner
          ? JSON.stringify({
              owner,
              surface: state.surface,
              area: state.area,
              covered: state.covered,
            } satisfies KeptSurface)
          : null,
      );
    } catch {
      /* storage unavailable: a reload starts on the Agent area */
    }
  };
  const listeners = new Set<() => void>();

  /**
   * Applies what a move changes. A move that changes nothing is no move: the state keeps its
   * identity, so nobody is notified. The session reports its layout on every resize, mostly
   * unchanged.
   */
  const set = (patch: Partial<Omit<NavigationState, "layout" | "shownTab">>) => {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.every((key) => Object.is(state[key], patch[key]))) return;
    const next = { ...state, ...patch };
    // Settings covers the session, and with it the pull request dialog, which does not come back.
    if (next.settings) next.pullRequest = false;
    const derived = sessionLayout(next);
    const layout = sameLayout(derived, state.layout) ? state.layout : derived;
    state = { ...next, layout, shownTab: shownTab(next, layout) };
  };

  /**
   * Runs one move; the route, panels and address settle once at the end, as one history entry.
   * A move that changed nothing, touched neither client nor history and has no route waiting
   * settles nothing: there is nothing to apply, remember or address.
   */
  const batch = (fn: () => void) => {
    const before = state;
    depth++;
    try {
      fn();
    } finally {
      depth--;
    }
    if (depth === 0 && (state !== before || moving || wanted)) settle();
  };

  const select = (cwd: string, sessionId: string | null) =>
    batch(() => {
      wanted = null;
      moved();
      set({ settings: null });
      // A move through the client re-checks the address even when nothing here changed.
      moving = true;
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
        // session this browser tab showed last comes back as it was left, as after a reload: the
        // rail still over the tabs it covered, unless it has since been turned off.
        const back = next ? recall(next) : null;
        set({
          surface: back?.surface ?? null,
          area: back?.area ?? "agent",
          covered: !!back?.covered && state.rail,
          pullRequest: false,
        });
      }
      remember();
    } finally {
      depth--;
    }
    // The address bar follows the screen; a route that is still being applied already matches it.
    // Only the selected identity and registry title facts matter, not the streaming projection.
    // References/projects are immutable registry revisions; transcripts, hosts and folders do not
    // change the address. A revision can contain unchanged title facts, checked before writing.
    const c = client.getState();
    const inputs = [
      c.view,
      (c.session ?? c.selecting)?.sessionId,
      !!(c.selecting || c.pendingCreate),
      c.projects,
      c.sessionReferences,
      state.settings,
    ];
    const changed = moving || inputs.some((input, i) => input !== synced[i]);
    moving = false;
    if (!wanted && changed) {
      synced = inputs;
      const { pathname, search } = address.location();
      const target = addressFor(c, state.settings, pathname);
      if (target) {
        if (target.path !== pathname + search)
          (target.mode === "replace" ? address.replace : address.push)(target.path);
        if (target.title !== syncedTitle) {
          address.setTitle(target.title);
          syncedTitle = target.title;
        }
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
      wanted = null;
      set({ settings: null });
      moving = true;
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
        covered: false,
        surfaceRequest: state.surfaceRequest + 1,
      });
      moved();
    });

  /** A user's move among the session's areas (the Agent area, a tab closing); like `show`,
   * it leaves Settings, which would otherwise hide what the move changed. */
  const moveArea = (patch: Partial<NavigationState>) =>
    batch(() => {
      set({ ...patch, settings: null });
      moved();
    });

  const closeSettings = () =>
    batch(() => {
      if (state.settings) {
        const c = client.getState();
        // An abandoned deep link has neither a selection nor retained input. A creation can
        // lack a session ID (and, after uncertainty, a selection) without being abandoned.
        if (c.view.kind === "session" && !c.session && !c.selecting && !c.pendingCreate)
          return open({ kind: "new" });
      }
      set({ settings: null });
      moved();
    });

  /** Turns the session rail on or off for every session; side by side, on covers the Surface area. */
  const setRail = (on: boolean) => {
    railPreference?.set(on);
    moveArea({ rail: on, covered: on && !!state.surface });
  };

  /** Shows one of the session's views, opening its tab at the end if needed, or focuses it. */
  const openView = (view: SurfaceView) => {
    const tabs = state.surface?.tabs ?? [];
    show({ tabs: tabs.includes(view) ? tabs : [...tabs, view], active: view });
  };

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
          moving = true;
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
        wanted = null;
        // Asking for the section already open is still a request; what it reveals is revealed again.
        set({ settings: section, settingsRequest: state.settingsRequest + 1 });
        moved();
      }),
    closeSettings,
    openChanges: () => openView("changes"),
    openPreview: () => openView("preview"),
    toggleRail: () => setRail(!state.layout.rail),
    openFile: (spelled, from = state.layout.agent ? "agent" : "surface") => {
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
    closeTab: (key) => {
      const surface = state.surface;
      const at = surface?.tabs.findIndex((tab) => tabKey(tab) === key) ?? -1;
      if (!surface || at < 0) return;
      const closing = surface.tabs[at];
      const tabs = surface.tabs.toSpliced(at, 1);
      if (!tabs.length) return moveArea({ surface: null, area: "agent" });
      const active =
        surface.active === key ? tabKey(tabs[Math.min(at, tabs.length - 1)]) : surface.active;
      const back =
        state.single && surface.active === key && !isView(closing) && closing.from === "agent";
      moveArea({ surface: { tabs, active }, area: back ? "agent" : state.area });
    },
    showAgent: () => moveArea({ area: "agent" }),
    setSingle: (single) => batch(() => set({ single })),
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
