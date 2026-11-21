import type { Project } from "../../../../shared/wire.ts";

export function findProject(
  state: { projects: readonly Project[] },
  id: string | null | undefined,
): Project | undefined {
  return id ? state.projects.find((p) => p.id === id) : undefined;
}

export const isProjectDone = (project: Pick<Project, "doneAt">) => project.doneAt !== undefined;
