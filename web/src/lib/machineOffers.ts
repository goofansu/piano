/**
 * What a machine offers in this browser, decided once (ADR 0004). Local offers everything; a
 * remote offers the slice: its registered sessions, their conversation, a new session with a
 * text/image first message in a folder or worktree it already registered, its projects, and a
 * session's rename, pin, archive and delete, with its Changes, files and session rail, and a
 * registered folder's trust.
 * Whatever else would manage the remote, run its apps or follow its accounts stays on the
 * remote's own Piano.
 */
import type { Command } from "./commands.ts";
import { isLocalId, type Machine } from "./machine.ts";

export interface MachineOffers {
  /** Images attached to a message: the attach button, paste and drop, and sent images shown. */
  attachments: boolean;
  /** The selected session's preview, observed for its commands. */
  previews: boolean;
  /** Provider accounts, followed for the commands that need a sign-in. */
  providerAccounts: boolean;
  /** Git's checkout facts kept fresh, worktree creation and Git status on the New page. */
  worktrees: boolean;
  /** Browsing for a directory that is not a folder yet. */
  browse: boolean;
  /** A folder row's New session and folder menu. */
  folders: boolean;
  /** Settings, and the sidebar's way to it. */
  settings: boolean;
  /** Whether a palette, menu or button command runs here. */
  command: (command: Command) => boolean;
}

const LOCAL_OFFERS: MachineOffers = {
  attachments: true,
  previews: true,
  providerAccounts: true,
  worktrees: true,
  browse: true,
  folders: true,
  settings: true,
  command: () => true,
};

/**
 * The changes a control sends by itself: a project's, a session's place in one, a session's pin,
 * and a registered folder's trust. The rest leave through their dialogs (New project, Rename,
 * Archive, Delete).
 */
const SENT_CHANGES: ReadonlySet<string> = new Set([
  "update_project",
  "delete_project",
  "set_project_done",
  "assign_project",
  "pin_session",
  "set_trust",
]);

const REMOTE_OFFERS: MachineOffers = {
  attachments: true,
  previews: false,
  providerAccounts: false,
  worktrees: false,
  browse: false,
  // The palette's New session here starts one in a registered folder; the folder row does not.
  folders: false,
  settings: false,
  command: (command) => {
    switch (command.intent.kind) {
      case "send":
        return SENT_CHANGES.has(command.intent.command._tag);
      // A session's own life. Sharing publishes through the remote's Radius sign-in: not here.
      case "rename":
      case "archive":
      case "delete":
      // The session's surfaces: Changes with its pull request, the session rail, the Agent area
      // beside them, and the header's Artifacts.
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
      // View options: how this browser lists any machine's catalog.
      case "view":
      // Starting a session in a folder or worktree the remote already registered.
      case "new-session":
        return true;
      // Settings, folders and the rest that manages the remote: not here.
      default:
        return false;
    }
  },
};

export const machineOffers = (machine: Machine): MachineOffers =>
  isLocalId(machine.id) ? LOCAL_OFFERS : REMOTE_OFFERS;
