import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listMachines } from "@/lib/api";
import { observeDictationPage } from "@/lib/browserDictation";
import { createInbox } from "@/lib/inbox";
import {
  LOCAL,
  type Machine,
  machineFrameBytes,
  machineLocation,
  machinePath,
  machineSocketUrl,
} from "@/lib/machine";
import { forgetUnconfiguredMachines, machineLocationMemory } from "@/lib/machineMemory";
import { createMachineStores } from "@/lib/machineStores";
import { toastNotify } from "@/lib/toastNotify";
import { MachineContext } from "@/lib/useMachine";
import { browserSocketEnvironment, openConnection } from "@/lib/ws";

/** Drafts and question replies live for this page load; a machine switch disposes its connection, not them. */
export function MachineHost({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState(() => machineLocation(location.pathname).id);
  const [machines, setMachines] = useState<Machine[]>([LOCAL]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [storesFor] = useState(() => createMachineStores(toastNotify));
  // The Inbox outlives a machine switch: it lists every machine, whichever one is selected.
  const [inbox] = useState(() =>
    createInbox({
      connect: (machineId, handlers) =>
        openConnection(handlers, {
          ...browserSocketEnvironment,
          url: () => machineSocketUrl(machineId),
          frameBytes: machineFrameBytes(machineId),
        }),
    }),
  );
  useEffect(() => inbox.stop, [inbox]);
  useEffect(observeDictationPage, []);
  useEffect(() => {
    const controller = new AbortController();
    void listMachines(controller.signal)
      .then((list) => {
        // Only a list the server answered: a failed read forgets nothing.
        forgetUnconfiguredMachines(list);
        setMachines([...list]);
        inbox.setMachines(list);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    // Each machine's navigation remembers the pages shown on it (machineAddress); here only
    // which machine the address names.
    const pop = () => setId(machineLocation(location.pathname).id);
    window.addEventListener("popstate", pop);
    return () => {
      controller.abort();
      window.removeEventListener("popstate", pop);
    };
  }, [inbox]);
  const switchMachine = (next: string, path?: string) => {
    if (next === id || !machines.some((m) => m.id === next)) return;
    history.pushState(
      null,
      "",
      machinePath(next, path ?? machineLocationMemory(next).read() ?? "/new"),
    );
    setId(next);
  };
  const machine = machines.find((m) => m.id === id);
  if (!machine)
    return (
      <Empty className="h-full" role="status">
        <EmptyHeader>
          <EmptyTitle>{error || loaded ? "Machine unavailable" : "Connecting…"}</EmptyTitle>
        </EmptyHeader>
        {(error || loaded) && (
          <EmptyContent>
            <Button variant="outline" onClick={() => switchMachine(LOCAL.id)}>
              Local
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  return (
    <MachineContext key={id} value={{ machine, machines, switchMachine, inbox, ...storesFor(id) }}>
      {children}
    </MachineContext>
  );
}
