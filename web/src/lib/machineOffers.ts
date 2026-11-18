import type { AppState } from "../store.ts";
import type { Command } from "./commands.ts";
import { isLocalId, type Machine } from "./machine.ts";
import { folderFor } from "./sessionCatalog.ts";
import { checkoutMissingAt } from "./sessionContext.ts";

export interface MachineOffers {
  providerAccounts: boolean;
  worktrees: boolean;
  browse: boolean;
  settings: boolean;
  command: (command: Command) => boolean;
  startRefusal: (state: AppState, cwd: string) => StartRefusal | undefined;
  startsSessionIn: (state: AppState, cwd: string) => boolean;
}

export type StartRefusal = "checkout-missing" | "folder-closed";

export const START_REFUSAL_LABELS: Record<StartRefusal, string> = {
  "checkout-missing": "Checkout removed",
  "folder-closed": "Folder closed",
};

const offersStart = (
  startRefusal: MachineOffers["startRefusal"],
): Pick<MachineOffers, "startRefusal" | "startsSessionIn"> => ({
  startRefusal,
  startsSessionIn: (state, cwd) => !startRefusal(state, cwd),
});

const LOCAL_OFFERS: MachineOffers = {
  providerAccounts: true,
  worktrees: true,
  browse: true,
  settings: true,
  command: () => true,
  ...offersStart((state, cwd) => (checkoutMissingAt(state, cwd) ? "checkout-missing" : undefined)),
};

const SENT_CHANGES: ReadonlySet<string> = new Set([
  "update_project",
  "delete_project",
  "set_project_done",
  "assign_project",
  "pin_session",
]);

const REMOTE_OFFERS: MachineOffers = {
  providerAccounts: false,
  worktrees: false,
  browse: false,
  settings: false,
  command: (command) => {
    switch (command.intent.kind) {
      case "send":
        return SENT_CHANGES.has(command.intent.command._tag);
      case "trust":
        return true;
      case "share":
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
  ...offersStart((state, cwd) =>
    checkoutMissingAt(state, cwd)
      ? "checkout-missing"
      : folderFor(state, cwd)
        ? undefined
        : "folder-closed",
  ),
};

export const machineOffers = (machine: Machine): MachineOffers =>
  isLocalId(machine.id) ? LOCAL_OFFERS : REMOTE_OFFERS;
