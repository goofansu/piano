import type { FolderView } from "@shared/wire";
import type { AppState } from "../store.ts";
import type { MachineOffers } from "./machineOffers.ts";

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
  offers: Pick<MachineOffers, "command" | "startsSessionIn">,
): { create?: FolderCommand; close?: FolderCommand } {
  const create: FolderCommand = {
    id: "new-session",
    label: "New session here",
    ariaLabel: `New session in ${folder.name}`,
    enabled: offers.startsSessionIn(state, folder.path),
    intent: { kind: "new-session", cwd: folder.path },
  };
  const close: FolderCommand = {
    id: "close",
    label: "Close",
    enabled: state.connected,
    intent: { kind: "close-folder", folder: { path: folder.path, name: folder.name } },
  };
  return {
    create: offers.command(create) ? create : undefined,
    close: offers.command(close) ? close : undefined,
  };
}
