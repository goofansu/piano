/** Discovery reads Git; creation goes through Worktrunk 0.80.0 for its paths and hooks. Git and CLI details stay behind this module. */
import { execFile } from "node:child_process";
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Context, Data, Effect, Schema } from "effect";
import type { WorktreeDiscovery, WorktreeFacts } from "../shared/wire.ts";

export class WorktreeError extends Data.TaggedError("WorktreeError")<{ readonly detail: string }> {}
export const WorktrunkCommand = Context.Reference<string>("piano/WorktrunkCommand", {
  defaultValue: () => process.env.PIANO_WT_CLI ?? "wt",
});
export const WORKTRUNK_VERSION = "0.80.0";

const run = (cmd: string, args: string[], timeout = 20_000): Effect.Effect<string, WorktreeError> =>
  Effect.tryPromise({
    try: (signal) => new Promise<string>((resolve, reject) => {
      const child = execFile(cmd, args, { signal, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd}: ${String(stderr || err.message).trim()}`));
        else resolve(stdout);
      });
      // A headless process must fail approval rather than wait for stdin indefinitely.
      child.stdin?.end();
    }),
    catch: (e) => new WorktreeError({ detail: e instanceof Error ? e.message : String(e) }),
  });
const wt = (project: string, args: string[], timeout?: number) => Effect.gen(function* () {
  const command = yield* WorktrunkCommand;
  return yield* run(command, ["-C", project, ...args], timeout);
});
const compatible = Effect.gen(function* () {
  const command = yield* WorktrunkCommand;
  const version = (yield* run(command, ["--version"])).trim();
  if (version !== `wt v${WORKTRUNK_VERSION}`) return yield* new WorktreeError({
    detail: `Unsupported Worktrunk version: ${version}. Install Worktrunk ${WORKTRUNK_VERSION}, then refresh.`,
  });
});

/** Lightweight optional hints for the directory browser, not repository health. */
export const gitHeadSubject = (path: string): Effect.Effect<string> =>
  run("git", ["-C", path, "log", "-1", "--format=%s"], 2000).pipe(
    Effect.map((out) => out.trim().slice(0, 120)), Effect.orElseSucceed(() => ""),
  );
export const gitTopLevel = (path: string): Effect.Effect<string> =>
  run("git", ["-C", path, "rev-parse", "--show-toplevel"], 2000).pipe(
    Effect.map((out) => out.trim()), Effect.orElseSucceed(() => ""),
  );

const Created = Schema.Struct({
  action: Schema.Literal("created"), branch: Schema.String, path: Schema.String,
  created_branch: Schema.Literal(true), base_branch: Schema.String,
});
const json = <T, E>(schema: Schema.Codec<T, E>, text: string) => Effect.try({
  try: () => Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text),
  catch: () => new WorktreeError({ detail: "Invalid Worktrunk output (expected the supported structured contract). Refresh after checking Worktrunk 0.80.0 and its configuration." }),
});

/** Positively distinguish non-Git directories from broken/inaccessible repository metadata. */
const isGit = (path: string) => Effect.gen(function* () {
  const metadata = yield* Effect.tryPromise({
    try: async () => {
      let dir = await realpath(path);
      if (!(await stat(dir)).isDirectory()) throw new Error(`Not a directory: ${path}`);
      for (;;) {
        try { await lstat(join(dir, ".git")); return true; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        const parent = dirname(dir);
        if (parent === dir) return false;
        dir = parent;
      }
    },
    catch: (e) => new WorktreeError({ detail: String(e) }),
  });
  return yield* run("git", ["-C", path, "rev-parse", "--is-inside-work-tree"]).pipe(
    Effect.flatMap((out) => out.trim() === "true" ? Effect.succeed(true) : Effect.fail(new WorktreeError({ detail: "This directory is not a Git working checkout (bare repositories are unsupported)." }))),
    Effect.catchTag("WorktreeError", (e) => !metadata && e.detail.includes("fatal: not a git repository (or any of the parent directories): .git")
      ? Effect.succeed(false) : Effect.fail(e)),
  );
});

/** One `git worktree list --porcelain -z` record. Unknown attributes are ignored. */
function parseWorktrees(out: string): WorktreeFacts[] | undefined {
  const worktrees: WorktreeFacts[] = [];
  let current: { path?: string; branch: string | null; detached: boolean; bare: boolean; prunable: boolean } | undefined;
  const finish = () => {
    if (!current) return true;
    const w = current; current = undefined;
    if (w.bare) return true;
    if (!w.path || !isAbsolute(w.path) || worktrees.some(other => other.path === w.path) || (w.branch === null) !== w.detached) return false;
    worktrees.push({ path: w.path, branch: w.branch, detached: w.detached, prunable: w.prunable });
    return true;
  };
  for (const field of out.split("\0")) {
    if (field === "") { if (!finish()) return undefined; continue; }
    const [key, ...rest] = field.split(" "), value = rest.join(" ");
    if (key === "worktree") { if (!finish()) return undefined; current = { path: value, branch: null, detached: false, bare: false, prunable: false }; continue; }
    if (!current) return undefined;
    if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") current.detached = true;
    else if (key === "bare") current.bare = true;
    else if (key === "prunable") current.prunable = true;
  }
  return finish() ? worktrees : undefined;
}

/** No healthy fallback and no registry writes. Each call is a fresh point-in-time observation. */
export const listWorktrees = (project: string): Effect.Effect<WorktreeDiscovery> => Effect.gen(function* () {
  const observedAt = new Date().toISOString();
  return yield* Effect.gen(function* () {
    if (!(yield* isGit(project))) return { status: "non-git" as const, observedAt };
    const [top, out] = yield* Effect.all([
      run("git", ["-C", project, "rev-parse", "--show-toplevel"]),
      run("git", ["-C", project, "worktree", "list", "--porcelain", "-z"]),
    ], { concurrency: 2 });
    const worktrees = parseWorktrees(out);
    if (!worktrees) return yield* new WorktreeError({ detail: "Invalid git worktree list output. Refresh after checking the repository with git worktree list." });
    const currentPath = top.trim();
    if (!worktrees.some(w => w.path === currentPath)) return yield* new WorktreeError({ detail: "Git listed no worktree for this checkout. Refresh after checking git worktree list." });
    return { status: "ready" as const, observedAt, currentPath, worktrees };
  }).pipe(Effect.catchTag("WorktreeError", (e) => Effect.succeed({ status: "error" as const, observedAt,
    detail: `${e.detail}\nCheck the checkout and Git, then refresh. No current Git status is available.` })));
});

/** New branches only. No prose-based retry of a possibly partially completed operation. */
export const createWorktree = (project: string, branch: string, options: { hooks?: boolean } = {}) => Effect.gen(function* () {
  yield* compatible;
  if (!(yield* isGit(project))) return yield* new WorktreeError({ detail: "This project is non-Git. Create a Git repository before creating a worktree." });
  // Reject shortcuts/options before passing a branch name to Worktrunk.
  if (!branch || branch.startsWith("-") || branch !== branch.trim()) return yield* new WorktreeError({ detail: "Enter a valid new branch name." });
  if ((yield* run("git", ["check-ref-format", "--branch", branch])).trim() !== branch || branch === "@") {
    return yield* new WorktreeError({ detail: "Enter a literal new branch name, not a checkout shortcut." });
  }
  const result = yield* json(Created, yield* wt(project, ["switch", "--create", branch, "--format=json", "--no-cd", ...(options.hooks ? [] : ["--no-hooks"])], 60_000));
  if (!isAbsolute(result.path) || result.branch !== branch || !result.base_branch) return yield* new WorktreeError({ detail: "Worktrunk returned an unexpected creation identity. Inspect discovery before retrying." });
  return { path: result.path, branch: result.branch, baseBranch: result.base_branch, hooks: options.hooks ? "enabled" as const : "skipped" as const };
}).pipe(Effect.mapError((e) => new WorktreeError({ detail: `${e.detail}\nCreation was not confirmed; a checkout may remain after a hook or transport failure. Refresh discovery before retrying. For unapproved hooks, review and approve them with wt config approvals in a terminal, or explicitly leave hooks off.` })));
