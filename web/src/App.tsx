import { useCallback, useEffect, useReducer, useState } from "react";
import { toast } from "sonner";
import type { ClientMessage, ServerMessage } from "@shared/wire";
import { useConnection } from "@/lib/ws";
import { initialState, reduce } from "@/store";
import { Sidebar } from "@/components/Sidebar";
import { ThreadView } from "@/components/ThreadView";
import { DialogHost } from "@/components/DialogHost";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export default function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [menuOpen, setMenuOpen] = useState(false);

  const onMessage = useCallback((m: ServerMessage) => {
    dispatch({ type: "server", message: m });
    if (m._tag === "error") toast.error(m.message);
    else if (m._tag === "toast") toast(m.message);
    else if (m._tag === "thread" && m.event._tag === "notice") {
      const { level, message } = m.event;
      if (level === "error") toast.error(message);
      else if (level === "warning") toast.warning(message);
      else toast(message);
    } else if (m._tag === "thread" && m.event._tag === "closed") toast.warning(`pi stopped: ${m.event.reason}`);
  }, []);
  const onStatus = useCallback((connected: boolean) => dispatch({ type: "connected", connected }), []);
  const conn = useConnection(onMessage, onStatus);

  const send = useCallback((m: ClientMessage) => conn.send(m), [conn]);
  const select = useCallback(
    (cwd: string, sessionId: string | null) => {
      dispatch({ type: "selecting", cwd, sessionId });
      send({ _tag: "select", cwd, sessionId });
      setMenuOpen(false);
    },
    [send],
  );

  // Re-select the current thread after a reconnect so the server re-attaches us.
  useEffect(() => {
    if (state.connected && state.thread) send({ _tag: "select", cwd: state.thread.cwd, sessionId: state.thread.sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected]);

  const sidebar = <Sidebar state={state} send={send} select={select} />;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <aside className="hidden w-80 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">{sidebar}</aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-80 p-0">
          {sidebar}
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col">
        <ThreadView state={state} send={send} onMenu={() => setMenuOpen(true)} />
      </main>
      <DialogHost dialogs={state.thread?.dialogs ?? []} send={send} />
    </div>
  );
}
