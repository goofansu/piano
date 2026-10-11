/**
 * What a folder's sidebar row offers, described once, so its buttons and menu hand each command to
 * the one command host instead of carrying it out themselves.
 */
import type { FolderView } from "@shared/wire";
import type { AppState } from "../store.ts";

export type FolderCommandId = "new-session" | "close";

export type FolderCommandIntent =
  /** Open the New session page in the folder; it sends nothing. */
  | { kind: "new-session"; cwd: string }
  /** Ask before closing the folder; the answer sends the registry change. */
  | { kind: "close-folder"; folder: { path: string; name: string } };

export interface FolderCommand {
  id: FolderCommandId;
  label: string;
  /** The button's accessible name where the row shows only an icon. */
  ariaLabel?: string;
  enabled: boolean;
  intent: FolderCommandIntent;
}

/**
 * New session here, then Close. Enablement: New session here always (the New session page's send
 * waits for a connection); Close when connected, since it changes the registry.
 */
export function folderCommands(state: AppState, folder: Pick<FolderView, "path" | "name">): FolderCommand[] {
  return [
    { id: "new-session", label: "New session here", ariaLabel: `New session in ${folder.name}`, enabled: true, intent: { kind: "new-session", cwd: folder.path } },
    { id: "close", label: "Close", enabled: state.connected, intent: { kind: "close-folder", folder: { path: folder.path, name: folder.name } } },
  ];
}
