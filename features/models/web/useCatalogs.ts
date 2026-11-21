import { createContext, useContext } from "react";
import type { ModelCatalogs } from "./modelCatalogs.ts";
export const CatalogsContext = createContext<ModelCatalogs | null>(null);
export function useCatalogs(): ModelCatalogs {
  const value = useContext(CatalogsContext);
  if (!value) throw new Error("Missing Catalogs provider");
  return value;
}
