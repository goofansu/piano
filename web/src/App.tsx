import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClientMessage, ServerMessage } from "@shared/wire";
import { useConnection } from "@/lib/ws";
import { type AppState, initialState, reduce } from "@/store";
import { parseRoute, routePath, type Route } from "@/lib/routes";
import { Sidebar, SidebarRail } from "@/components/Sidebar";
import { SessionView } from "@/components/SessionView";
import { NewSession } from "@/components/NewSession";
import { DialogHost } from "@/components/DialogHost";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const SIDEBAR_KEY = "piano.sidebar";
/** Collapsed, the sidebar is a rail just wide enough for its icons. */
const RAIL_WIDTH = 48;

/** The project of the session on screen, so a new session from the rail starts in the same place. */
function currentProjectPath(s: AppState): string | undefined {
  const cwd = (s.session ?? s.selecting)?.cwd ?? (s.view.kind === "new" ? s.view.cwd : undefined);
  return cwd ? s.projects.find((p) => p.worktrees.some((w) => w.path === cwd))?.path : undefined;
}
const WIDTH_KEY = "piano.sidebarWidth";
/** Sidebar width bounds in px; dragging under the minimum by a margin collapses it. */
const WIDTH = { min: 208, max: 480, default: 288, collapseBelow: 160 };

export default function App() {
  const [state, dispatch] = useReducer(reduce, initialState, (s): AppState =>
    parseRoute(location).kind === "session" ? { ...s, view: { kind: "session" } } : s,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const latest = useRef(state);
  latest.current = state;

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
  const showSidebar = useCallback(() => (wide() ? setCollapsed(false) : setMenuOpen(true)), [setCollapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (wide()) setCollapsed(!latestCollapsed.current);
        else setMenuOpen((o) => !o);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [setCollapsed]);
  const latestCollapsed = useRef(collapsed);
  latestCollapsed.current = collapsed;

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
    dispatch({ type: "server", message: m });
    const notify = (message: string, level?: "success" | "info" | "warning" | "error") =>
      level === "success" ? toast.success(message) : level === "info" ? toast.info(message) : level === "warning" ? toast.warning(message) : level === "error" ? toast.error(message) : toast(message);
    if (m._tag === "error") notify(m.message, "error");
    else if (m._tag === "toast") notify(m.message, m.level);
    else if (m._tag === "worktree_created") notify(`Worktree ${m.branch} created`, "success");
    else if (m._tag === "session" && m.event._tag === "notice") notify(m.event.message, m.event.level);
    else if (m._tag === "session" && m.event._tag === "closed" && !/released|code 0\b/.test(m.event.reason)) toast.warning(`Pi stopped: ${m.event.reason}`);
  }, []);
  const onStatus = useCallback((connected: boolean) => dispatch({ type: "connected", connected }), []);
  const conn = useConnection(onMessage, onStatus);

  const send = useCallback((m: ClientMessage) => conn.send(m), [conn]);
  const select = useCallback(
    (cwd: string, sessionId: string | null) => {
      setMenuOpen(false);
      // Clicking the session already on screen (or already being fetched) is a no-op.
      const current = latest.current.session ?? latest.current.selecting;
      if (current && current.cwd === cwd && current.sessionId === sessionId && latest.current.view.kind === "session") return;
      dispatch({ type: "selecting", cwd, sessionId });
      send({ _tag: "select", cwd, sessionId });
    },
    [send],
  );

  // Re-select the current session after a reconnect so the server re-attaches us.
  useEffect(() => {
    if (state.connected && state.session) send({ _tag: "select", cwd: state.session.cwd, sessionId: state.session.sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected]);

  const openNew = useCallback((cwd?: string) => {
    dispatch({ type: "new", cwd });
    setMenuOpen(false);
  }, []);

  // ── routing ──
  // A route read from the address bar (on load, or on back/forward) that has not been applied yet.
  const wanted = useRef<Route | null>(parseRoute(location));
  const applyRoute = useCallback(() => {
    const r = wanted.current;
    if (!r) return;
    const s = latest.current;
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
    const session = owner?.sessions.find((t) => t.sessionId === r.sessionId);
    if (session) select(session.cwd, session.sessionId);
    else dispatch({ type: "missing-session", sessionId: r.sessionId });
  }, [select]);
  useEffect(applyRoute, [applyRoute, state.projectsLoaded, state.projects]);
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
    const route: Route | null = state.view.kind === "new"
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
    const title = state.view.kind === "missing-session" ? "Session not found" : route.kind === "new" ? "New session" : state.projects.flatMap((p) => p.sessions).find((t) => t.sessionId === route.sessionId)?.title || "Session";
    document.title = `${title} - piano`;
  }, [state.view, state.session, state.selecting, state.projects]);

  const onDraftChange = useCallback((key: string, text: string) => dispatch({ type: "draft_changed", key, text }), []);
  const onDraftAppend = useCallback((key: string, text: string) => dispatch({ type: "draft_appended", key, text }), []);
  const sidebarProps = { state, send, select, openNew };

  // Layer 0 throughout: the sidebar and the main pane share the canvas and meet at a hairline.
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-surface-0 text-ink">
      <aside
        className={cn(
          "relative hidden shrink-0 border-r border-line md:flex md:flex-col",
          !dragging && "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        )}
        style={{ width: collapsed ? RAIL_WIDTH : width }}
      >
        {collapsed ? (
          <SidebarRail onShow={() => setCollapsed(false)} onNew={() => openNew(currentProjectPath(latest.current))} />
        ) : (
          <div className="h-full overflow-hidden">
            <div className="h-full shrink-0" style={{ width }}>
              <Sidebar {...sidebarProps} onHide={() => setCollapsed(true)} />
            </div>
          </div>
        )}
        {!collapsed && (
          // The edge is the handle: drag to resize, double-click to reset, drag past the minimum to hide.
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
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          <Sidebar {...sidebarProps} onHide={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="relative flex min-w-0 flex-1 flex-col">
        {state.view.kind === "new" ? (
          <NewSession state={state} send={send} initialCwd={state.view.cwd} onMenu={showSidebar} />
        ) : state.view.kind === "missing-session" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
            <h1 className="text-xl font-medium">Session not found</h1>
            <p className="text-sm text-ink-2">This session is not in the registry.</p>
            <Button variant="outline" onClick={() => openNew()}>New session</Button>
          </div>
        ) : (
          <SessionView state={state} send={send} onMenu={showSidebar} onDraftChange={onDraftChange} onDraftAppend={onDraftAppend} />
        )}
      </main>
      <DialogHost dialogs={state.session?.dialogs ?? []} send={send} />
    </div>
  );
}
