import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClientMessage, ServerMessage } from "@shared/wire";
import { useConnection } from "@/lib/ws";
import { initialState, reduce } from "@/store";
import { parseRoute, routePath, type Route } from "@/lib/routes";
import { Sidebar } from "@/components/Sidebar";
import { SessionView } from "@/components/SessionView";
import { NewSession } from "@/components/NewSession";
import { DialogHost } from "@/components/DialogHost";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export default function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [menuOpen, setMenuOpen] = useState(false);
  const latest = useRef(state);
  latest.current = state;

  const onMessage = useCallback((m: ServerMessage) => {
    dispatch({ type: "server", message: m });
    if (m._tag === "error") toast.error(m.message);
    else if (m._tag === "toast") toast(m.message);
    else if (m._tag === "worktree_created") toast(`Worktree ${m.branch} created`);
    else if (m._tag === "session" && m.event._tag === "notice") {
      const { level, message } = m.event;
      if (level === "error") toast.error(message);
      else if (level === "warning") toast.warning(message);
      else toast(message);
    } else if (m._tag === "session" && m.event._tag === "closed" && !/released|code 0\b/.test(m.event.reason)) toast.warning(`pi stopped: ${m.event.reason}`);
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
      dispatch({ type: "new", cwd: r.cwd });
      return;
    }
    // A session needs its directory, which only the project list knows.
    if (!s.projectsLoaded) return;
    wanted.current = null;
    const owner = s.projects.find((p) => p.sessions.some((t) => t.sessionId === r.sessionId));
    const session = owner?.sessions.find((t) => t.sessionId === r.sessionId);
    if (session) select(session.cwd, session.sessionId);
    else dispatch({ type: "new", cwd: owner?.path });
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
    const route: Route | null = state.view.kind === "new" ? { kind: "new", cwd: state.view.cwd } : current?.sessionId ? { kind: "session", sessionId: current.sessionId } : null;
    if (!route) return;
    const path = routePath(route);
    if (path !== location.pathname + location.search) {
      // The bare root is only ever an alias for /new; do not leave it in history.
      if (location.pathname === "/") history.replaceState(null, "", path);
      else history.pushState(null, "", path);
    }
    const title = route.kind === "new" ? "New session" : state.projects.flatMap((p) => p.sessions).find((t) => t.sessionId === route.sessionId)?.title || "Session";
    document.title = `${title} - piano`;
  }, [state.view, state.session, state.selecting, state.projects]);

  const sidebar = <Sidebar state={state} send={send} select={select} openNew={openNew} />;

  // Layer 0 throughout: the sidebar and the main pane share the canvas and meet at a hairline.
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-surface-0 text-ink">
      <aside className="hidden w-72 shrink-0 border-r border-line md:flex md:flex-col">{sidebar}</aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          {sidebar}
        </SheetContent>
      </Sheet>
      <main className="relative flex min-w-0 flex-1 flex-col">
        {state.view.kind === "new" ? (
          <NewSession state={state} send={send} initialCwd={state.view.cwd} onMenu={() => setMenuOpen(true)} />
        ) : (
          <SessionView state={state} send={send} onMenu={() => setMenuOpen(true)} />
        )}
      </main>
      <DialogHost dialogs={state.session?.dialogs ?? []} send={send} />
    </div>
  );
}
