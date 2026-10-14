/**
 * The one runner for every command a surface offers: global, project, folder and session. Surfaces
 * render descriptors and call `run(command)`; this decides what running one means, and refuses one
 * that is not enabled, whichever surface offered it. `CommandHost` supplies the effects.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ClientCommand } from "../../../shared/wire.ts";
import type { FolderCommand } from "./folderCommands.ts";
import type { Appearance, GlobalCommand } from "./globalCommands.ts";
import type { Panel } from "./navigation.ts";
import type { ProjectCommand, ProjectDialog } from "./projectCommands.ts";
import type { SettingsSection } from "./routes.ts";
import type { SessionCommand, SessionDisplay, SessionTarget } from "./sessionCommands.ts";
import type { SidebarView } from "./sidebarView.ts";

export type Command = GlobalCommand | ProjectCommand | FolderCommand | SessionCommand;

/**
 * A radio group as a menu renders it: the checked choice's id (the group's value), that choice's
 * name for a submenu trigger, and every choice in order. With none checked both are empty.
 */
export interface RadioChoice<C> {
  value: string;
  currentLabel: string;
  items: C[];
}

export function radioChoiceOf<
  C extends { id: string; label: string; menuLabel?: string; checked?: boolean },
>(items: C[]): RadioChoice<C> {
  const current = items.find((c) => c.checked);
  return {
    value: current?.id ?? "",
    currentLabel: current ? (current.menuLabel ?? current.label) : "",
    items,
  };
}

/** A form the host owns, which asks before anything changes; `answerForm` re-checks its rule. */
export type CommandForm =
  | { kind: "rename-session"; target: SessionTarget }
  | { kind: "delete-session"; target: SessionTarget }
  | { kind: "share-session"; target: SessionTarget }
  | { kind: "archive-session"; target: SessionTarget }
  | { kind: "close-folder"; folder: { path: string; name: string } }
  | { kind: "project"; dialog: ProjectDialog };

/** What running a command can do; the host binds each to navigation, the client, and its own forms. */
export interface CommandEffects {
  send: (message: ClientCommand) => void;
  closeSettings: () => void;
  openSettings: (section?: SettingsSection) => void;
  openNew: (cwd?: string, projectId?: string) => void;
  openPanel: (panel: Panel) => void;
  toggleSidebar: () => void;
  setAppearance: (appearance: Appearance) => void;
  setView: (change: Partial<SidebarView>) => void;
  setDisplay: (display: SessionDisplay) => void;
  copy: (value: string, label: string) => void;
  openForm: (form: CommandForm) => void;
}

/** Carry out `command`'s intent. A disabled command does nothing; the result says whether it ran. */
export function runCommand(command: Command, effects: CommandEffects): boolean {
  if (!command.enabled) return false;
  const intent = command.intent;
  switch (intent.kind) {
    case "send":
      effects.send(intent.command);
      break;
    case "home":
      effects.closeSettings();
      break;
    case "settings":
      effects.openSettings(intent.section);
      break;
    case "new-session":
      effects.openNew(
        "cwd" in intent ? intent.cwd : undefined,
        "projectId" in intent ? intent.projectId : undefined,
      );
      break;
    case "toggle-sidebar":
      effects.toggleSidebar();
      break;
    case "appearance":
      effects.setAppearance(intent.appearance);
      break;
    case "view":
      effects.setView(intent.change);
      break;
    case "project-dialog":
      effects.openForm({ kind: "project", dialog: intent.dialog });
      break;
    case "close-folder":
      effects.openForm({ kind: "close-folder", folder: intent.folder });
      break;
    case "copy":
      effects.copy(intent.value, intent.label);
      break;
    case "open-file":
      effects.openPanel("file");
      break;
    case "changes":
      effects.openPanel("changes");
      break;
    case "pull-request":
      effects.openPanel("pr");
      break;
    case "display":
      effects.setDisplay(intent.display);
      break;
    // An enabled session command always has its target; the guard only narrows the type.
    case "rename":
      if (!intent.target) return false;
      effects.openForm({ kind: "rename-session", target: intent.target });
      break;
    case "share":
      if (!intent.target) return false;
      effects.openForm({ kind: "share-session", target: intent.target });
      break;
    case "delete":
      if (!intent.target) return false;
      effects.openForm({ kind: "delete-session", target: intent.target });
      break;
    case "archive":
      if (!intent.target) return false;
      if (intent.confirm) {
        effects.openForm({ kind: "archive-session", target: intent.target });
        break;
      }
      effects.send({
        _tag: "archive_session",
        cwd: intent.target.cwd,
        sessionId: intent.target.sessionId,
      });
      break;
  }
  return true;
}
