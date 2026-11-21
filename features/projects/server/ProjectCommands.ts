import { Effect, Schema } from "effect";
import {
  type Registry,
  RegistryError,
  requireChangeableSession,
} from "../../../server/shared/registry/Registry.ts";
import { Project } from "../../../shared/wire.ts";

function requireProject(projects: readonly Project[], id: string): Project {
  const project = projects.find((p) => p.id === id);
  if (!project)
    throw new RegistryError({ detail: "Project is unavailable. Refresh and try again." });
  return project;
}

export const saveProject = Effect.fn("ProjectCommands.saveProject")(function* (
  registry: Registry["Service"],
  project: Pick<Project, "id" | "name" | "instructions">,
  assign?: { readonly cwd: string; readonly sessionId: string },
) {
  yield* registry.updateProjects((data) => {
    const parsed = Schema.decodeUnknownSync(Project)(project);
    const name = parsed.name.trim();
    if (!name) throw new RegistryError({ detail: "A project needs a name." });
    const assigned =
      assign && requireChangeableSession(data.sessions, assign.cwd, assign.sessionId);
    if (data.projects.some((p) => p.id === parsed.id))
      throw new RegistryError({ detail: "Project already exists. Refresh and try again." });
    const instructions = parsed.instructions?.trim();
    const next = { id: parsed.id, name, ...(instructions ? { instructions } : {}) };
    return {
      projects: [...data.projects, next],
      sessions: assigned
        ? data.sessions.map((s) => (s === assigned ? { ...s, projectId: next.id } : s))
        : data.sessions,
    };
  });
  return "Project created";
});

export const updateProject = Effect.fn("ProjectCommands.updateProject")(function* (
  registry: Registry["Service"],
  id: string,
  change: { readonly name?: string; readonly instructions?: string | null },
) {
  yield* registry.updateProjects((data) => {
    const project = requireProject(data.projects, id);
    const name = change.name?.trim();
    if (name === "") throw new RegistryError({ detail: "A project needs a name." });
    const named = name ? { ...project, name } : project;
    let next = named;
    if (change.instructions !== undefined) {
      const text = change.instructions?.trim();
      const { instructions: _, ...rest } = named;
      next = text ? { ...rest, instructions: text } : rest;
    }
    return { ...data, projects: data.projects.map((p) => (p === project ? next : p)) };
  });
  return "Project saved";
});

export const setProjectDone = Effect.fn("ProjectCommands.setProjectDone")(function* (
  registry: Registry["Service"],
  id: string,
  done: boolean,
) {
  yield* registry.updateProjects((data) => {
    const project = requireProject(data.projects, id);
    if (done === (project.doneAt !== undefined)) return data;
    const { doneAt: _, ...open } = project;
    const next = done ? { ...open, doneAt: new Date().toISOString() } : open;
    return { ...data, projects: data.projects.map((p) => (p === project ? next : p)) };
  });
  return done ? "Project marked done" : "Project reopened";
});

export const deleteProject = Effect.fn("ProjectCommands.deleteProject")(function* (
  registry: Registry["Service"],
  id: string,
) {
  yield* registry.updateProjects((data) => {
    requireProject(data.projects, id);
    return {
      projects: data.projects.filter((p) => p.id !== id),
      sessions: data.sessions.map((s) => (s.projectId === id ? { ...s, projectId: undefined } : s)),
    };
  });
  return "Project deleted";
});

export const assignProject = Effect.fn("ProjectCommands.assignProject")(function* (
  registry: Registry["Service"],
  cwd: string,
  sessionId: string,
  projectId: string | null,
) {
  yield* registry.updateProjects((data) => {
    const entry = requireChangeableSession(data.sessions, cwd, sessionId);
    if (projectId !== null) requireProject(data.projects, projectId);
    return {
      ...data,
      sessions: data.sessions.map((s) =>
        s === entry ? { ...s, projectId: projectId ?? undefined } : s,
      ),
    };
  });
  if (projectId === null) return "Session removed from project";
  return yield* registry.requireProject(projectId).pipe(
    Effect.map((project) => `Session moved to ${project.name}`),
    Effect.orElseSucceed(() => "Session moved"),
  );
});
