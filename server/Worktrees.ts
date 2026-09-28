/**
 * Worktrunk (`wt`) integration: list a project's worktrees and create new ones.
 */
import { execFile } from "node:child_process";
import { Data, Effect } from "effect";

export class WorktreeError extends Data.TaggedError("WorktreeError")<{ readonly detail: string }> {}

export interface Worktree {
  branch: string;
  path: string;
  main: boolean;
}

const wt = (args: string[]): Effect.Effect<string, WorktreeError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        execFile("wt", args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) reject(new Error(String(stderr || err.message).trim()));
          else resolve(stdout);
        });
      }),
    catch: (e) => new WorktreeError({ detail: e instanceof Error ? e.message : String(e) }),
  });

interface WtListItem {
  branch?: string;
  worktree?: { path: string; main?: boolean };
}

export const listWorktrees = (project: string): Effect.Effect<Worktree[]> =>
  wt(["-C", project, "list", "--format", "json"]).pipe(
    Effect.map((stdout) => {
      const parsed = JSON.parse(stdout) as { items?: WtListItem[] };
      const items = (parsed.items ?? [])
        .filter((i): i is WtListItem & { worktree: { path: string; main?: boolean } } => !!i.worktree)
        .map((i) => ({ branch: i.branch ?? "", path: i.worktree.path, main: !!i.worktree.main }));
      if (!items.some((w) => w.path === project)) items.unshift({ branch: "", path: project, main: true });
      return items.sort((a, b) => Number(b.main) - Number(a.main) || a.branch.localeCompare(b.branch));
    }),
    // Not a git repo, or wt unavailable: the project root is the only "worktree".
    Effect.orElseSucceed(() => [{ branch: "", path: project, main: true }]),
  );

function firstJsonLine(stdout: string): Record<string, unknown> | undefined {
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

export const createWorktree = (
  project: string,
  branch: string,
  options: { hooks?: boolean } = {},
): Effect.Effect<Worktree, WorktreeError> =>
  Effect.gen(function* () {
    const tail = ["--format", "json", "--no-cd", "-y", ...(options.hooks ? [] : ["--no-hooks"])];
    const attempt = (create: boolean) =>
      wt(["-C", project, "switch", ...(create ? ["--create"] : []), branch, ...tail]);
    const stdout = yield* attempt(true).pipe(
      // Branch exists without a worktree: switch (creating the worktree) instead.
      Effect.catchTag("WorktreeError", (e) => (/already exists/i.test(e.detail) ? attempt(false) : Effect.fail(e))),
    );
    const result = firstJsonLine(stdout);
    const path = result?.path;
    if (typeof path !== "string") return yield* new WorktreeError({ detail: `wt returned no worktree path:\n${stdout}` });
    return { branch: String(result?.branch ?? branch), path, main: false };
  });
