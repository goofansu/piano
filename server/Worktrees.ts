/** Discovery reads Git through GitCheckout's observation and hardened reads, so inherited GIT_*
 * state cannot redirect it (INV-06); creation goes through Worktrunk (0.80.0 or later) for its paths and hooks. Git and
 * CLI details stay behind this module.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Context, Data, Effect, Schema } from "effect";
import type { WorktreeDiscovery, WorktreeFacts } from "../shared/wire.ts";
import { gitText, observeGit } from "./GitCheckout.ts";
import { gitEnvironment } from "./GitEnvironment.ts";
import { run as runProcess } from "./Subprocess.ts";

export class WorktreeError extends Data.TaggedError("WorktreeError")<{
  readonly detail: string;
  /** Worktrunk ran, so a checkout may exist even though creation failed. */
  readonly unconfirmed?: boolean;
}> {}
export const WorktrunkCommand = Context.Reference<string>("piano/WorktrunkCommand", {
  defaultValue: () => process.env.PIANO_WT_CLI ?? "wt",
});
/** Oldest supported Worktrunk; newer releases are supported and CI tests the latest. */
export const MINIMUM_WORKTRUNK_VERSION = "0.80.0";

const run = (
  command: string,
  args: string[],
  timeout = 20_000,
): Effect.Effect<string, WorktreeError> =>
  runProcess({
    command,
    args,
    timeout,
    limit: 8 * 1024 * 1024,
    env: { ...gitEnvironment(), LC_ALL: "C" },
  }).pipe(
    Effect.map((result) => result.stdout.toString()),
    Effect.mapError((e) => new WorktreeError({ detail: `${command}: ${e.message}` })),
  );
const git = (cwd: string, args: string[]): Effect.Effect<string, WorktreeError> =>
  gitText(cwd, args).pipe(Effect.mapError((e) => new WorktreeError({ detail: e.detail })));
/** A Git working checkout, or false for a non-Git directory; broken metadata fails. */
const checkoutOf = (path: string) =>
  observeGit(path).pipe(
    Effect.flatMap((observed) =>
      observed.status === "broken"
        ? Effect.fail(new WorktreeError({ detail: observed.detail }))
        : Effect.succeed(observed.status === "checkout" && observed),
    ),
  );
const wt = Effect.fn("Worktrees.wt")(function* (folder: string, args: string[], timeout?: number) {
  const command = yield* WorktrunkCommand;
  return yield* run(command, ["-C", folder, ...args], timeout);
});
const compatible = Effect.gen(function* () {
  const command = yield* WorktrunkCommand;
  const version = (yield* run(command, ["--version"])).trim();
  const found = /^wt v(\d+)\.(\d+)\.(\d+)\b/.exec(version)?.slice(1).map(Number);
  const minimum = MINIMUM_WORKTRUNK_VERSION.split(".").map(Number);
  const order = found && (found.map((n, i) => n - minimum[i]!).find((d) => d !== 0) ?? 0);
  if (order === undefined || order < 0)
    return yield* new WorktreeError({
      detail: `Unsupported Worktrunk version: ${version}. Install Worktrunk ${MINIMUM_WORKTRUNK_VERSION} or later, then refresh.`,
    });
});

/** Lightweight optional hints for the directory browser, not repository health: the root of the
 * checkout `path` is in, and its HEAD subject; `subjectOnly` skips the root lookup (one Git read)
 * for a path already known to hold `.git`. Never fails; a hint Git cannot give is absent. */
export const checkoutHint = Effect.fn("Worktrees.checkoutHint")(function* (
  path: string,
  options: { readonly subjectOnly?: boolean } = {},
): Effect.fn.Return<{ readonly root?: string; readonly subject?: string }> {
  let root: string | undefined;
  if (!options.subjectOnly) {
    const observed = yield* observeGit(path, { timeout: 2000 });
    if (observed.status !== "checkout") return {};
    root = observed.toplevel;
  }
  const subject = yield* gitText(path, ["log", "-1", "--format=%s"], { timeout: 2000 }).pipe(
    Effect.map((out) => out.trim().slice(0, 120)),
    Effect.orElseSucceed(() => ""),
  );
  return { root, subject: subject || undefined };
});

const Created = Schema.Struct({
  action: Schema.Literal("created"),
  branch: Schema.String,
  path: Schema.String,
  created_branch: Schema.Literal(true),
  base_branch: Schema.String,
});
const json = <T, E>(schema: Schema.Codec<T, E>, text: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text),
    catch: () =>
      new WorktreeError({
        detail:
          "Invalid Worktrunk output (expected the supported structured contract). Refresh after checking Worktrunk and its configuration.",
      }),
  });

/** One `git worktree list --porcelain -z` record. Unknown attributes are ignored. */
function parseWorktrees(out: string): WorktreeFacts[] | undefined {
  const worktrees: WorktreeFacts[] = [];
  let current:
    | { path?: string; branch: string | null; detached: boolean; bare: boolean; prunable: boolean }
    | undefined;
  const finish = () => {
    if (!current) return true;
    const w = current;
    current = undefined;
    if (w.bare) return true;
    if (
      !w.path ||
      !isAbsolute(w.path) ||
      worktrees.some((other) => other.path === w.path) ||
      (w.branch === null) !== w.detached
    )
      return false;
    worktrees.push({ path: w.path, branch: w.branch, detached: w.detached, prunable: w.prunable });
    return true;
  };
  for (const field of out.split("\0")) {
    if (field === "") {
      if (!finish()) return undefined;
      continue;
    }
    const [key, ...rest] = field.split(" "),
      value = rest.join(" ");
    if (key === "worktree") {
      if (!finish()) return undefined;
      current = { path: value, branch: null, detached: false, bare: false, prunable: false };
      continue;
    }
    if (!current) return undefined;
    if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") current.detached = true;
    else if (key === "bare") current.bare = true;
    else if (key === "prunable") current.prunable = true;
  }
  return finish() ? worktrees : undefined;
}

/** No healthy fallback and no registry writes. Each call is a fresh point-in-time observation. */
export const listWorktrees = Effect.fn("Worktrees.listWorktrees")(function* (
  folder: string,
): Effect.fn.Return<WorktreeDiscovery> {
  const observedAt = new Date().toISOString();
  return yield* Effect.gen(function* () {
    const checkout = yield* checkoutOf(folder);
    if (!checkout) return { status: "non-git" as const, observedAt };
    const worktrees = parseWorktrees(yield* git(folder, ["worktree", "list", "--porcelain", "-z"]));
    if (!worktrees)
      return yield* new WorktreeError({
        detail:
          "Invalid git worktree list output. Refresh after checking the repository with git worktree list.",
      });
    const currentPath = checkout.toplevel;
    if (!worktrees.some((w) => w.path === currentPath))
      return yield* new WorktreeError({
        detail:
          "Git listed no worktree for this checkout. Refresh after checking git worktree list.",
      });
    return { status: "ready" as const, observedAt, currentPath, worktrees };
  }).pipe(
    Effect.catchTag("WorktreeError", (e) =>
      Effect.succeed({
        status: "error" as const,
        observedAt,
        detail: `${e.detail}\nCheck the checkout and Git, then refresh. No current Git status is available.`,
      }),
    ),
  );
});

/** The main checkout a linked worktree belongs to, so a session started in the worktree can be
 * listed under that folder. Git's spelling of both paths is returned. `null` for anything that is
 * not the root of a linked worktree: a main checkout, a subdirectory, a non-Git directory, or a
 * worktree of a bare repository, which has no main checkout. Metadata Git cannot read fails. */
export const worktreeOwner = Effect.fn("Worktrees.worktreeOwner")(function* (
  path: string,
): Effect.fn.Return<
  { readonly root: string; readonly main: string; readonly branch: string | null } | null,
  WorktreeError
> {
  const checkout = yield* checkoutOf(path);
  if (!checkout) return null;
  const root = checkout.toplevel;
  const physical = yield* Effect.tryPromise({
    try: () => realpath(path),
    catch: (e) => new WorktreeError({ detail: String(e) }),
  });
  if (physical !== root) return null;
  const out = yield* git(root, ["worktree", "list", "--porcelain", "-z"]);
  // Git lists the main worktree first; parseWorktrees drops a bare one, so read it from the raw record.
  const first = out.split("\0\0")[0]?.split("\0") ?? [];
  const main = first[0]?.startsWith("worktree ") ? first[0].slice("worktree ".length) : undefined;
  const worktrees = parseWorktrees(out);
  const current = worktrees?.find((w) => w.path === root);
  if (!main || !worktrees || !current)
    return yield* new WorktreeError({
      detail: "Invalid git worktree list output. Check the repository with git worktree list.",
    });
  if (main === root || first.includes("bare")) return null;
  return { root, main, branch: current.branch };
});

/** New branches only. No prose-based retry of a possibly partially completed operation. */
export const createWorktree = Effect.fn("Worktrees.createWorktree")(function* (
  folder: string,
  branch: string,
  options: { hooks?: boolean } = {},
) {
  yield* compatible;
  if (!(yield* checkoutOf(folder)))
    return yield* new WorktreeError({
      detail: "This folder is non-Git. Create a Git repository before creating a worktree.",
    });
  // Reject shortcuts/options before passing a branch name to Worktrunk.
  if (!branch || branch.startsWith("-") || branch !== branch.trim())
    return yield* new WorktreeError({ detail: "Enter a valid new branch name." });
  if (
    (yield* git(folder, ["check-ref-format", "--branch", branch])).trim() !== branch ||
    branch === "@"
  ) {
    return yield* new WorktreeError({
      detail: "Enter a literal new branch name, not a checkout shortcut.",
    });
  }
  // Only a failure from here on may leave a checkout behind; the checks above create nothing.
  return yield* Effect.gen(function* () {
    const result = yield* json(
      Created,
      yield* wt(
        folder,
        [
          "switch",
          "--create",
          branch,
          "--format=json",
          "--no-cd",
          ...(options.hooks ? [] : ["--no-hooks"]),
        ],
        60_000,
      ),
    );
    if (!isAbsolute(result.path) || result.branch !== branch || !result.base_branch)
      return yield* new WorktreeError({
        detail:
          "Worktrunk returned an unexpected creation identity. Inspect discovery before retrying.",
      });
    return {
      path: result.path,
      branch: result.branch,
      baseBranch: result.base_branch,
      hooks: options.hooks ? ("enabled" as const) : ("skipped" as const),
    };
  }).pipe(
    Effect.mapError(
      (e) =>
        new WorktreeError({
          unconfirmed: true,
          detail: `${e.detail}\nCreation was not confirmed; a checkout may remain after a hook or transport failure. Refresh discovery before retrying. For unapproved hooks, review and approve them with wt config approvals in a terminal, or explicitly leave hooks off.`,
        }),
    ),
  );
});
