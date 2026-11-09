import { createContext, useContext } from "react";
import type { Machine } from "./machine.ts";
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
export const useRemote = () => (useMachine()?.machine.id ?? "local") !== "local";
export const useDrafts = () => useMachine()?.drafts ?? drafts;
export const useQuestionReplies = () => useMachine()?.questions ?? questionReplies;
