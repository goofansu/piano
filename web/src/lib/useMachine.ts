import { createContext, useContext } from "react";
import { LOCAL, type Machine } from "./machine.ts";
import { type MachineOffers, machineOffers } from "./machineOffers.ts";
import type { Drafts } from "./messageDraft.ts";
import { drafts } from "./messageDraft.ts";
import type { ModelCatalogs } from "./modelCatalogs.ts";
import { questionReplies, type QuestionReplies } from "./piDialogs.ts";

export interface MachineScope {
  machine: Machine;
  machines: readonly Machine[];
  switchMachine: (id: string) => void;
  drafts: Drafts;
  questions: QuestionReplies;
  catalogs: ModelCatalogs;
}
export const MachineContext = createContext<MachineScope | null>(null);
export const useMachine = () => useContext(MachineContext);
/** What the selected machine offers in this browser; outside a machine scope, Local's. */
export const useOffers = (): MachineOffers => machineOffers(useMachine()?.machine ?? LOCAL);
export const useDrafts = () => useMachine()?.drafts ?? drafts;
export const useQuestionReplies = () => useMachine()?.questions ?? questionReplies;
