import { createContext } from "react";

/** The element a pane scrolls, for content that renders only what is in view (long code): null
 * while the pane is mounting, undefined outside any pane. */
export const ScrollRootContext = createContext<HTMLElement | null | undefined>(undefined);
