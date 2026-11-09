import type { AppState } from "../store.ts";
/**
 * What a machine offers in this browser, decided once (ADR 0004). Local offers everything; a
 * remote offers the slice: its registered sessions, their conversation, and a new session with a
 * text/image first message in a folder or worktree it already registered. Whatever would manage the
 * remote, read its files or follow its accounts stays on the remote's own Piano.
 */
import type { Command } from "./commands.ts";
import { LOCAL, type Machine } from "./machine.ts";

export interface MachineOffers {
  /** Files and Changes in the Surface area, file links in the transcript, the session rail's Outputs. */
  files: boolean;
  /** The session rail and this browser's switch for it. */
  rail: boolean;
  /** Images attached to a message: the attach button, paste and drop, and sent images shown. */
  attachments: boolean;
  /** Voice input in the composer. */
  voiceInput: boolean;
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
  /** Projects: the sidebar's way to the index, the index, a project's home, a session's membership and the New page's choice. */
  projects: boolean;
  /** Session menus in the sidebar row and the session header. */
  sessionManagement: boolean;
  /** Settings, and the sidebar's way to it. */
  settings: boolean;
  /** The New page starting in the last directory this browser used. */
  lastDirectory: boolean;
  /** Whether `kind`, a page or the session pane, is shown rather than "Select a session". */
  view: (kind: AppState["view"]["kind"]) => boolean;
  /** Whether a palette, menu or button command runs here. */
  command: (command: Command) => boolean;
}

const LOCAL_OFFERS: MachineOffers = {
  files: true,
  rail: true,
  attachments: true,
  voiceInput: true,
  pullRequests: true,
  previews: true,
  providerAccounts: true,
  worktrees: true,
  browse: true,
  trust: true,
  folders: true,
  projects: true,
  sessionManagement: true,
  settings: true,
  lastDirectory: true,
  view: () => true,
  command: () => true,
};

const REMOTE_OFFERS: MachineOffers = {
  files: false,
  rail: false,
  attachments: true,
  voiceInput: false,
  pullRequests: false,
  previews: false,
  providerAccounts: false,
  worktrees: false,
  browse: false,
  trust: false,
  // The palette's New session here starts one in a registered folder; the folder row does not.
  folders: false,
  projects: false,
  sessionManagement: false,
  settings: false,
  lastDirectory: false,
  view: (kind) => kind === "session" || kind === "new",
  command: (command) => {
    switch (command.intent.kind) {
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

/** Local answers on this Piano's own socket and APIs; any other machine through its gateway. */
export const isLocal = (machine: Machine) => machine.id === LOCAL.id;

export const machineOffers = (machine: Machine): MachineOffers =>
  isLocal(machine) ? LOCAL_OFFERS : REMOTE_OFFERS;
