import { createContext, useContext } from "react";
import type { DraftKey } from "./messageDraft.ts";

/**
 * Every draft's text, from the app store, with the moves that change it. App provides one for the
 * page; a draft editor reads and writes its own key, and anything else that adds to a draft (Ask
 * from Changes, an extension's suggested message) calls `paragraph` here instead of threading a
 * callback through the views.
 */
export interface DraftStore {
  drafts: Readonly<Record<DraftKey, string>>;
  change: (key: DraftKey, text: string) => void;
  /** Adds text at the end as typed, e.g. a key pressed outside the editor. */
  append: (key: DraftKey, text: string) => void;
  /** Adds text as a new paragraph (see `appendParagraph`). */
  paragraph: (key: DraftKey, text: string) => void;
}

export const DraftStoreContext = createContext<DraftStore | null>(null);

export function useDraftStore(): DraftStore {
  const store = useContext(DraftStoreContext);
  if (!store) throw new Error("useDraftStore needs a DraftStoreContext provider");
  return store;
}
