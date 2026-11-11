import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { saveDefaults } from "./api.ts";
import { LOCAL } from "./machine.ts";
import {
  browserCatalogStorage,
  createModelCatalogs,
  type ModelCatalogView,
} from "./modelCatalogs.ts";
import { useMachine } from "./useMachine.ts";

/** The page's model catalogs; App seeds the client with them and follows its connection. */
export const modelCatalogs = createModelCatalogs({
  storage: browserCatalogStorage(LOCAL.id),
  notify: (message, level) => (level === "error" ? toast.error(message) : toast.success(message)),
  saveDefaults: (model, effort) => saveDefaults(model, effort),
});

/** One directory's model picker: its catalog, refresh and saved defaults. */
export function useModelCatalog(cwd: string | undefined): ModelCatalogView {
  const catalogs = useMachine()?.catalogs ?? modelCatalogs;
  const state = useSyncExternalStore(catalogs.subscribe, catalogs.getState);
  return useMemo(() => catalogs.view(state, cwd), [catalogs, state, cwd]);
}
