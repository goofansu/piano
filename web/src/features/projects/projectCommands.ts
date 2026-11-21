import {
  type ClientCommand,
  PROJECT_INSTRUCTIONS_MAX,
  PROJECT_NAME_MAX,
  type Project,
} from "../../../../shared/wire.ts";
import type { AppState } from "../../app/store.ts";
import { byName } from "../../shared/lib/byName.ts";
import { findProject, isProjectDone } from "../../shared/lib/projects.ts";
import { sessionProject, sessionReferenceChangeable } from "../sessions/sessionContext.ts";

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

type SessionRef = { cwd: string; sessionId: string };

export type ProjectDialog = { assign?: SessionRef; newPage?: true };

export type ProjectCommandId =
  | "new-session"
  | "open-project"
  | "settings"
  | "done"
  | "delete"
  | "new-project"
  | "assign";

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
  | { kind: "open-project"; projectId: string }
  | { kind: "project-settings"; projectId: string }
  | { kind: "project-dialog"; dialog: ProjectDialog }
  | { kind: "delete-project"; project: Project }
  | { kind: "send"; command: ClientCommand };

export interface ProjectCommand {
  id: ProjectCommandId;
  label: string;
  ariaLabel?: string;
  icon: ProjectCommandIcon;
  enabled: boolean;
  destructive?: true;
  intent: ProjectCommandIntent;
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

export interface ProjectDraft {
  name: string;
  instructions: string;
}

export const EMPTY_PROJECT_DRAFT: ProjectDraft = { name: "", instructions: "" };

export interface ProjectFieldCheck {
  length: number;
  max: number;
  over: boolean;
}

export interface ProjectDraftCheck {
  name: ProjectFieldCheck;
  instructions: ProjectFieldCheck;
  saved: ProjectDraft | undefined;
}

const fieldCheck = (saved: string, max: number, writing: boolean): ProjectFieldCheck => ({
  length: saved.length,
  max,
  over: writing && saved.length > max,
});

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
): ProjectCommand {
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
  session: SessionRef,
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

export interface ProjectDestination {
  project: Project;
  command: ProjectCommand;
}

export interface SessionProjectMenu {
  current: Project | undefined;
  open: ProjectCommand | undefined;
  entry: { label: "Move to project" | "Add to project"; enabled: boolean };
  create: ProjectCommand | undefined;
  destinations: ProjectDestination[];
  remove: ProjectCommand | undefined;
}

export function openProjectCommands(state: AppState): ProjectDestination[] {
  return projectDestinations(state, undefined, { keepCurrent: true }).map((project) => ({
    project,
    command: openProjectCommand(project),
  }));
}

export function sessionProjectMenu(state: AppState, session: SessionRef): SessionProjectMenu {
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
