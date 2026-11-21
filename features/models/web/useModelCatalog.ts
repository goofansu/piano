import { useMemo, useSyncExternalStore } from "react";
import type { ModelCatalogView } from "./modelCatalogs.ts";
import { useCatalogs } from "./useCatalogs.ts";

export function useModelCatalog(cwd: string | undefined): ModelCatalogView {
  const catalogs = useCatalogs();
  const state = useSyncExternalStore(catalogs.subscribe, catalogs.getState);
  return useMemo(() => catalogs.view(state, cwd), [catalogs, state, cwd]);
}
