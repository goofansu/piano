import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClientMessage, ServerMessage } from "@shared/wire";
import { useConnection } from "@/lib/ws";
import { initialState, reduce } from "@/store";
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
