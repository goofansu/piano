import { createContext, type ReactNode } from "react";
import type { LibraryKind } from "../../../../shared/session/libraryTools.ts";

export interface LibraryFile {
  kind: LibraryKind;
  name: string;
  file: string;
  close: () => void;
}

export const RenderLibraryFile = createContext<((file: LibraryFile) => ReactNode) | null>(null);
