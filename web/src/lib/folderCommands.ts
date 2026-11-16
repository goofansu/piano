import type { FolderView } from "@shared/wire";
import type { AppState } from "../store.ts";

export type FolderCommandId = "new-session" | "close";

export type FolderCommandIntent =
  | { kind: "new-session"; cwd: string }
  | { kind: "close-folder"; folder: { path: string; name: string } };

export interface FolderCommand {
  id: FolderCommandId;
  label: string;
  ariaLabel?: string;
  enabled: boolean;
  intent: FolderCommandIntent;
}

export function folderCommands(
  state: AppState,
  folder: Pick<FolderView, "path" | "name">,
  startsSessionIn: (state: AppState, cwd: string) => boolean,
): { create: FolderCommand; close: FolderCommand } {
  return {
    create: {
      id: "new-session",
      label: "New session here",
      ariaLabel: `New session in ${folder.name}`,
      enabled: startsSessionIn(state, folder.path),
      intent: { kind: "new-session", cwd: folder.path },
    },
    close: {
      id: "close",
      label: "Close",
      enabled: state.connected,
      intent: { kind: "close-folder", folder: { path: folder.path, name: folder.name } },
    },
  };
}
