/**
 * Shared client policy for project commands, membership choices and draft validation. Returns
 * descriptors rather than executing commands, so menus, pickers and the palette use the same
 * availability rules and hand effects to the command host.
 */
// Relative, not @shared: module tests load this file directly in Node.
import {
  type ClientCommand,
  PROJECT_INSTRUCTIONS_MAX,
  PROJECT_NAME_MAX,
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

/**
 * The New project dialog. With `assign`, the created project also takes that session. With
 * `newPage`, the New page's project picker opened it, and the created project becomes that page's
 * project; otherwise the created project's home opens.
 */
export type ProjectDialog = { assign?: SessionRef; newPage?: true };

export type ProjectCommandId =
  | "new-session"
  | "open-project"
  | "settings"
  | "done"
  | "delete"
  | "new-project"
  | "assign";

/**
 * `new` starts a session (the pen, as the sidebar's New session); `create` adds any other thing (the
 * plus: New project, New webhook, New skill, New prompt, Add MCP server). `project` stands for a
 * project (the target, as the sidebar and the Projects index show one), so the folder icon means
 * only a folder.
 */
export type ProjectCommandIcon =
  | "new"
  | "create"
  | "settings"
  | "done"
  | "reopen"
  | "delete"
  | "project"
  | "remove";

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

/** Whether the project is marked done: listed under Done on the index, its group last in the sidebar. */
export const isProjectDone = (project: Pick<Project, "doneAt">) => project.doneAt !== undefined;

/**
 * What a project row offers, in order: New session in the project, Project settings (its name and
 * instructions), Mark project done (Reopen project for a done one), then Delete. Enablement, one
 * rule per command:
 * - new session, settings: always; each only opens a page or dialog, whose changes wait for a
 *   connection.
 * - done, delete: connected, since each changes the registry.
 */
export function projectCommands(state: AppState, project: Project): ProjectCommand[] {
  const done = isProjectDone(project);
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
    {
      id: "settings",
      label: "Project settings",
      icon: "settings",
      enabled: true,
      intent: { kind: "project-settings", projectId: project.id },
    },
    {
      id: "done",
      label: done ? "Reopen project" : "Mark project done",
      icon: done ? "reopen" : "done",
      enabled: state.connected,
      intent: {
        kind: "send",
        command: { _tag: "set_project_done", id: project.id, done: !done },
      },
    },
    {
      id: "delete",
      label: "Delete project",
      icon: "delete",
      enabled: state.connected,
      destructive: true,
      intent: { kind: "delete-project", project },
    },
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
  manage: ["settings", "done"],
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

/** A project's Name and Instructions as the New project and Project settings dialogs edit them. */
export interface ProjectDraft {
  name: string;
  instructions: string;
}

/** The draft New project opens with. */
export const EMPTY_PROJECT_DRAFT: ProjectDraft = { name: "", instructions: "" };

/** A draft field's trimmed length and whether writing it would exceed its limit. */
export interface ProjectFieldCheck {
  /** The field's length once trimmed, in UTF-16 code units as the browser counts them. */
  length: number;
  max: number;
  /** An intended write exceeds the limit; an unchanged stored value is not a write. */
  over: boolean;
}

/** What `checkProjectDraft` decides about a draft: each field against its limit, and what saving it saves. */
export interface ProjectDraftCheck {
  name: ProjectFieldCheck;
  instructions: ProjectFieldCheck;
  /** The trimmed draft, when it may be saved; otherwise undefined. */
  saved: ProjectDraft | undefined;
}

const fieldCheck = (saved: string, max: number, writing: boolean): ProjectFieldCheck => ({
  length: saved.length,
  max,
  over: writing && saved.length > max,
});

/**
 * The one rule for saving a project draft, whether it creates a project or changes one, and what the
 * dialogs show of it. Creation writes every field; settings writes only fields differing from
 * `opened`. Stored values may predate today's limits, so unchanged fields do not block an edit.
 * Blank instructions clear them; a name write cannot be blank. Lengths count trimmed text.
 */
export function checkProjectDraft(draft: ProjectDraft, opened?: ProjectDraft): ProjectDraftCheck {
  const name = draft.name.trim();
  const instructions = draft.instructions.trim();
  const checks = {
    name: fieldCheck(name, PROJECT_NAME_MAX, name !== opened?.name),
    instructions: fieldCheck(
      instructions,
      PROJECT_INSTRUCTIONS_MAX,
      instructions !== opened?.instructions,
    ),
  };
  const savable = (name === opened?.name || name) && !checks.name.over && !checks.instructions.over;
  return { ...checks, saved: savable ? { name, instructions } : undefined };
}

/**
 * Build a settings update containing only fields changed from `opened` (the current saved project
 * when omitted). Untouched fields are not sent, preserving concurrent edits to those fields;
 * this is not conflict detection for fields the user also edited.
 *
 * Validate only intended writes against today's limits and return their field feedback. Blank
 * instructions clear them. No changed fields, a missing project, invalid input or a disconnected
 * client returns `allowed: false`. This function sends nothing; the server validates the update.
 */
export function projectSettingsSave(
  state: AppState,
  projectId: string,
  draft: ProjectDraft,
  opened?: ProjectDraft,
): { projectCheck: ProjectDraftCheck } & (
  | { allowed: false }
  | { allowed: true; command: ClientCommand }
) {
  const project = findProject(state, projectId);
  const base =
    opened ?? (project && { name: project.name, instructions: project.instructions ?? "" });
  const projectCheck = checkProjectDraft(draft, base);
  const { saved } = projectCheck;
  if (!project || !state.connected || !saved || !base) return { allowed: false, projectCheck };
  const { name, instructions } = saved;
  const renamed = name !== base.name;
  const instructed = instructions !== base.instructions;
  if (!renamed && !instructed) return { allowed: false, projectCheck };
  return {
    allowed: true,
    projectCheck,
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
    icon: "project",
    enabled: true,
    intent: { kind: "open-project", projectId: project.id },
  };
}

/**
 * New project: the project dialog, which creates a project and, with `assign`, files that session in
 * it; with `newPage`, offered by the New page's project picker. Saving changes the registry, so it
 * waits for a connection.
 */
export function newProjectCommand(
  state: AppState,
  { assign, newPage }: ProjectDialog = {},
): ProjectCommand {
  return {
    id: "new-project",
    label: "New project",
    icon: "create",
    enabled: state.connected,
    intent: {
      kind: "project-dialog",
      dialog: assign
        ? { assign: { cwd: assign.cwd, sessionId: assign.sessionId } }
        : newPage
          ? { newPage }
          : {},
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
    icon: projectId ? "project" : "remove",
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
    create: newProjectCommand(state, { assign: ref }),
    destinations: projectDestinations(state, current, { keepCurrent: false }).map((project) => ({
      project,
      command: assignProjectCommand(state, ref, project.id),
    })),
    remove: current
      ? { ...assignProjectCommand(state, ref, null), label: "Remove from project" }
      : undefined,
  };
}
