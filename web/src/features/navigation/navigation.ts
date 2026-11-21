import type { Client } from "../../app/client.ts";
import { type AppState, type Page, sessionKey } from "../../app/store.ts";
import { browserMemory } from "../../shared/lib/browserMemory.ts";
import type { Preference } from "../../shared/lib/preference.ts";
import { findProject } from "../../shared/lib/projects.ts";
import type { RequestOptions } from "../../shared/transport/api.ts";
import {
  sessionAddress,
  sessionLabel,
  unavailableSessionTitle,
} from "../sessions/sessionCatalog.ts";
import { checkoutMissingAt, workspaceFor } from "../sessions/sessionContext.ts";
import type { workspaceFile } from "../workspace/files/fileApi.ts";
import {
  DEFAULT_SETTINGS_SECTION,
  parseRoute,
  type Route,
  routePath,
  type SettingsSection,
} from "./routes.ts";

export type SurfaceView = "changes";

export type SurfaceTab = SurfaceView | FileTab;

type FileLocation = { kind: "file"; path: string; from: SessionArea };

export interface FileTab extends FileLocation {
  key: number;
  workspaceId: string | undefined;
  requested: string;
  aliases: readonly string[];
  pending: boolean;
  result?: Awaited<ReturnType<typeof workspaceFile>>;
  status: string;
}

export const isView = (tab: SurfaceTab): tab is SurfaceView => typeof tab === "string";

export interface Surface {
  tabs: SurfaceTab[];
  active: string;
}

function filePath(path: string, cwd: string | undefined): string {
  const absolute = path.startsWith("/");
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  const spelled = (absolute ? "/" : "") + parts.join("/");
  if (!absolute || !cwd) return spelled || ".";
  const root = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  return spelled.startsWith(`${root}/`) ? spelled.slice(root.length + 1) : spelled;
}

export const tabKey = (tab: SurfaceView | FileLocation): string =>
  typeof tab === "string" ? tab : `file:${tab.path}`;

export const activeTab = (surface: Surface | null): SurfaceTab | undefined =>
  surface?.tabs.find((tab) => tabKey(tab) === surface.active);

export type SessionArea = "agent" | "surface";

export interface SessionLayout {
  single: boolean;
  agent: boolean;
  surface: boolean;
  rail: boolean;
  agentTab: boolean;
}

function sessionLayout(
  state: Pick<NavigationState, "surface" | "area" | "single" | "rail" | "covered">,
): SessionLayout {
  if (state.single) {
    const surface = !!state.surface && state.area === "surface";
    return {
      single: true,
      agent: !surface,
      surface,
      rail: false,
      agentTab: !!state.surface,
    };
  }
  const surface = !!state.surface && !state.covered;
  return { single: false, agent: true, surface, rail: state.rail && !surface, agentTab: false };
}

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
  settings: SettingsSection | null;
  surface: Surface | null;
  rail: boolean;
  covered: boolean;
  area: SessionArea;
  surfaceRequest: number;
  single: boolean;
  layout: SessionLayout;
  shownTab: string | null;
  pullRequest: boolean;
  palette: boolean;
}

export interface AddressBar {
  location: () => { pathname: string; search: string };
  push: (path: string) => void;
  replace: (path: string) => void;
  setTitle: (title: string) => void;
  onPop: (listener: () => void) => () => void;
}

export interface SurfaceMemory {
  read: () => string | null;
  write: (value: string | null) => void;
}

export interface NavigationOptions {
  client: Pick<Client, "getState" | "subscribe" | "select" | "dispatch">;
  address: AddressBar;
  readFile: (
    workspaceId: string,
    path: string,
    options: RequestOptions,
  ) => ReturnType<typeof workspaceFile>;
  memory?: SurfaceMemory;
  rail?: Preference<boolean>;
  moved?: () => void;
}

export interface Navigation {
  getState: () => NavigationState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  select: (cwd: string, sessionId: string | null) => void;
  openPage: (page: Page) => void;
  openNew: (cwd?: string, projectId?: string) => void;
  openProjects: () => void;
  openProject: (projectId: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  openChanges: () => void;
  toggleRail: () => void;
  openFile: (path: string, from?: SessionArea) => void;
  selectTab: (key: string) => void;
  closeTab: (key: string) => void;
  showAgent: () => void;
  setSingle: (single: boolean) => void;
  openPullRequest: () => void;
  closePullRequest: () => void;
  setPalette: (open: boolean) => void;
}

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
      return {
        route: { kind: "session", sessionId: page.sessionId },
        title: unavailableSessionTitle(page.reason),
      };
  }
}

export function initialView(route: Route): AppState["view"] {
  if (route.kind === "session") return { kind: "session" };
  return route.kind === "settings" ? { kind: "new" } : routePage(route);
}

export type RouteDecision =
  | { kind: "wait" }
  | { kind: "settings"; section: SettingsSection }
  | { kind: "open"; page: Page }
  | { kind: "keep" }
  | { kind: "select"; cwd: string; sessionId: string };

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
  const address = sessionAddress(state, route.sessionId);
  if (address.kind === "select") return address;
  return {
    kind: "open",
    page: { kind: "missing-session", sessionId: route.sessionId, reason: address.reason },
  };
}

export interface Address {
  path: string;
  mode: "push" | "replace";
  title: string;
}

export type SessionPane =
  | { kind: "session"; sessionId: string }
  | { kind: "creating" }
  | { kind: "failed"; sessionId: string }
  | { kind: "unresolved" };

export function sessionPane(state: AppState): SessionPane {
  const sessionId = (state.session ?? state.selecting)?.sessionId;
  if (sessionId) return { kind: "session", sessionId };
  if (state.selecting || state.pendingCreate) return { kind: "creating" };
  const failed = state.selectionFailure?.sessionId;
  return failed ? { kind: "failed", sessionId: failed } : { kind: "unresolved" };
}

export function screenKey(state: AppState): string {
  if (state.view.kind !== "session") return routePath(pageAddress(state, state.view).route);
  const pane = sessionPane(state);
  return "sessionId" in pane ? `${pane.kind}:${pane.sessionId}` : pane.kind;
}

export function addressFor(
  state: AppState,
  settings: SettingsSection | null,
  currentPathname: string,
): Address | null {
  const shown: { route: Route; title: string } | null = settings
    ? { route: { kind: "settings", section: settings }, title: "Settings" }
    : state.view.kind !== "session"
      ? pageAddress(state, state.view)
      : paneAddress(state, sessionPane(state));
  if (!shown) return null;
  const path = routePath(shown.route);
  const mode =
    currentPathname === "/" || currentPathname === "/settings" || currentPathname === path
      ? "replace"
      : "push";
  return { path, mode, title: `${shown.title} - Piano` };
}

function paneAddress(state: AppState, pane: SessionPane): { route: Route; title: string } | null {
  switch (pane.kind) {
    case "session":
    case "failed": {
      const ref = state.sessionReferences.find((ref) => ref.sessionId === pane.sessionId);
      const title = ref ? sessionLabel(ref.title) : "Session";
      return { route: { kind: "session", sessionId: pane.sessionId }, title };
    }
    case "creating":
      return { route: { kind: "new" }, title: "Session" };
    case "unresolved":
      return null;
  }
}

const panelOwner = (s: AppState) => (s.session ? sessionKey(s.session) : null);

interface KeptSurface {
  owner: string;
  surface: { tabs: (SurfaceView | FileLocation)[]; active: string } | null;
  area: SessionArea;
  covered: boolean;
}

const isArea = (value: unknown): value is SessionArea => value === "agent" || value === "surface";

const isTab = (value: unknown): value is SurfaceView | FileLocation =>
  value === "changes" ||
  (typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "file" &&
    typeof (value as { path?: unknown }).path === "string" &&
    isArea((value as { from?: unknown }).from));

function decodeKept(
  raw: string | null,
  owner: string,
): { surface: NonNullable<KeptSurface["surface"]>; area: SessionArea; covered: boolean } | null {
  if (raw === null) return null;
  let value: Partial<KeptSurface> | null;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const surface = value?.owner === owner ? value.surface : null;
  if (!surface || !isArea(value?.area) || !Array.isArray(surface.tabs)) return null;
  const tabs = surface.tabs.filter(isTab);
  if (
    !tabs.length ||
    (surface.active !== "preview" && !tabs.some((tab) => tabKey(tab) === surface.active))
  )
    return null;
  const active = tabs.some((tab) => tabKey(tab) === surface.active)
    ? surface.active
    : tabKey(tabs[0]);
  return {
    surface: { tabs, active },
    area: value.area,
    covered: value.covered === true,
  };
}

export function createNavigation({
  client,
  address,
  readFile,
  memory,
  rail: railPreference,
  moved = () => {},
}: NavigationOptions): Navigation {
  const routeAt = (): Route => parseRoute(address.location());
  let wanted: Route | null = routeAt();
  const fields = {
    surface: null,
    rail: railPreference?.get() ?? false,
    covered: false,
    area: "agent" as const,
    single: false,
  };
  let state: NavigationState = {
    settings: wanted.kind === "settings" ? wanted.section : null,
    ...fields,
    layout: sessionLayout(fields),
    shownTab: null,
    surfaceRequest: 0,
    pullRequest: false,
    palette: false,
  };
  let notified = state;
  let owner = panelOwner(client.getState());
  let depth = 0;
  let moving = false;
  let synced: unknown[] = [];
  let syncedTitle: string | undefined;
  let kept: (Omit<KeptSurface, "owner"> & { owner: string | null }) | undefined;

  const recall = (key: string) => {
    try {
      return decodeKept(memory?.read() ?? null, key);
    } catch {
      return null;
    }
  };

  const remember = () => {
    if (!memory) return;
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
              surface: state.surface && {
                ...state.surface,
                tabs: state.surface.tabs.map((tab) =>
                  isView(tab) ? tab : { kind: tab.kind, path: tab.path, from: tab.from },
                ),
              },
              area: state.area,
              covered: state.covered,
            } satisfies KeptSurface)
          : null,
      );
    } catch {}
  };
  const listeners = new Set<() => void>();
  const fileRequests = new WeakMap<FileTab, number>();
  let fileRequest = 0;
  let fileKey = 0;
  let fileWorkspace: string | undefined;
  let fileCheckoutMissing = false;
  let fileContext: unknown[] = [];
  const reads = new Map<number, AbortController>();
  const newFile = (
    file: FileLocation,
    { requested = file.path, aliases = [] as readonly string[], order = ++fileRequest } = {},
  ): FileTab => {
    const tab: FileTab = {
      kind: "file",
      path: file.path,
      from: file.from,
      key: ++fileKey,
      workspaceId: fileWorkspace,
      requested,
      aliases,
      pending: !!fileWorkspace,
      status: fileWorkspace
        ? "Opening…"
        : "Workspace unavailable. Refresh folders and try the link again.",
    };
    fileRequests.set(tab, order);
    return tab;
  };
  const updateFile = (file: FileTab, patch: Partial<FileTab>): FileTab => {
    const tab = { ...file, ...patch };
    fileRequests.set(tab, fileRequests.get(file) ?? 0);
    return tab;
  };

  const set = (patch: Partial<Omit<NavigationState, "layout" | "shownTab">>) => {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.every((key) => Object.is(state[key], patch[key]))) return;
    const next = { ...state, ...patch };
    if (next.settings) next.pullRequest = false;
    const derived = sessionLayout(next);
    const layout = sameLayout(derived, state.layout) ? state.layout : derived;
    state = { ...next, layout, shownTab: shownTab(next, layout) };
  };

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

  const selectSession = (cwd: string, sessionId: string | null) => {
    set({ settings: null });
    moving = true;
    client.select(cwd, sessionId);
  };

  const select = (cwd: string, sessionId: string | null) =>
    batch(() => {
      wanted = null;
      moved();
      selectSession(cwd, sessionId);
    });

  const applyWanted = () => {
    if (!wanted) return;
    const decision = decideRoute(wanted, client.getState());
    if (decision.kind === "wait") return;
    wanted = null;
    if (decision.kind === "settings") set({ settings: decision.section });
    else if (decision.kind === "open") client.dispatch({ type: "open", page: decision.page });
    else if (decision.kind === "select") selectSession(decision.cwd, decision.sessionId);
  };

  const followUnavailable = () => {
    const c = client.getState();
    if (wanted || state.settings || c.view.kind !== "missing-session") return;
    const shown = c.view;
    const decision = decideRoute({ kind: "session", sessionId: shown.sessionId }, c);
    if (decision.kind === "select") selectSession(decision.cwd, decision.sessionId);
    else if (
      decision.kind === "open" &&
      decision.page.kind === "missing-session" &&
      decision.page.reason !== shown.reason
    )
      client.dispatch({ type: "open", page: decision.page });
  };

  function settle() {
    depth++;
    try {
      applyWanted();
      followUnavailable();
      const next = panelOwner(client.getState());
      if (next !== owner) {
        owner = next;
        const back = next ? recall(next) : null;
        set({
          surface: back
            ? {
                ...back.surface,
                tabs: back.surface.tabs.map((tab) =>
                  typeof tab === "string" ? tab : newFile(tab),
                ),
              }
            : null,
          area: back?.area ?? "agent",
          covered: !!back?.covered && state.rail,
          pullRequest: false,
        });
      }
      syncFiles();
      remember();
    } finally {
      depth--;
    }
    const c = client.getState();
    const inputs = [
      c.view,
      c.view.kind === "session" ? screenKey(c) : null,
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
        const replace = target.mode === "replace";
        if (target.path !== pathname + search)
          (replace ? address.replace : address.push)(target.path);
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

  const open = (page: Page) =>
    batch(() => {
      wanted = null;
      set({ settings: null });
      moving = true;
      client.dispatch({ type: "open", page });
      moved();
    });

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

  const moveArea = (patch: Partial<NavigationState>) =>
    batch(() => {
      set({ settings: null, ...patch });
      moved();
    });

  const closeSettings = () =>
    batch(() => {
      if (state.settings) {
        const c = client.getState();
        if (c.view.kind === "session" && sessionPane(c).kind === "unresolved")
          return open({ kind: "new" });
      }
      set({ settings: null });
      moved();
    });

  const setRail = (on: boolean) => {
    railPreference?.set(on);
    moveArea({ rail: on, covered: on && !!state.surface });
  };

  const openView = (view: SurfaceView) => {
    const tabs = state.surface?.tabs ?? [];
    show({ tabs: tabs.includes(view) ? tabs : [...tabs, view], active: view });
  };

  function syncFiles() {
    const c = client.getState();
    const inputs = [
      c.workspaces,
      c.sessionReferences,
      c.session?.cwd,
      c.session?.state.checkoutMissing,
      c.folders,
    ];
    if (inputs.some((input, i) => input !== fileContext[i])) {
      fileContext = inputs;
      const workspaceId = workspaceFor(c, c.session?.cwd)?.id;
      const missing = !!c.session && checkoutMissingAt(c, c.session.cwd);
      if (fileWorkspace !== workspaceId || fileCheckoutMissing !== missing) {
        fileWorkspace = workspaceId;
        fileCheckoutMissing = missing;
        if (state.surface)
          set({
            surface: {
              ...state.surface,
              tabs: state.surface.tabs.map((tab) =>
                isView(tab)
                  ? tab
                  : newFile(
                      { kind: "file", path: tab.path, from: tab.from },
                      {
                        requested: tab.requested,
                        aliases: tab.aliases,
                        order: fileRequests.get(tab),
                      },
                    ),
              ),
            },
          });
      }
    }
    const files = state.surface?.tabs.filter((tab): tab is FileTab => !isView(tab)) ?? [];
    for (const [key, controller] of reads) {
      if (!files.some((file) => file.key === key)) {
        controller.abort();
        reads.delete(key);
      }
    }
    for (const file of files) {
      if (!file.workspaceId || !file.pending || reads.has(file.key)) continue;
      const controller = new AbortController();
      reads.set(file.key, controller);
      void readFile(file.workspaceId, file.requested, { signal: controller.signal }).then(
        (result) => completeFile(file.key, controller, { result, status: "" }),
        (error: unknown) =>
          completeFile(file.key, controller, {
            status:
              error instanceof Error
                ? error.message
                : "Could not read this file. Try the link again.",
          }),
      );
    }
  }

  function completeFile(
    key: number,
    controller: AbortController,
    patch: Pick<FileTab, "status" | "result">,
  ) {
    if (controller.signal.aborted) return;
    batch(() => {
      const surface = state.surface;
      const file = surface?.tabs.find((tab): tab is FileTab => !isView(tab) && tab.key === key);
      if (!surface || !file) return;
      const path = patch.result?.path ?? file.requested;
      const matches = surface.tabs.filter(
        (tab): tab is FileTab => !isView(tab) && (tab === file || tab.path === path),
      );
      const latest = matches.reduce((a, b) =>
        (fileRequests.get(a) ?? 0) > (fileRequests.get(b) ?? 0) ? a : b,
      );
      const aliases = [
        ...new Set([file.requested, ...matches.flatMap((tab) => tab.aliases)]),
      ].filter((alias) => alias !== path);
      const resolved = updateFile(
        latest,
        latest === file
          ? { ...patch, path, requested: path, aliases, pending: false }
          : { path, aliases },
      );
      const first = surface.tabs.indexOf(matches[0]);
      set({
        surface: {
          tabs: surface.tabs.flatMap((tab, index) =>
            index === first ? [resolved] : !isView(tab) && matches.includes(tab) ? [] : [tab],
          ),
          active: surface.active === tabKey(file) ? tabKey(resolved) : surface.active,
        },
      });
    });
  }

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
          const route = routeAt();
          set({ settings: route.kind === "settings" ? route.section : null });
          wanted = route;
          moving = true;
        }),
      );
      settle();
      return () => {
        stopClient();
        stopPop();
        for (const read of reads.values()) read.abort();
        reads.clear();
      };
    },
    select,
    openPage: open,
    openNew: (cwd, projectId) => open({ kind: "new", cwd, projectId }),
    openProjects: () => open({ kind: "projects" }),
    openProject: (projectId) => open({ kind: "project", projectId }),
    openSettings: (section = DEFAULT_SETTINGS_SECTION) => {
      batch(() => {
        wanted = null;
        set({ settings: section });
        moved();
      });
    },
    closeSettings,
    openChanges: () => openView("changes"),
    toggleRail: () => {
      if (!state.single) setRail(!state.layout.rail);
    },
    openFile: (spelled, from = state.layout.agent ? "agent" : "surface") => {
      const requested = filePath(spelled, client.getState().session?.cwd);
      const tabs = state.surface?.tabs ?? [];
      const files = tabs.filter((t): t is FileTab => !isView(t));
      const known =
        files.find((t) => t.path === requested) ?? files.find((t) => t.aliases.includes(requested));
      const tab = known
        ? newFile({ kind: "file", path: known.path, from }, { requested, aliases: known.aliases })
        : newFile({ kind: "file", path: requested, from });
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

export function browserSurfaceMemory(): SurfaceMemory {
  const memory = browserMemory("surface");
  return {
    read: memory.read,
    write: (value) => (value === null ? memory.remove() : memory.write(value)),
  };
}

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
