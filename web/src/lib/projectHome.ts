/**
 * A project's home, from what the browser already holds: every member session with its title,
 * folder, branch, last activity and saved pull request name. It sends no request, reads no Git,
 * starts no Pi and opens no history.
 */
import type { Project } from "@shared/wire";
import { type AppState, sessionKey } from "../store.ts";
import { findProject } from "./projectCommands.ts";
import { pullRequestView } from "./pullRequestView.ts";
import { folderFor, type SessionEntry, sessionCatalog } from "./sessionCatalog.ts";

/**
 * Where a session started on a project's home runs by default: the folder of the member session
 * active most recently among those whose folder a session may start in (`startable`, the machine's
 * `startsSessionIn`), at the folder's own checkout rather than that session's worktree. A member
 * whose folder's root is gone gives way to the next newest. None when no such folder is open; a
 * project spans repositories, so nothing else is guessed.
 */
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

export interface ProjectHomeSession extends SessionEntry {
  /** The saved pull request link's name; the home never reads GitHub for it. */
  pullRequest: string | undefined;
}

export interface ProjectHome {
  kind: "home";
  project: Project;
  /** Member sessions, newest activity first; archived ones stay out. */
  sessions: ProjectHomeSession[];
}

/**
 * What a project's address shows: `loading` until the first registry message says which projects
 * exist, then the project's home, or `missing` when the registry has no such project.
 */
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
      };
    });
  return { kind: "home", project, sessions };
}

/**
 * Keeps rows where they were while the page is open: keys already shown keep their order, new ones
 * append at the end, and gone ones drop. The first call (no previous order) takes `keys` as given.
 */
export function stableOrder(previous: readonly string[], keys: readonly string[]): string[] {
  const present = new Set(keys);
  const kept = previous.filter((key) => present.has(key));
  const known = new Set(kept);
  return [...kept, ...keys.filter((key) => !known.has(key))];
}
