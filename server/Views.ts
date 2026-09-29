/** Sidebar view: projects with their worktrees and a flat, recent-first session list, all from piano's registry. */
import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { ProjectView, SessionInfo, WorktreeView } from "../shared/wire.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { currentBranch } from "./Worktrees.ts";

export const buildProjects: Effect.Effect<ProjectView[], never, SessionHosts | Registry> = Effect.gen(function* () {
  const hosts = yield* SessionHosts;
  const registry = yield* Registry;
  const running = yield* hosts.list;
  const data = yield* registry.get;
  const hostOf = (cwd: string, sessionId: string) => running.find((h) => h.cwd === cwd && h.sessionId === sessionId);

  return yield* Effect.forEach(data.projects, (path) => Effect.gen(function* () {
    const worktrees: WorktreeView[] = [
      { branch: yield* currentBranch(path), path, main: true },
      ...data.worktrees.filter((w) => w.project === path && existsSync(w.path)).map((w) => ({ branch: w.branch, path: w.path, main: false })),
    ];
    const branchOf = new Map(worktrees.map((w) => [w.path, w.branch]));
    const sessions: SessionInfo[] = data.sessions
      .filter((t) => !t.archived && branchOf.has(t.cwd))
      .map((t) => {
        const h = hostOf(t.cwd, t.sessionId);
        return {
          sessionId: t.sessionId,
          cwd: t.cwd,
          branch: branchOf.get(t.cwd) ?? "",
          title: t.title,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          hosted: !!h,
          streaming: !!h?.streaming,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { path, name: path.split("/").filter(Boolean).pop() ?? path, worktrees, sessions };
  }), { concurrency: 4 });
});
