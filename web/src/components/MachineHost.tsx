import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listMachines } from "@/lib/api";
import { observeDictationPage } from "@/lib/browserDictation";
import { LOCAL, type Machine, machineLocation, machinePath } from "@/lib/machine";
import { forgetUnconfiguredMachines } from "@/lib/machineMemory";
import { createMachineStores } from "@/lib/machineStores";
import { drafts } from "@/lib/messageDraft";
import { questionReplies } from "@/lib/piDialogs";
import { MachineContext } from "@/lib/useMachine";
import { modelCatalogs } from "@/lib/useModelCatalog";

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
  const [paths] = useState(() => new Map<string, string>());
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
    window.addEventListener("popstate", pop);
    return () => {
      controller.abort();
      window.removeEventListener("popstate", pop);
    };
  }, []);
  const switchMachine = (next: string) => {
    if (next === id || !machines.some((m) => m.id === next)) return;
    paths.set(id, machineLocation(location.pathname).pathname);
    history.pushState(null, "", machinePath(next, paths.get(next) ?? "/new"));
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
