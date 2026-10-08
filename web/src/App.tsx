import type { ClientCommand, ServerMessage } from "@shared/wire";
import { cn } from "cn";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { NewSession } from "@/components/NewSession";
import { OutcomeProjectDialogs, OutcomeProjectView, type ProjectDialog } from "@/components/OutcomeProjects";
import { SessionView } from "@/components/SessionView";
import { Sidebar, SidebarRail } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { hasMod } from "@/lib/keys";
import { parseRoute, type Route, routePath } from "@/lib/routes";
import { useConnection } from "@/lib/ws";
import { type Action, type AppState, initialState, reduce, sessionDelivery } from "@/store";

const SIDEBAR_KEY = "piano.sidebar";
/** Collapsed, the sidebar is a rail just wide enough for its icons. */
const RAIL_WIDTH = 48;

const WIDTH_KEY = "piano.sidebarWidth";
/** Sidebar width bounds in px; dragging under the minimum by a margin collapses it. */
const WIDTH = { min: 208, max: 480, default: 288, collapseBelow: 160 };

/** Model catalogs outlive reloads so the picker opens at once; its refresh button re-probes Pi. */
const CATALOGS_KEY = "piano.catalogs";

function storedCatalogs(): AppState["catalogs"] {
  try {
    return JSON.parse(localStorage.getItem(CATALOGS_KEY) ?? "{}") as AppState["catalogs"];
  } catch {
    return {};
  }
}

export default function App() {
  const [state, reactDispatch] = useReducer(reduce, initialState, (s): AppState => {
    const seeded = { ...s, catalogs: storedCatalogs() };
    const route = parseRoute(location);
    return route.kind === "project" ? { ...seeded, view: route } : route.kind === "session" ? { ...seeded, view: { kind: "session" } } : seeded;
  });
  useEffect(() => {
    try {
      const usable = Object.fromEntries(Object.entries(state.catalogs).filter(([, c]) => !c.error));
      localStorage.setItem(CATALOGS_KEY, JSON.stringify(usable));
    } catch { /* storage unavailable: the server cache still answers */ }
  }, [state.catalogs]);
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarReturnFocus = useRef<HTMLElement | null>(null);
  const latest = useRef(state);
  latest.current = state;
  // Socket frames can arrive before React renders. Keep acceptance/correlation current.
  const dispatch = useCallback((action: Action) => {
    latest.current = reduce(latest.current, action);
    reactDispatch(action);
  }, []);

  // ── sidebar ──
  // Hidden or shown on wide screens, remembered per browser; on narrow screens it is a sheet.
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "hidden";
    } catch {
      return false;
    }
  });
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(SIDEBAR_KEY, v ? "hidden" : "shown");
    } catch {
      /* ignore */
    }
  }, []);
  const wide = () => matchMedia("(min-width: 768px)").matches;
  const showSidebar = useCallback(() => {
    if (wide()) { setCollapsed(false); return; }
    sidebarReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuOpen(true);
  }, [setCollapsed]);
  // Resizable by dragging its edge; the width is remembered, and a drag past the minimum collapses it.
  const [width, setWidthState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return v >= WIDTH.min && v <= WIDTH.max ? v : WIDTH.default;
    } catch {
      return WIDTH.default;
    }
  });
  const [dragging, setDragging] = useState(false);
  const setWidth = useCallback((v: number) => {
    setWidthState(v);
    try {
      localStorage.setItem(WIDTH_KEY, String(v));
    } catch {
      /* ignore */
    }
  }, []);
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      let last = width;
      const move = (ev: PointerEvent) => {
        last = ev.clientX;
        setWidthState(Math.min(WIDTH.max, Math.max(WIDTH.min, ev.clientX)));
      };
      const up = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        setDragging(false);
        if (last < WIDTH.collapseBelow) {
          // Collapsed by dragging: come back at the width it had before the drag.
          setWidthState(width);
          setCollapsed(true);
        } else setWidth(Math.min(WIDTH.max, Math.max(WIDTH.min, last)));
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    },
    [width, setWidth, setCollapsed],
  );

  const onMessage = useCallback((m: ServerMessage) => {
    const notifySession = m._tag === "session" && sessionDelivery(latest.current, m) === "apply";
    dispatch({ type: "server", message: m });
    const notify = (message: string, level?: "success" | "info" | "warning" | "error") =>
      level === "success" ? toast.success(message) : level === "info" ? toast.info(message) : level === "warning" ? toast.warning(message) : level === "error" ? toast.error(message) : toast(message);
    if (m._tag === "error") notify(m.message, "error");
    else if (m._tag === "toast") notify(m.message, m.level);
    else if (m._tag === "worktree_result" && m.result.status === "ready" && m.result.creation) notify(`Created ${m.result.branch} from ${m.result.creation.baseBranch} · hooks ${m.result.creation.hooks}`, "success");
    else if (notifySession && m._tag === "session" && m.event._tag === "notice") notify(m.event.message, m.event.level);
    else if (notifySession && m._tag === "session" && m.event._tag === "closed" && !/released|code 0\b/.test(m.event.reason)) toast.warning(`Pi stopped: ${m.event.reason}`);
  }, []);
  const onStatus = useCallback((connected: boolean) => dispatch({ type: "connected", connected }), []);
  const conn = useConnection(onMessage, onStatus);

  const send = useCallback((m: ClientCommand) => {
    if (m._tag === "select" || m._tag === "create_session") {
      const selectionId = crypto.randomUUID();
      dispatch({ type: "selecting", selectionId, cwd: m.cwd, sessionId: m._tag === "select" ? m.sessionId : null });
      conn.send({ ...m, selectionId });
    } else if (m._tag === "act") {
      const s = latest.current;
      if (s.connected && !s.resync && !s.selecting && s.selectionId) conn.send({ ...m, selectionId: s.selectionId });
    } else conn.send(m);
  }, [conn, dispatch]);
  const select = useCallback(
    (cwd: string, sessionId: string | null) => {
      setMenuOpen(false);
      // Clicking the session already on screen (or already being fetched) is a no-op.
      const current = latest.current.session ?? latest.current.selecting;
      if (current && current.cwd === cwd && current.sessionId === sessionId && latest.current.view.kind === "session") return;
      send({ _tag: "select", cwd, sessionId });
    },
    [send],
  );

  // Re-select the current session after a reconnect so the server re-attaches us.
  useEffect(() => {
    const current = latest.current.session ?? latest.current.selecting;
    if (state.connected && current) send({ _tag: "select", cwd: current.cwd, sessionId: current.sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected]);
  useEffect(() => {
    const current = latest.current.session;
    // The reconnect effect above may already have started a fresh attachment.
    if (state.connected && latest.current.resync && current) send({ _tag: "select", cwd: current.cwd, sessionId: current.sessionId });
  }, [state.connected, state.resync, send]);

  const [projectDialog, setProjectDialog] = useState<ProjectDialog | null>(null);
  const openProject = useCallback((projectId: string) => {
    dispatch({ type: "project", projectId });
    setMenuOpen(false);
  }, []);
  const openNew = useCallback((cwd?: string, outcomeProjectId?: string) => {
    dispatch({ type: "new", cwd, outcomeProjectId });
    setMenuOpen(false);
  }, []);

  // ── keyboard flow ──
  const [paletteOpen, setPaletteOpen] = useState(false);
  // One Changes sheet per selected session; the header menu and the palette both open it.
  const [changesOpen, setChangesOpen] = useState(false);
  const [pullRequestOpen, setPullRequestOpen] = useState(false);
  useEffect(() => { setChangesOpen(false); setPullRequestOpen(false); }, [state.session?.cwd, state.session?.sessionId]);
  const toggleSidebar = useCallback(() => {
    if (wide()) setCollapsed(!collapsed);
    else setMenuOpen((open) => !open);
  }, [collapsed, setCollapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (hasMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((open) => !open); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // ── routing ──
  // A route read from the address bar (on load, or on back/forward) that has not been applied yet.
  const wanted = useRef<Route | null>(parseRoute(location));
  const applyRoute = useCallback(() => {
    const r = wanted.current;
    if (!r) return;
    const s = latest.current;
    if (r.kind === "project") { wanted.current = null; openProject(r.projectId); return; }
    if (r.kind === "new") {
      wanted.current = null;
      // Back or forward onto the New page keeps whatever directory it already had.
      if (s.view.kind !== "new") dispatch({ type: "new" });
      return;
    }
    // A session needs its directory, which only the project list knows.
    if (!s.projectsLoaded) return;
    wanted.current = null;
    const owner = s.projects.find((p) => p.sessions.some((t) => t.sessionId === r.sessionId));
    const session = s.sessionReferences.find(t => t.sessionId === r.sessionId) ?? owner?.sessions.find((t) => t.sessionId === r.sessionId);
    if (session) select(session.cwd, session.sessionId);
    else dispatch({ type: "missing-session", sessionId: r.sessionId });
  }, [select, openProject]);
  useEffect(applyRoute, [applyRoute, state.projectsLoaded, state.projects, state.sessionReferences]);
  useEffect(() => {
    const onPop = () => {
      wanted.current = parseRoute(location);
      applyRoute();
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [applyRoute]);
  // The address bar follows the state; a route that is still being applied already matches it.
  useEffect(() => {
    if (wanted.current) return;
    const current = state.session ?? state.selecting;
    const route: Route | null = state.view.kind === "project" ? { kind: "project", projectId: state.view.projectId } : state.view.kind === "new"
      ? { kind: "new" }
      : state.view.kind === "missing-session"
        ? { kind: "session", sessionId: state.view.sessionId }
        : current?.sessionId ? { kind: "session", sessionId: current.sessionId } : null;
    if (!route) return;
    const path = routePath(route);
    if (path !== location.pathname + location.search) {
      // The bare root is an alias for /new and a query string carries nothing: replace those, push real moves.
      if (location.pathname === "/" || location.pathname === path) history.replaceState(null, "", path);
      else history.pushState(null, "", path);
    }
    const title = route.kind === "project" ? state.outcomeProjects.find(p => p.id === route.projectId)?.name || "Project" : state.view.kind === "missing-session" ? "Session not found" : route.kind === "new" ? "New session" : state.sessionReferences.find(t => t.sessionId === route.sessionId)?.title || "Session";
    document.title = `${title} - Piano`;
  }, [state.view, state.session, state.selecting, state.projects, state.outcomeProjects, state.sessionReferences]);

  const onDraftChange = useCallback((key: string, text: string) => dispatch({ type: "draft_changed", key, text }), []);
  const onDraftAppend = useCallback((key: string, text: string) => dispatch({ type: "draft_appended", key, text }), []);
  const sidebarProps = { state, send, select, openNew, openProject, onProjectDialog: setProjectDialog, onPalette: () => setPaletteOpen(true) };
  const working = !!(state.session?.state.isStreaming || state.session?.state.isCompacting || state.session?.state.isRetrying);
  const anyWorking = state.hosts.some((h) => h.streaming);
  // The tab icon presses the keys while the session on screen works.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = working ? "/favicon-working.svg" : "/favicon.svg";
  }, [working]);

  // An inset conversation sheet separates the work from the navigation without extra chrome.
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-surface-0 text-ink">
      <aside
        className={cn(
          "relative hidden shrink-0 md:flex md:flex-col",
          !dragging && "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        )}
        style={{ width: collapsed ? RAIL_WIDTH : width }}
      >
        {collapsed ? (
          <SidebarRail onShow={() => setCollapsed(false)} working={anyWorking} />
        ) : (
          <div className="h-full overflow-hidden">
            <div className="h-full shrink-0" style={{ width }}>
              <Sidebar {...sidebarProps} onHide={() => setCollapsed(true)} />
            </div>
          </div>
        )}
        {!collapsed && (
          // The edge is the handle: drag to resize, double-click to reset, drag past the minimum to hide.
          // biome-ignore lint/a11y/useSemanticElements: a focusable, draggable resize handle; <hr> cannot be one.
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuenow={width}
            aria-valuemin={WIDTH.min}
            aria-valuemax={WIDTH.max}
            title="Drag to resize. Double-click to reset."
            onPointerDown={startResize}
            onDoubleClick={() => setWidth(WIDTH.default)}
            className={cn(
              "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize select-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-brand after:opacity-0 after:transition-opacity hover:after:opacity-100",
              dragging && "after:opacity-100",
            )}
          />
        )}
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="h-dvh w-full border-0 bg-surface-0 p-0 sm:max-w-none" showCloseButton={false} aria-describedby={undefined} onOpenAutoFocus={event => {
          // Focus the sheet itself, not its first button, so no tooltip opens with it.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus?.();
        }} onCloseAutoFocus={event => {
          const target = sidebarReturnFocus.current;
          sidebarReturnFocus.current = null;
          if (target?.isConnected) { event.preventDefault(); target.focus(); }
        }}>
          <SheetTitle className="sr-only">Projects and sessions</SheetTitle>
          <Sidebar {...sidebarProps} onHide={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="sheet-enter relative flex min-w-0 flex-1 flex-col overflow-hidden bg-conversation md:my-2 md:mr-2 md:rounded-2xl md:border md:border-line md:shadow-1">
        {/* The sheet's content fades and rises when the view changes; the sheet itself stays. */}
        <div key={state.view.kind} className="view-enter flex min-h-0 flex-1 flex-col">
          {state.view.kind === "project" ? (
            <OutcomeProjectView state={state} send={send} id={state.view.projectId} select={select} openNew={() => { if (state.view.kind === "project") openNew(undefined, state.view.projectId); }} onDialog={setProjectDialog} onMenu={showSidebar} />
          ) : state.view.kind === "new" ? (
            <NewSession key={state.view.outcomeProjectId ?? "ungrouped"} state={state} send={send} initialCwd={state.view.cwd} outcomeProjectId={state.view.outcomeProjectId} onMenu={showSidebar} />
          ) : state.view.kind === "missing-session" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
              <h1 className="text-xl font-medium">Session not found</h1>
              <p className="text-sm text-ink-2">This session is not in the registry. Its reference may have been removed or deleted.</p>
              <Button variant="outline" onClick={() => openNew()}>New session</Button>
            </div>
          ) : (
            <SessionView state={state} send={send} onMenu={showSidebar} onDraftChange={onDraftChange} onDraftAppend={onDraftAppend} openNew={openNew} changesOpen={changesOpen} onChangesOpenChange={setChangesOpen} pullRequestOpen={pullRequestOpen} onPullRequestOpenChange={setPullRequestOpen} />
          )}
        </div>
        <Toaster
          position="top-center"
          className="toaster group !absolute"
          offset={{ top: 16 }}
          mobileOffset={{ top: 12, left: 16, right: 16 }}
          visibleToasts={4}
          duration={4000}
          closeButton
          toastOptions={{ style: { "--toast-life": "4s" } as React.CSSProperties }}
        />
      </main>
      {projectDialog && <OutcomeProjectDialogs key={JSON.stringify(projectDialog)} state={state} send={send} dialog={projectDialog} close={() => setProjectDialog(null)} openProject={openProject} />}
      <CommandPalette openProject={openProject} onProjectDialog={setProjectDialog} send={send} open={paletteOpen} onOpenChange={setPaletteOpen} state={state} select={select} openNew={openNew} toggleSidebar={toggleSidebar} openChanges={() => setChangesOpen(true)} openPullRequest={() => setPullRequestOpen(true)} />
      <DialogHost dialogs={state.resync ? [] : state.session?.dialogs ?? []} send={send} connected={state.connected && !state.resync && !state.selecting && state.selectionId !== null} />
    </div>
  );
}
