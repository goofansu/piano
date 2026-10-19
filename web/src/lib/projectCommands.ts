/**
 * Project policy for the client, described once: which projects a picker offers, what a project's
 * row offers (each command with whether it is available now and what running it means), creating a
 * project and moving a session between projects (`sessionProjectMenu`), and whether a session can
 * start in a project. The sidebar, the session's Project menu, the phone sheet, the command palette
 * and the New session page render these and hand them to the one command host instead of each
 * deciding.
 */
import type { ClientCommand, Project } from "@shared/wire";
import type { AppState } from "../store.ts";
import { sessionProject } from "./sessionContext.ts";
import { byName } from "./sidebarView.ts";

/** The one project lookup by ID. An unknown or missing ID has no project. */
export function findProject(state: AppState, id: string | null | undefined): Project | undefined {
  return id ? state.projects.find((p) => p.id === id) : undefined;
}

/** Projects the sidebar lists and pickers offer: archived ones stay out until unarchived. */
export function activeProjects(state: AppState): Project[] {
  return state.projects.filter((p) => !p.archived);
}

/**
 * What a project picker offers, by name as the sidebar lists projects. The sidebar's menu moves a
 * session away from `current`, so it leaves `current` out; the New page names its choice, so it
 * keeps `current`, even archived, and can move away from it.
 */
export function projectDestinations(
  state: AppState,
  current: Project | undefined,
  { keepCurrent }: { keepCurrent: boolean },
): Project[] {
  const choices = activeProjects(state).filter((p) => p.id !== current?.id);
  if (current && keepCurrent) choices.push(current);
  return choices.sort((a, b) => byName(a.name, b.name));
}

/** A session can start in no project or in an active one; an archived project takes no new sessions. */
export function canStartSessionIn(state: AppState, projectId: string | null | undefined): boolean {
  return !findProject(state, projectId)?.archived;
}

type SessionRef = { cwd: string; sessionId: string };

/** The one project dialog: create or rename a project. With `assign`, the saved project also takes that session. */
export type ProjectDialog = { project?: Project; assign?: SessionRef };

export type ProjectCommandId =
  | "new-session"
  | "edit"
  | "archive"
  | "unarchive"
  | "new-project"
  | "assign";

export type ProjectCommandIcon = "new" | "edit" | "archive" | "unarchive" | "folder" | "remove";

export type ProjectCommandIntent =
  /** Open the New session page as the project's home; it sends nothing. */
  | { kind: "new-session"; projectId: string }
  /** Open the project dialog: to rename `dialog.project`, or to create a project (taking `dialog.assign`). */
  | { kind: "project-dialog"; dialog: ProjectDialog }
  /** Send this registry change. */
  | { kind: "send"; command: ClientCommand };

export interface ProjectCommand {
  id: ProjectCommandId;
  label: string;
  /** The button's accessible name where the row shows only an icon. */
  ariaLabel?: string;
  icon: ProjectCommandIcon;
  enabled: boolean;
  intent: ProjectCommandIntent;
}

/**
 * What a project row offers, in order: New session in the project, Edit, then Archive or Unarchive
 * (whichever applies). Enablement, one rule per command:
 * - new session: `canStartSessionIn`; it only opens the New session page, whose send waits for a connection.
 * - edit, archive, unarchive: connected, since each changes the registry.
 */
export function projectCommands(state: AppState, project: Project): ProjectCommand[] {
  const archive = !project.archived;
  return [
    {
      id: "new-session",
      label: "New session in project",
      ariaLabel: `New session in ${project.name}`,
      icon: "new",
      enabled: canStartSessionIn(state, project.id),
      intent: { kind: "new-session", projectId: project.id },
    },
    {
      id: "edit",
      label: "Edit project",
      icon: "edit",
      enabled: state.connected,
      intent: { kind: "project-dialog", dialog: { project } },
    },
    {
      id: archive ? "archive" : "unarchive",
      label: archive ? "Archive project" : "Unarchive project",
      icon: archive ? "archive" : "unarchive",
      enabled: state.connected,
      intent: {
        kind: "send",
        command: { _tag: "archive_project", id: project.id, archived: archive },
      },
    },
  ];
}

/** One command of `project`'s, when it currently applies (Archive and Unarchive exclude each other). */
export function projectCommand(
  state: AppState,
  project: Project,
  id: ProjectCommandId,
): ProjectCommand | undefined {
  return projectCommands(state, project).find((c) => c.id === id);
}

/**
 * New project: the project dialog, which creates a project and, with `assign`, files that session in
 * it. Saving changes the registry, so it waits for a connection.
 */
export function newProjectCommand(state: AppState, assign?: SessionRef): ProjectCommand {
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
 * offers a disabled entry rather than a pane of disabled rows.
 */
export interface SessionProjectMenu {
  current: Project | undefined;
  entry: { label: "Move to project" | "Add to project"; enabled: boolean };
  /** New project, which files the session in the project it creates. */
  create: ProjectCommand;
  /** Active projects other than the current one, by name. */
  destinations: ProjectDestination[];
  remove: ProjectCommand | undefined;
}

export function sessionProjectMenu(state: AppState, session: SessionRef): SessionProjectMenu {
  const ref = { cwd: session.cwd, sessionId: session.sessionId };
  const current = sessionProject(state, ref);
  return {
    current,
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
