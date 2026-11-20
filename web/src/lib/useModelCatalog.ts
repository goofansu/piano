import { useMemo, useSyncExternalStore } from "react";
import type { ModelCatalogView } from "./modelCatalogs.ts";
import { usePageStores } from "./usePageStores.ts";

export function useModelCatalog(cwd: string | undefined): ModelCatalogView {
  const { catalogs } = usePageStores();
  const state = useSyncExternalStore(catalogs.subscribe, catalogs.getState);
  return useMemo(() => catalogs.view(state, cwd), [catalogs, state, cwd]);
}
