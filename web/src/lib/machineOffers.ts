import type { AppState } from "../store.ts";
import type { Command } from "./commands.ts";
import { isLocalId, type Machine } from "./machine.ts";
import { folderFor } from "./sessionCatalog.ts";
import { checkoutMissingAt } from "./sessionContext.ts";

export interface MachineOffers {
  providerAccounts: boolean;
  worktrees: boolean;
  browse: boolean;
  folders: boolean;
  settings: boolean;
  command: (command: Command) => boolean;
  startsSessionIn: (state: AppState, cwd: string) => boolean;
}

const LOCAL_OFFERS: MachineOffers = {
  providerAccounts: true,
  worktrees: true,
  browse: true,
  folders: true,
  settings: true,
  command: () => true,
  startsSessionIn: (state, cwd) => !checkoutMissingAt(state, cwd),
};

const SENT_CHANGES: ReadonlySet<string> = new Set([
  "update_project",
  "delete_project",
  "set_project_done",
  "assign_project",
  "pin_session",
  "set_trust",
]);

const REMOTE_OFFERS: MachineOffers = {
  providerAccounts: false,
  worktrees: false,
  browse: false,
  folders: false,
  settings: false,
  command: (command) => {
    switch (command.intent.kind) {
      case "send":
        return SENT_CHANGES.has(command.intent.command._tag);
      case "rename":
      case "archive":
      case "delete":
      case "changes":
      case "pull-request":
      case "session-rail":
      case "agent":
      case "artifacts":
      case "projects":
      case "open-project":
      case "project-dialog":
      case "project-settings":
      case "delete-project":
      case "machine":
      case "copy":
      case "wrap-code":
      case "messages-only":
      case "toggle-sidebar":
      case "appearance":
      case "view":
      case "new-session":
        return true;
      default:
        return false;
    }
  },
  startsSessionIn: (state, cwd) => !!folderFor(state, cwd) && !checkoutMissingAt(state, cwd),
};

export const machineOffers = (machine: Machine): MachineOffers =>
  isLocalId(machine.id) ? LOCAL_OFFERS : REMOTE_OFFERS;
