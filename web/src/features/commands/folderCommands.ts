import type { FolderView } from "@shared/wire";
import type { AppState } from "../../app/store.ts";
import { checkoutMissingAt } from "../sessions/sessionContext.ts";

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
): { create: FolderCommand; close: FolderCommand } {
  const create: FolderCommand = {
    id: "new-session",
    label: "New session here",
    ariaLabel: `New session in ${folder.name}`,
    enabled: !checkoutMissingAt(state, folder.path),
    intent: { kind: "new-session", cwd: folder.path },
  };
  const close: FolderCommand = {
    id: "close",
    label: "Close",
    enabled: state.connected,
    intent: { kind: "close-folder", folder: { path: folder.path, name: folder.name } },
  };
  return { create, close };
}
