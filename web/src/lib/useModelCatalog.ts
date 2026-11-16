import { useMemo, useSyncExternalStore } from "react";
import type { ModelCatalogView } from "./modelCatalogs.ts";
import { useMachineScope } from "./useMachine.ts";

export function useModelCatalog(cwd: string | undefined): ModelCatalogView {
  const { catalogs } = useMachineScope();
  const state = useSyncExternalStore(catalogs.subscribe, catalogs.getState);
  return useMemo(() => catalogs.view(state, cwd), [catalogs, state, cwd]);
}
