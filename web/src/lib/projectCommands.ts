/**
 * Project policy for the client, described once: which projects a picker offers, what a project's
 * row offers (each command with whether it is available now and what running it means), whether a
 * project's menu sets apart (`projectMenu`), whether a project draft may be saved (`savableProjectDraft`, creating and editing alike), creating a
 * project and moving a session between projects (`sessionProjectMenu`), and whether a session can
 * start in a project. The sidebar, the session's Project menu, the phone sheet, the command palette
 * and the New session page render these and hand them to the one command host instead of each
 * deciding.
 */
// Relative, not @shared: module tests load this file directly in Node.
import {
  type ClientCommand,
  PROJECT_INSTRUCTIONS_MAX,
  type Project,
} from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { sessionProject } from "./sessionContext.ts";
import { byName } from "./sidebarView.ts";

/** The one project lookup by ID. An unknown or missing ID has no project. */
export function findProject(state: AppState, id: string | null | undefined): Project | undefined {
  return id ? state.projects.find((p) => p.id === id) : undefined;
}

/**
 * What a project picker offers, by name as the sidebar lists projects. The sidebar's menu moves a
 * session away from `current`, so it leaves `current` out; the New page names its choice, so it
 * keeps `current` and can move away from it.
 */
export function projectDestinations(
  state: AppState,
  current: Project | undefined,
  { keepCurrent }: { keepCurrent: boolean },
): Project[] {
  const choices = state.projects.filter((p) => keepCurrent || p.id !== current?.id);
  return choices.sort((a, b) => byName(a.name, b.name));
}

type SessionRef = { cwd: string; sessionId: string };

/** The New project dialog. With `assign`, the created project also takes that session. */
export type ProjectDialog = { assign?: SessionRef };

export type ProjectCommandId =
  | "new-session"
  | "open-project"
  | "settings"
  | "delete"
  | "new-project"
  | "assign";

export type ProjectCommandIcon = "new" | "settings" | "delete" | "folder" | "remove";

export type ProjectCommandIntent =
  /** Open the project's home; it sends nothing. */
  | { kind: "open-project"; projectId: string }
  /** Open the project's settings dialog; it sends nothing. */
  | { kind: "project-settings"; projectId: string }
  /** Open the New project dialog, which creates a project (taking `dialog.assign`). */
  | { kind: "project-dialog"; dialog: ProjectDialog }
  /** Ask before deleting the project. */
  | { kind: "delete-project"; project: Project }
  /** Send this registry change. */
  | { kind: "send"; command: ClientCommand };

export interface ProjectCommand {
  id: ProjectCommandId;
  label: string;
  /** The button's accessible name where the row shows only an icon. */
  ariaLabel?: string;
  icon: ProjectCommandIcon;
  enabled: boolean;
  /** Shown in the destructive style: Delete project. */
  destructive?: true;
  intent: ProjectCommandIntent;
}

/** A project command of one intent kind and icon, for a surface that offers only that command. */
export type ProjectCommandOf<
  K extends ProjectCommandIntent["kind"],
  I extends ProjectCommandIcon = ProjectCommandIcon,
> = ProjectCommand & { icon: I; intent: Extract<ProjectCommandIntent, { kind: K }> };

/**
 * What a project row offers, in order: New session in the project, Project settings (its name and
 * instructions), then Delete. Enablement, one rule per command:
 * - new session, settings: always; each only opens a page or dialog, whose changes wait for a
 *   connection.
 * - delete: connected, since it changes the registry.
 */
export function projectCommands(state: AppState, project: Project): ProjectCommand[] {
  return [
    {
      id: "new-session",
      label: "New session in project",
      ariaLabel: `New session in ${project.name}`,
      icon: "new",
      enabled: true,
      // The project's home starts a session in the project, beside the ones it already has.
      intent: { kind: "open-project", projectId: project.id },
    },
    projectSettingsCommand(project),
    deleteProjectCommand(state, project),
  ];
}

/**
 * A project's menu, which the sidebar's project group and the project's home lay out alike: its
 * rows, then the destructive row set apart. New session in project is not a row: the group offers
 * it as its own button and the home is where sessions start.
 */
export interface ProjectMenuSections {
  manage: ProjectMenuCommand[];
  destructive: ProjectMenuCommand[];
}

const MENU_SECTIONS = {
  manage: ["settings"],
  destructive: ["delete"],
} as const satisfies Record<keyof ProjectMenuSections, readonly ProjectCommandId[]>;

/** The commands a project's menu lists, across its sections. */
export type ProjectMenuCommandId = (typeof MENU_SECTIONS)[keyof typeof MENU_SECTIONS][number];
export type ProjectMenuCommand = ProjectCommand & { id: ProjectMenuCommandId };

const pick = (commands: readonly ProjectCommand[], ids: readonly ProjectMenuCommandId[]) =>
  commands.filter((c): c is ProjectMenuCommand =>
    (ids as readonly ProjectCommandId[]).includes(c.id),
  );

/** A project's menu, from `projectCommands`' descriptors. */
export function projectMenu(commands: readonly ProjectCommand[]): ProjectMenuSections {
  return {
    manage: pick(commands, MENU_SECTIONS.manage),
    destructive: pick(commands, MENU_SECTIONS.destructive),
  };
}

/** Project settings: the dialog for `project`'s name and instructions. */
export function projectSettingsCommand(
  project: Project,
): ProjectCommandOf<"project-settings", "settings"> {
  return {
    id: "settings",
    label: "Project settings",
    icon: "settings",
    enabled: true,
    intent: { kind: "project-settings", projectId: project.id },
  };
}

/** Delete project: asks first, then changes the registry, so it waits for a connection. */
export function deleteProjectCommand(
  state: AppState,
  project: Project,
): ProjectCommandOf<"delete-project", "delete"> {
  return {
    id: "delete",
    label: "Delete project",
    icon: "delete",
    enabled: state.connected,
    destructive: true,
    intent: { kind: "delete-project", project },
  };
}

/** A project's Name and Instructions as the New project and Project settings dialogs edit them. */
export interface ProjectDraft {
  name: string;
  instructions: string;
}

/** The draft New project opens with. */
export const EMPTY_PROJECT_DRAFT: ProjectDraft = { name: "", instructions: "" };

/**
 * The one rule for saving a project draft, whether it creates a project or changes one: the trimmed
 * name and instructions when the name is not blank and the instructions are within
 * `PROJECT_INSTRUCTIONS_MAX`, otherwise nothing. Blank instructions are saveable: the project has none.
 */
export function savableProjectDraft(draft: ProjectDraft): ProjectDraft | undefined {
  const name = draft.name.trim();
  const instructions = draft.instructions.trim();
  if (!name || instructions.length > PROJECT_INSTRUCTIONS_MAX) return undefined;
  return { name, instructions };
}

/**
 * Saving the settings dialog: one registry change carrying each field that differs from the project
 * as saved now, trimmed. A draft `savableProjectDraft` refuses cannot be saved; blank instructions
 * clear them. Nothing to send or no connection leave Save off. The server answers the save.
 */
export function projectSettingsSave(
  state: AppState,
  projectId: string,
  draft: ProjectDraft,
): { allowed: false } | { allowed: true; command: ClientCommand } {
  const project = findProject(state, projectId);
  const saved = savableProjectDraft(draft);
  if (!project || !state.connected || !saved) return { allowed: false };
  const { name, instructions } = saved;
  const renamed = name !== project.name;
  const instructed = instructions !== (project.instructions ?? "");
  if (!renamed && !instructed) return { allowed: false };
  return {
    allowed: true,
    command: {
      _tag: "update_project",
      id: project.id,
      ...(renamed && { name }),
      ...(instructed && { instructions: instructions || null }),
    },
  };
}

/**
 * Open `project`'s home, its branches and other member sessions: the way back from one of its
 * sessions. It only navigates, so it does not wait for a connection.
 */
export function openProjectCommand(project: Project): ProjectCommand {
  return {
    id: "open-project",
    label: `Open project: ${project.name}`,
    icon: "folder",
    enabled: true,
    intent: { kind: "open-project", projectId: project.id },
  };
}

/**
 * New project: the project dialog, which creates a project and, with `assign`, files that session in
 * it. Saving changes the registry, so it waits for a connection.
 */
export function newProjectCommand(
  state: AppState,
  assign?: SessionRef,
): ProjectCommandOf<"project-dialog", "new"> {
  return {
    id: "new-project",
    label: "New project",
    icon: "new",
    enabled: state.connected,
    intent: {
      kind: "project-dialog",
      dialog: assign ? { assign: { cwd: assign.cwd, sessionId: assign.sessionId } } : {},
    },
  };
}

/** Move `session` into `projectId`, or out of every project with null. A registry change, so it waits for a connection. */
export function assignProjectCommand(
  state: AppState,
  session: SessionRef,
  projectId: string | null,
): ProjectCommand {
  return {
    id: "assign",
    label: findProject(state, projectId)?.name ?? "None",
    icon: projectId ? "folder" : "remove",
    enabled: state.connected,
    intent: {
      kind: "send",
      command: {
        _tag: "assign_project",
        cwd: session.cwd,
        sessionId: session.sessionId,
        projectId,
      },
    },
  };
}

/** A project a session can move to, with the command that moves it there. */
export interface ProjectDestination {
  project: Project;
  command: ProjectCommand;
}

/**
 * A session's project membership as its menus offer it: the current project named, an entry that
 * opens the picker ("Move to project" for a member, "Add to project" otherwise), New project and
 * the destinations inside it, and Remove from project for a member. Every row changes the
 * registry, so one rule enables them all: connected. The entry follows it, so a disconnected menu
 * offers a disabled entry rather than a pane of disabled rows. `open` only navigates
 * (`openProjectCommand`).
 */
export interface SessionProjectMenu {
  current: Project | undefined;
  /** Open the current project's home, as the header's project link does. */
  open: ProjectCommand | undefined;
  entry: { label: "Move to project" | "Add to project"; enabled: boolean };
  /** New project, which files the session in the project it creates. */
  create: ProjectCommand;
  /** Projects other than the current one, by name. */
  destinations: ProjectDestination[];
  remove: ProjectCommand | undefined;
}

export function sessionProjectMenu(state: AppState, session: SessionRef): SessionProjectMenu {
  const ref = { cwd: session.cwd, sessionId: session.sessionId };
  const current = sessionProject(state, ref);
  return {
    current,
    open: current ? openProjectCommand(current) : undefined,
    entry: { label: current ? "Move to project" : "Add to project", enabled: state.connected },
    create: newProjectCommand(state, ref),
    destinations: projectDestinations(state, current, { keepCurrent: false }).map((project) => ({
      project,
      command: assignProjectCommand(state, ref, project.id),
    })),
    remove: current
      ? { ...assignProjectCommand(state, ref, null), label: "Remove from project" }
      : undefined,
  };
}
