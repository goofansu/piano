import { createContext, useContext, useSyncExternalStore } from "react";
import type { Machine } from "./machine.ts";
import { type MachineOffers, machineOffers } from "./machineOffers.ts";
import type { MachineStores } from "./machineStores.ts";
import type { PreviewObservationState } from "./previewObservation.ts";

export interface MachineScope extends MachineStores {
  machine: Machine;
  machines: readonly Machine[];
  switchMachine: (id: string) => void;
  openMachine: (id: string, path: string) => void;
}
export const MachineContext = createContext<MachineScope | null>(null);

export function useMachineScope(): MachineScope {
  const scope = useContext(MachineContext);
  if (!scope) throw new Error("useMachineScope requires a MachineHost");
  return scope;
}
export const useOffers = (): MachineOffers => machineOffers(useMachineScope().machine);
export const useMachineId = (): string => useMachineScope().machine.id;
export const useDrafts = () => useMachineScope().drafts;
export const useQuestionReplies = () => useMachineScope().questions;
export const usePreviews = () => useMachineScope().previews;
const unobserved = () => () => {};
const noObservation = () => undefined;
export function usePreviewObservation(): PreviewObservationState | undefined {
  const previews = usePreviews();
  return useSyncExternalStore(
    previews?.subscribe ?? unobserved,
    previews?.getState ?? noObservation,
  );
}
