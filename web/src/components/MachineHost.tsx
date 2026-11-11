import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listMachines } from "@/lib/api";
import { observeDictationPage } from "@/lib/browserDictation";
import { LOCAL, type Machine, machineLocation, machinePath } from "@/lib/machine";
import { forgetUnconfiguredMachines, machineLocationMemory } from "@/lib/machineMemory";
import { createMachineStores } from "@/lib/machineStores";
import { drafts } from "@/lib/messageDraft";
import { questionReplies } from "@/lib/piDialogs";
import { MachineContext } from "@/lib/useMachine";
import { modelCatalogs } from "@/lib/useModelCatalog";

/** Where the user is, remembered for the machine the address names; none names nothing. */
function rememberLocation() {
  const { id, pathname } = machineLocation(location.pathname);
  if (id) machineLocationMemory(id).write(pathname);
}

/** Drafts and question replies live for this page load; a machine switch disposes its connection, not them. */
export function MachineHost({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState(() => machineLocation(location.pathname).id);
  const [machines, setMachines] = useState<Machine[]>([LOCAL]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [storesFor] = useState(() =>
    createMachineStores(
      { drafts, catalogs: modelCatalogs, questions: questionReplies },
      (message) => toast.error(message),
    ),
  );
  useEffect(observeDictationPage, []);
  useEffect(() => {
    const controller = new AbortController();
    void listMachines(controller.signal)
      .then((list) => {
        // Only a list the server answered: a failed read forgets nothing.
        forgetUnconfiguredMachines(list);
        setMachines([...list]);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    const pop = () => setId(machineLocation(location.pathname).id);
    // Leaving the page counts as leaving its machine: the next visit can switch back to here.
    const leave = () => rememberLocation();
    window.addEventListener("popstate", pop);
    window.addEventListener("pagehide", leave);
    return () => {
      controller.abort();
      window.removeEventListener("popstate", pop);
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  const switchMachine = (next: string) => {
    if (next === id || !machines.some((m) => m.id === next)) return;
    rememberLocation();
    history.pushState(null, "", machinePath(next, machineLocationMemory(next).read() ?? "/new"));
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
    <MachineContext key={id} value={{ machine, machines, switchMachine, ...storesFor(id) }}>
      {children}
    </MachineContext>
  );
}
