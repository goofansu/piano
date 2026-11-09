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
    case "send":
      return command.intent.command._tag === "set_trust";
    default:
      return false;
  }
}
