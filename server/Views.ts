/** Registry selects directories/sessions; Git/Worktrunk supply current facts, never cached registry branches. */
import { Effect } from "effect";
import type { ProjectView, SessionInfo, WorktreeView } from "../shared/wire.ts";
import { projectTrust } from "./ProjectTrust.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { listWorktrees } from "./Worktrees.ts";

export const buildProjects: Effect.Effect<ProjectView[], never, SessionHosts | Registry> = Effect.gen(function* () {
  const hosts = yield* SessionHosts;
  const registry = yield* Registry;
  const running = yield* hosts.list;
  const data = yield* registry.get;
  const hostOf = (cwd: string, sessionId: string) => running.find((h) => h.cwd === cwd && h.sessionId === sessionId);

  return yield* Effect.forEach(data.projects, (path) => Effect.gen(function* () {
    const discovery = yield* listWorktrees(path);
    const paths = new Set([path, ...data.worktrees.filter(w => w.project === path).map(w => w.path)]);
    const worktrees: WorktreeView[] = yield* Effect.forEach([...paths], cwd => Effect.map(projectTrust(cwd), trust => {
      const facts = discovery.status === "ready" ? discovery.worktrees.find(w => w.path === (cwd === path ? discovery.currentPath : cwd)) : undefined;
      return { workspace: data.workspaces.find(w => w.path === cwd)!, trust, path: cwd, branch: facts?.branch ?? null, root: cwd === path, facts,
        status: facts ? "current" : discovery.status === "ready" ? "missing" : discovery.status === "non-git" && cwd === path ? "non-git" : "unknown" } satisfies WorktreeView;
    }));
    const branchOf = new Map(worktrees.map((w) => [w.path, w.branch]));
    const sessions: SessionInfo[] = data.sessions
      .filter((t) => !t.archived && branchOf.has(t.cwd))
      .map((t) => {
        const h = hostOf(t.cwd, t.sessionId);
        return {
          sessionId: t.sessionId,
          workspaceId: data.workspaces.find(w => w.path === t.cwd)!.id,
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
    return { path, name: path.split("/").filter(Boolean).pop() ?? path, worktrees, discovery, sessions };
  }), { concurrency: 4 });
});
