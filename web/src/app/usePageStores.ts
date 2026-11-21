import { createContext, useContext } from "react";
import type { PageStores } from "./pageStores.ts";

export const PageStoresContext = createContext<PageStores | null>(null);

export function usePageStores(): PageStores {
  const stores = useContext(PageStoresContext);
  if (!stores) throw new Error("usePageStores requires a PageStoresContext provider");
  return stores;
}
export const useDrafts = () => usePageStores().drafts;
export const useQuestionReplies = () => usePageStores().questions;
