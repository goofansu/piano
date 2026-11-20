import { createContext, useContext, useSyncExternalStore } from "react";
import type { PageStores } from "./pageStores.ts";
import type { PreviewObservationState } from "./previewObservation.ts";

export const PageStoresContext = createContext<PageStores | null>(null);

export function usePageStores(): PageStores {
  const stores = useContext(PageStoresContext);
  if (!stores) throw new Error("usePageStores requires a PageStoresContext provider");
  return stores;
}
export const useDrafts = () => usePageStores().drafts;
export const useQuestionReplies = () => usePageStores().questions;
export const usePreviews = () => usePageStores().previews;
export function usePreviewObservation(): PreviewObservationState {
  const previews = usePreviews();
  return useSyncExternalStore(previews.subscribe, previews.getState);
}
