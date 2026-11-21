import { createContext, useContext } from "react";
import type { Drafts } from "./messageDraft.ts";
export const DraftsContext = createContext<Drafts | null>(null);
export function useDrafts(): Drafts {
  const value = useContext(DraftsContext);
  if (!value) throw new Error("Missing Drafts provider");
  return value;
}
