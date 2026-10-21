/**
 * A project's home, from what the browser already holds: every member session with its title,
 * folder, branch, last activity and saved pull request number. It sends no request, reads no Git,
 * starts no Pi and opens no history.
 */
import type { Project } from "@shared/wire";
import { type AppState, sessionKey } from "../store.ts";
import { findProject } from "./projectCommands.ts";
import { pullRequestView } from "./pullRequestView.ts";
import { type SessionEntry, sessionCatalog } from "./sessionCatalog.ts";

export interface ProjectHomeSession extends SessionEntry {
  /** The saved pull request link's number; the home never reads GitHub for it. */
  pullRequest: string | undefined;
}

export interface ProjectHome {
  project: Project;
  /** Member sessions, newest activity first; archived ones stay out. */
  sessions: ProjectHomeSession[];
}

/** The home of `projectId`, or undefined when the registry has no such project. */
export function projectHome(state: AppState, projectId: string): ProjectHome | undefined {
  const project = findProject(state, projectId);
  if (!project) return undefined;
  const links = new Map(state.sessionReferences.map((r) => [sessionKey(r), r.pullRequest]));
  const sessions = sessionCatalog(state)
    .filter((entry) => entry.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((entry): ProjectHomeSession => {
      const link = links.get(sessionKey(entry));
      return {
        ...entry,
        pullRequest: link ? pullRequestView({ link, pullRequest: null })?.number : undefined,
      };
    });
  return { project, sessions };
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
