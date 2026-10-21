/**
 * A project's home, from facts the browser already holds: the session catalog (branch, folder,
 * activity) and the registry's saved pull request links. It reads no Git, starts no Pi and opens no
 * history; a linked pull request's live state is read afterwards (projectPullRequests.ts).
 */
import type { Project, SessionPullRequestLink } from "@shared/wire";
import { type AppState, sessionKey } from "../store.ts";
import { findProject } from "./projectCommands.ts";
import type { PullRequestTarget } from "./projectPullRequests.ts";
import { type SessionEntry, sessionCatalog } from "./sessionCatalog.ts";

/** One member session, with what opening it and reading its pull request need. */
export interface ProjectHomeSession {
  entry: SessionEntry;
  workspaceId: string;
  /** The registry's saved link; absent until discovered, which the home never does. */
  link: SessionPullRequestLink | undefined;
}

/** One branch that member sessions run on in a worktree, shown by its latest session. */
export interface ProjectHomeBranch {
  /** The worktree's directory: one branch per checkout. */
  key: string;
  branch: string;
  folder: string;
  latest: ProjectHomeSession;
  /** The newest member's saved link on this branch, if any member has one. */
  pullRequest: ProjectHomeSession | undefined;
}

export interface ProjectHome {
  project: Project;
  branches: ProjectHomeBranch[];
  /** Members on a folder's own checkout or a directory without a branch. */
  others: ProjectHomeSession[];
}

const newestFirst = (a: ProjectHomeSession, b: ProjectHomeSession) =>
  b.entry.updatedAt.localeCompare(a.entry.updatedAt);

/** The home of `projectId`, or undefined when the registry has no such project. */
export function projectHome(state: AppState, projectId: string): ProjectHome | undefined {
  const project = findProject(state, projectId);
  if (!project) return undefined;
  const refs = new Map(state.sessionReferences.map((r) => [sessionKey(r), r]));
  const members: ProjectHomeSession[] = sessionCatalog(state)
    .filter((entry) => entry.projectId === projectId)
    .map((entry) => {
      const ref = refs.get(sessionKey(entry));
      return { entry, workspaceId: ref?.workspaceId ?? "", link: ref?.pullRequest ?? undefined };
    })
    .sort(newestFirst);
  const byCheckout = new Map<string, ProjectHomeSession[]>();
  const others: ProjectHomeSession[] = [];
  for (const member of members) {
    if (!member.entry.inWorktree || !member.entry.branch) {
      others.push(member);
      continue;
    }
    const group = byCheckout.get(member.entry.cwd);
    if (group) group.push(member);
    else byCheckout.set(member.entry.cwd, [member]);
  }
  const branches = [...byCheckout].map(([key, group]): ProjectHomeBranch => {
    const latest = group[0]!;
    return {
      key,
      branch: latest.entry.branch,
      folder: latest.entry.folder,
      latest,
      pullRequest: group.find((member) => member.link),
    };
  });
  return { project, branches, others };
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

/**
 * The pull requests the home reads: one per branch, and only a saved link. A member without one is
 * never asked about, since that request would make the server discover a pull request.
 */
export function pullRequestTargets(home: ProjectHome): PullRequestTarget[] {
  return home.branches.flatMap(({ pullRequest: member }) =>
    member?.link
      ? [{ workspaceId: member.workspaceId, sessionId: member.entry.sessionId, link: member.link }]
      : [],
  );
}
