import type { Project } from "@shared/wire";
import { type AppState, sessionKey } from "../store.ts";
import { findProject } from "./projectCommands.ts";
import { pullRequestView } from "./pullRequestView.ts";
import {
  folderFor,
  type SessionActivity,
  type SessionEntry,
  sessionCatalog,
} from "./sessionCatalog.ts";

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

function activityCue(
  activity: SessionActivity,
  starting: boolean,
  hostsCurrent: boolean,
): ProjectHomeCue | null {
  if (starting || activity === "off") return null;
  if (activity === "done") return "done";
  return hostsCurrent ? activity : null;
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
  const starting = new Set(state.hosts.filter((h) => h.starting).map(sessionKey));
  const sessions = sessionCatalog(state)
    .filter((entry) => entry.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((entry): ProjectHomeSession => {
      const key = sessionKey(entry);
      const link = links.get(key);
      return {
        ...entry,
        pullRequest: link ? pullRequestView({ link, pullRequest: null })?.name : undefined,
        cue: activityCue(entry.activity, starting.has(key), state.hostsCurrent),
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
