import type { Project } from "@shared/wire";
import { type AppState, sessionKey } from "../../app/store.ts";
import { findProject } from "../../shared/lib/projects.ts";
import {
  folderFor,
  type SessionActivity,
  type SessionEntry,
  sessionCatalog,
} from "../sessions/sessionCatalog.ts";
import { pullRequestView } from "../workspace/pull-requests/pullRequestView.ts";

export function projectStartDirectory(
  state: AppState,
  projectId: string,
  startable: (cwd: string) => boolean,
): string | undefined {
  let newest: { path: string; updatedAt: string } | undefined;
  for (const ref of state.sessionReferences) {
    if (ref.projectId !== projectId || ref.archived) continue;
    const path = folderFor(state, ref.cwd)?.path;
    if (!path || !startable(path)) continue;
    if (!newest || ref.updatedAt > newest.updatedAt) newest = { path, updatedAt: ref.updatedAt };
  }
  return newest?.path;
}

export type ProjectHomeCue = Exclude<SessionActivity, "off">;

export interface ProjectHomeSession extends SessionEntry {
  pullRequest: string | undefined;
  cue: ProjectHomeCue | null;
}

export interface ProjectHome {
  kind: "home";
  project: Project;
  sessions: ProjectHomeSession[];
}

export type ProjectHomeView = { kind: "loading" } | { kind: "missing" } | ProjectHome;

export function projectHome(state: AppState, projectId: string): ProjectHomeView {
  if (!state.registryLoaded) return { kind: "loading" };
  const project = findProject(state, projectId);
  if (!project) return { kind: "missing" };
  const links = new Map(state.sessionReferences.map((r) => [sessionKey(r), r.pullRequest]));
  const sessions = sessionCatalog(state)
    .filter((entry) => entry.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((entry): ProjectHomeSession => {
      const link = links.get(sessionKey(entry));
      return {
        ...entry,
        pullRequest: link ? pullRequestView({ link, pullRequest: null })?.name : undefined,
        cue: entry.activity === "off" ? null : entry.activity,
      };
    });
  return { kind: "home", project, sessions };
}

export function stableOrder(previous: readonly string[], keys: readonly string[]): string[] {
  const present = new Set(keys);
  const kept = previous.filter((key) => present.has(key));
  const known = new Set(kept);
  return [...kept, ...keys.filter((key) => !known.has(key))];
}
