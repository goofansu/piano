import { LOCAL } from "../../shared/machine.ts";
import { createMachineStores } from "../../web/src/lib/machineStores.ts";
import type { MachineScope } from "../../web/src/lib/useMachine.ts";

/** Local's scope as `MachineHost` provides it, for a component rendered without the app. */
export const localMachineScope = (): MachineScope => ({
  machine: LOCAL,
  machines: [LOCAL],
  switchMachine: () => {},
  ...createMachineStores(() => {})(LOCAL.id),
});
