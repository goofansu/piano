import { useMemo, useSyncExternalStore } from "react";
import type { ModelCatalogView } from "./modelCatalogs.ts";
import { useMachineScope } from "./useMachine.ts";

/** One directory's model picker on the selected machine: its catalog, refresh and saved defaults. */
export function useModelCatalog(cwd: string | undefined): ModelCatalogView {
  const { catalogs } = useMachineScope();
  const state = useSyncExternalStore(catalogs.subscribe, catalogs.getState);
  return useMemo(() => catalogs.view(state, cwd), [catalogs, state, cwd]);
}
