import { createContext, useContext } from "react";
import type { Machine } from "./machine.ts";
import { type MachineOffers, machineOffers } from "./machineOffers.ts";
import type { MachineStores } from "./machineStores.ts";

export interface MachineScope extends MachineStores {
  machine: Machine;
  machines: readonly Machine[];
  switchMachine: (id: string) => void;
}
export const MachineContext = createContext<MachineScope | null>(null);

/**
 * The machine everything below `MachineHost` is for. There is no default: a component rendered
 * outside a machine would otherwise reach Local, where the same workspace and session IDs may
 * name something else (INV-07).
 */
export function useMachineScope(): MachineScope {
  const scope = useContext(MachineContext);
  if (!scope) throw new Error("useMachineScope requires a MachineHost");
  return scope;
}
/** What the selected machine offers in this browser. */
export const useOffers = (): MachineOffers => machineOffers(useMachineScope().machine);
/** The machine a request is for, captured where it is made (`MachineRequest.machineId`). */
export const useMachineId = (): string => useMachineScope().machine.id;
export const useDrafts = () => useMachineScope().drafts;
export const useQuestionReplies = () => useMachineScope().questions;
