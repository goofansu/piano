import { createContext, useContext, useSyncExternalStore } from "react";
import type { Machine } from "./machine.ts";
import { type MachineOffers, machineOffers } from "./machineOffers.ts";
import type { MachineStores } from "./machineStores.ts";
import type { PreviewObservationState } from "./previewObservation.ts";

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
/** The machine's preview observation: Local's, none on a remote (`MachineStores.previews`). */
export const usePreviews = () => useMachineScope().previews;
const unobserved = () => () => {};
const noObservation = () => undefined;
/** What the machine's preview observation holds now; undefined where it observes no previews. */
export function usePreviewObservation(): PreviewObservationState | undefined {
  const previews = usePreviews();
  return useSyncExternalStore(
    previews?.subscribe ?? unobserved,
    previews?.getState ?? noObservation,
  );
}
