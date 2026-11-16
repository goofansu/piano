import { LOCAL } from "../../shared/machine.ts";
import { createMachineStores } from "../../web/src/lib/machineStores.ts";
import type { MachineScope } from "../../web/src/lib/useMachine.ts";

export const localMachineScope = (): MachineScope => ({
  machine: LOCAL,
  machines: [LOCAL],
  switchMachine: () => {},
  ...createMachineStores(() => {})(LOCAL.id),
});
