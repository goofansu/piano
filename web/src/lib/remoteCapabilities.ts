import type { Command } from "./commands.ts";

/** The remote slice has conversation controls, not machine-local management surfaces. */
export function remoteCommandAllowed(command: Command): boolean {
  switch (command.intent.kind) {
    case "machine":
    case "copy":
    case "wrap-code":
    case "messages-only":
    case "toggle-sidebar":
    case "appearance":
      return true;
    // Trusting a folder lets its project extensions run on the remote: a remote setting, not here.
    default:
      return false;
  }
}
