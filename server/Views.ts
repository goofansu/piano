/** Registry selects directories/sessions; Git/Worktrunk supply current facts, never cached registry branches. */
import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { FolderView, SessionInfo, SessionReference, WorktreeView } from "../shared/wire.ts";
import { projectTrust } from "./ProjectTrust.ts";
import { Registry } from "./Registry.ts";
import { listSessions } from "./SessionFiles.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { listWorktrees } from "./Worktrees.ts";

/** Group references survive closed directories and missing history; discovery never removes them. */
export const buildSessionReferences = Effect.gen(function* () {
  const data = yield* (yield* Registry).get;
  const running = yield* (yield* SessionHosts).list;
  const paths = [...new Set(data.sessions.filter(s => s.outcomeProjectId).map(s => s.cwd))];
  const histories = new Map(yield* Effect.forEach(paths, cwd => listSessions(cwd).pipe(Effect.map(sessions => [cwd, sessions] as const)), { concurrency: 4 }));
  return data.sessions.map((s): SessionReference => ({ ...s,
    unavailable: !s.outcomeProjectId || running.some(h => h.cwd === s.cwd && h.sessionId === s.sessionId) ? undefined
      : !histories.get(s.cwd)?.some(h => h.sessionId === s.sessionId) ? "history"
      : !existsSync(s.cwd) ? "checkout" : undefined,
  }));
});

export const buildFolders: Effect.Effect<FolderView[], never, SessionHosts | Registry> = Effect.gen(function* () {
  const hosts = yield* SessionHosts;
  const registry = yield* Registry;
  const running = yield* hosts.list;
  const data = yield* registry.get;
  const hostOf = (cwd: string, sessionId: string) => running.find((h) => h.cwd === cwd && h.sessionId === sessionId);

  return yield* Effect.forEach(data.folders, (path) => Effect.gen(function* () {
    const discovery = yield* listWorktrees(path);
    const paths = new Set([path, ...data.worktrees.filter(w => w.folder === path).map(w => w.path)]);
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
