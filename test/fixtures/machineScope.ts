import { LOCAL } from "../../shared/machine.ts";
import { createInbox } from "../../web/src/lib/inbox.ts";
import { createMachineStores } from "../../web/src/lib/machineStores.ts";
import type { MachineScope } from "../../web/src/lib/useMachine.ts";

/** Local's scope as `MachineHost` provides it, for a component rendered without the app. */
export const localMachineScope = (): MachineScope => ({
  machine: LOCAL,
  machines: [LOCAL],
  switchMachine: () => {},
  inbox: createInbox({ connect: () => ({ send: () => "not-sent", close: () => {} }) }),
  ...createMachineStores(() => {})(LOCAL.id),
});
