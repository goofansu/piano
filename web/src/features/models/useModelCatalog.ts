import { useMemo, useSyncExternalStore } from "react";
import { usePageStores } from "../../app/usePageStores.ts";
import type { ModelCatalogView } from "./modelCatalogs.ts";

export function useModelCatalog(cwd: string | undefined): ModelCatalogView {
  const { catalogs } = usePageStores();
  const state = useSyncExternalStore(catalogs.subscribe, catalogs.getState);
  return useMemo(() => catalogs.view(state, cwd), [catalogs, state, cwd]);
}
