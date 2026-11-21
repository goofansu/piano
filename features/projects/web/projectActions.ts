import { type Project } from "../../../shared/wire.ts";
import { byName } from "../../../web/src/shared/lib/byName.ts";
import { findProject, isProjectDone } from "../../../web/src/shared/lib/projects.ts";
import type {
  ProjectCommand,
  ProjectDialog,
  ProjectDestination,
  SessionProjectMenu,
  ProjectCommandId,
} from "../../../web/src/shared/state/projectCommandTypes.ts";
import {
  sessionProject,
  sessionReferenceChangeable,
} from "../../../web/src/shared/state/sessionContext.ts";
import type { AppState } from "../../../web/src/shared/state/state.ts";

export function projectDestinations(
  state: AppState,
  current: Project | undefined,
  { keepCurrent }: { keepCurrent: boolean },
): Project[] {
  const choices = state.projects.filter((p) =>
    p.id === current?.id ? keepCurrent : !isProjectDone(p),
  );
  return choices.sort((a, b) => byName(a.name, b.name));
}

export function projectCommands(state: AppState, project: Project): ProjectCommand[] {
  const done = isProjectDone(project);
  return [
    {
      id: "new-session",
      label: "New session in project",
      ariaLabel: `New session in ${project.name}`,
      icon: "new",
      enabled: true,
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

export interface ProjectMenuSections {
  manage: ProjectMenuCommand[];
  destructive: ProjectMenuCommand[];
}

const MENU_SECTIONS = {
  manage: ["settings", "done"],
  destructive: ["delete"],
} as const satisfies Record<keyof ProjectMenuSections, readonly ProjectCommandId[]>;

export type ProjectMenuCommandId = (typeof MENU_SECTIONS)[keyof typeof MENU_SECTIONS][number];
export type ProjectMenuCommand = ProjectCommand & { id: ProjectMenuCommandId };

const pick = (commands: readonly ProjectCommand[], ids: readonly ProjectMenuCommandId[]) =>
  commands.filter((c): c is ProjectMenuCommand =>
    (ids as readonly ProjectCommandId[]).includes(c.id),
  );

export function projectMenu(commands: readonly ProjectCommand[]): ProjectMenuSections {
  return {
    manage: pick(commands, MENU_SECTIONS.manage),
    destructive: pick(commands, MENU_SECTIONS.destructive),
  };
}

export function projectPageActions(state: AppState) {
  const { view } = state;
  if (view.kind === "projects") return [newProjectCommand(state, {})];
  const project = view.kind === "project" && findProject(state, view.projectId);
  if (!project) return [];
  const { manage, destructive } = projectMenu(projectCommands(state, project));
  return [...manage, ...destructive];
}

export function openProjectCommand(project: Project): ProjectCommand {
  return {
    id: "open-project",
    label: `Open project: ${project.name}`,
    icon: "project",
    enabled: true,
    intent: { kind: "open-project", projectId: project.id },
  };
}

export function newProjectCommand(
  state: AppState,
  { assign, newPage }: ProjectDialog,
): ProjectCommand & { id: "new-project" } {
  return {
    id: "new-project",
    label: "New project",
    icon: "create",
    enabled: assign ? sessionReferenceChangeable(state, assign) : state.connected,
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

export function assignProjectCommand(
  state: AppState,
  session: { cwd: string; sessionId: string },
  projectId: string | null,
): ProjectCommand {
  return {
    id: "assign",
    label: findProject(state, projectId)?.name ?? "None",
    icon: projectId ? "project" : "remove",
    enabled: sessionReferenceChangeable(state, session),
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

export function openProjectCommands(state: AppState): ProjectDestination[] {
  return projectDestinations(state, undefined, { keepCurrent: true }).map((project) => ({
    project,
    command: openProjectCommand(project),
  }));
}

export function sessionProjectMenu(
  state: AppState,
  session: { cwd: string; sessionId: string },
): SessionProjectMenu {
  const ref = { cwd: session.cwd, sessionId: session.sessionId };
  const current = sessionProject(state, ref);
  return {
    current,
    open: current && openProjectCommand(current),
    entry: {
      label: current ? "Move to project" : "Add to project",
      enabled: sessionReferenceChangeable(state, ref),
    },
    create: newProjectCommand(state, { assign: ref }),
    destinations: projectDestinations(state, current, { keepCurrent: false }).map((project) => ({
      project,
      command: assignProjectCommand(state, ref, project.id),
    })),
    remove: current && { ...assignProjectCommand(state, ref, null), label: "Remove from project" },
  };
}
