import {
  type ClientCommand,
  type Project,
  PROJECT_NAME_MAX,
  PROJECT_INSTRUCTIONS_MAX,
} from "../../../shared/wire.ts";
import { findProject } from "../../../web/src/shared/lib/projects.ts";
import type { ProjectDialog } from "../../../web/src/shared/state/projectCommandTypes.ts";
import { inSidebarGroups, sessionCatalog } from "../../../web/src/shared/state/sessionCatalog.ts";
import { sessionReferenceChangeable } from "../../../web/src/shared/state/sessionContext.ts";
import type { AppState } from "../../../web/src/shared/state/state.ts";

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

export type ProjectFormPage =
  | { kind: "project"; projectId: string }
  | { kind: "new"; projectId: string }
  | { kind: "projects" };

type SaveAnswer =
  | { allowed: false }
  | { allowed: true; command: ClientCommand; open?: ProjectFormPage };

export function saveNewProject(
  state: AppState,
  { assign, newPage }: ProjectDialog,
  draft: ProjectDraft,
  newId: () => string,
): SaveAnswer {
  const { saved } = checkProjectDraft(draft);
  if (!state.connected || !saved || (assign && !sessionReferenceChangeable(state, assign)))
    return { allowed: false };
  const { name, instructions } = saved;
  const id = newId();
  return {
    allowed: true,
    command: {
      _tag: "save_project",
      project: { id, name, ...(instructions ? { instructions } : {}) },
      assign: assign && { cwd: assign.cwd, sessionId: assign.sessionId },
    },
    ...(!assign
      ? { open: newPage ? { kind: "new", projectId: id } : { kind: "project", projectId: id } }
      : {}),
  };
}

export function deleteProject(state: AppState, project: Project): SaveAnswer {
  if (!state.connected) return { allowed: false };
  return {
    allowed: true,
    command: { _tag: "delete_project", id: project.id },
    ...("projectId" in state.view && state.view.projectId === project.id
      ? { open: { kind: "projects" } }
      : {}),
  };
}

export function projectDeletionConfirmation(state: AppState, project: Project) {
  const { id } = project;
  const count = sessionCatalog({
    ...state,
    projects: state.projects.filter((p) => p.id !== id),
  }).filter((s) => s.projectId === id && inSidebarGroups(s)).length;
  const moved =
    count === 0
      ? ""
      : count === 1
        ? "; its session moves to No project"
        : `; its ${count} sessions move to No project`;
  return {
    title: "Delete project?",
    description: `"${project.name}" is deleted${moved}. This cannot be undone.`,
    confirmLabel: "Delete",
    destructive: true,
  };
}
