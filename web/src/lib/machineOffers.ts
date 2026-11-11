/**
 * What a machine offers in this browser, decided once (ADR 0004). Local offers everything; a
 * remote offers the slice: its registered sessions, their conversation, a new session with a
 * text/image first message in a folder or worktree it already registered, its projects, and a
 * session's rename, pin, archive and delete.
 * Whatever else would manage the remote, read its files or follow its accounts stays on the
 * remote's own Piano.
 */
import type { Command } from "./commands.ts";
import { isLocalId, type Machine } from "./machine.ts";

export interface MachineOffers {
  /** Files and Changes in the Surface area, file links in the transcript, the session rail's Outputs. */
  files: boolean;
  /** The session rail and this browser's switch for it. */
  rail: boolean;
  /** Images attached to a message: the attach button, paste and drop, and sent images shown. */
  attachments: boolean;
  /** The session's pull request, followed in Changes and the session header. */
  pullRequests: boolean;
  /** The selected session's preview, observed for its commands. */
  previews: boolean;
  /** Provider accounts, followed for the commands that need a sign-in. */
  providerAccounts: boolean;
  /** Git's checkout facts kept fresh, worktree creation and Git status on the New page. */
  worktrees: boolean;
  /** Browsing for a directory that is not a folder yet. */
  browse: boolean;
  /** Folder trust beside the New page's directory. */
  trust: boolean;
  /** A folder row's New session and folder menu. */
  folders: boolean;
  /** Settings, and the sidebar's way to it. */
  settings: boolean;
  /** The New page starting in the last directory this browser used. */
  lastDirectory: boolean;
  /** Whether a palette, menu or button command runs here. */
  command: (command: Command) => boolean;
}

const LOCAL_OFFERS: MachineOffers = {
  files: true,
  rail: true,
  attachments: true,
  pullRequests: true,
  previews: true,
  providerAccounts: true,
  worktrees: true,
  browse: true,
  trust: true,
  folders: true,
  settings: true,
  lastDirectory: true,
  command: () => true,
};

/**
 * The registry changes a menu row sends by itself: a project's, a session's place in one, and a
 * session's pin. The rest leave through their dialogs (New project, Rename, Archive, Delete).
 */
const REGISTRY_CHANGES: ReadonlySet<string> = new Set([
  "update_project",
  "delete_project",
  "set_project_done",
  "assign_project",
  "pin_session",
]);

const REMOTE_OFFERS: MachineOffers = {
  files: false,
  rail: false,
  attachments: true,
  pullRequests: false,
  previews: false,
  providerAccounts: false,
  worktrees: false,
  browse: false,
  trust: false,
  // The palette's New session here starts one in a registered folder; the folder row does not.
  folders: false,
  settings: false,
  lastDirectory: false,
  command: (command) => {
    switch (command.intent.kind) {
      case "send":
        return REGISTRY_CHANGES.has(command.intent.command._tag);
      // A session's own life. Sharing publishes through the remote's Radius sign-in: not here.
      case "rename":
      case "archive":
      case "delete":
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
      // Trusting a folder lets its project extensions run on the remote: a remote setting, not here.
      default:
        return false;
    }
  },
};

export const machineOffers = (machine: Machine): MachineOffers =>
  isLocalId(machine.id) ? LOCAL_OFFERS : REMOTE_OFFERS;
