/** Sidebar view: projects → worktrees → threads, with running-host markers. */
import { Effect } from "effect";
import type { ProjectView, ThreadInfo } from "../shared/wire.ts";
import { listProjects } from "./Projects.ts";
import { listSessions } from "./Sessions.ts";
import { ThreadHosts } from "./ThreadHosts.ts";
import { listWorktrees } from "./Worktrees.ts";

export const buildProjects: Effect.Effect<ProjectView[], never, ThreadHosts> = Effect.gen(function* () {
  const hosts = yield* ThreadHosts;
  const running = yield* hosts.list;
  const hostOf = (cwd: string, sessionId: string) => running.find((h) => h.cwd === cwd && h.sessionId === sessionId);
  const projects = yield* listProjects;
  return yield* Effect.forEach(
    projects,
    (path) =>
      Effect.gen(function* () {
        const worktrees = yield* listWorktrees(path);
        const views = yield* Effect.forEach(
          worktrees,
          (wt) =>
            Effect.gen(function* () {
              const sessions = yield* listSessions(wt.path);
              const threads: ThreadInfo[] = sessions.map((s) => {
                const h = hostOf(wt.path, s.sessionId);
                return { ...s, hosted: !!h, streaming: !!h?.streaming };
              });
              // Running threads that have not written a session file yet.
              for (const h of running) {
                if (h.cwd !== wt.path || threads.some((t) => t.sessionId === h.sessionId)) continue;
                const now = new Date().toISOString();
                threads.unshift({
                  sessionId: h.sessionId,
                  path: "",
                  firstMessage: "",
                  created: now,
                  modified: now,
                  messageCount: 0,
                  hosted: true,
                  streaming: h.streaming,
                });
              }
              return { ...wt, threads };
            }),
          { concurrency: 4 },
        );
        return { path, name: path.split("/").filter(Boolean).pop() ?? path, worktrees: views };
      }),
    { concurrency: 4 },
  );
});
