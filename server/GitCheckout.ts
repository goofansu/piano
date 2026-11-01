/** The one place Piano decides how it reads Git safely. Every Git read runs without inherited
 * GIT_* state (GIT_DIR/INDEX/OBJECT overrides), global or system config, replace refs,
 * optional locks, fsmonitor or pager, so the environment cannot redirect an answer (INV-06).
 * Source-local repository config is still read by Git; an observation that writes (an index)
 * declares `writes: "index"` and this module disables hooks and filter drivers. A read whose answer the user's Git config defines
 * (a remote URL after `url.<base>.insteadOf`) opts back into global and system config with
 * `userConfig`; inherited GIT_* state stays cleared. Which untracked files Git ignores comes from
 * the user's `core.excludesFile` alone (`withUserExcludes`), never the rest of their config. Output is bounded, UTF-8 checked and NUL lists
 * must be complete; repository paths must be relative and stay out of embedded repositories.
 * `observeGit` is the one answer to "is this path a Git checkout, and of what branch",
 * `Upstream` to "where does that branch's work go", and `BranchHome` to "where does it live".
 */
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Data, Effect, Semaphore } from "effect";
import type { Workspace } from "../shared/wire.ts";
import { gitEnvironment } from "./GitEnvironment.ts";
import {
  GitCommand,
  type RunOptions,
  type RunResult,
  runAsync,
  SubprocessError,
} from "./Subprocess.ts";

function hardenedEnv(extra: Record<string, string> = {}, userConfig = false): NodeJS.ProcessEnv {
  const env = gitEnvironment();
  const config = userConfig ? {} : { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  return {
    ...env,
    ...config,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    LC_ALL: "C",
    ...extra,
  };
}

interface GitOptions
  extends Pick<RunOptions, "input" | "limit" | "truncate" | "okCodes" | "timeout"> {
  readonly cwd: string;
  /** `-c key=value` pairs, already split as Git takes them. */
  readonly config?: readonly string[];
  readonly env?: Record<string, string>;
  /** Also read global and system config, from Git's default locations only (GIT_CONFIG_* is
   * cleared with the rest of GIT_*). Only for a read whose answer that config defines. */
  readonly userConfig?: boolean;
}

/** A rejected exit becomes `Git <subcommand> failed: <stderr>`; other runner failures pass through. */
async function runGit(
  git: string,
  args: readonly string[],
  options: GitOptions,
  signal?: AbortSignal,
): Promise<RunResult> {
  const { cwd, config = [], env, userConfig, ...run } = options;
  try {
    return await runAsync(
      {
        ...run,
        command: git,
        cwd,
        env: hardenedEnv(env, userConfig),
        args: ["--no-pager", "-c", "core.fsmonitor=false", ...config, ...args],
      },
      signal,
    );
  } catch (error) {
    if (error instanceof SubprocessError && error.reason === "exit")
      throw new Error(`Git ${args[0]} failed: ${error.message}`);
    throw error;
  }
}

/** A failed Git read: a rejected exit (`Git <subcommand> failed: <stderr>`), a timeout or output
 * over the size cap. */
export class GitReadError extends Data.TaggedError("GitReadError")<{ readonly detail: string }> {
  override get message() {
    return this.detail;
  }
}

/** One hardened Git read in `cwd`, stdout as text, under one timeout and one size cap; only a
 * best-effort hint shortens `timeout`. Interruption kills the child. */
export const gitText = Effect.fn("GitCheckout.gitText")(function* (
  cwd: string,
  args: readonly string[],
  options: Pick<GitOptions, "timeout" | "userConfig"> = {},
): Effect.fn.Return<string, GitReadError> {
  const git = yield* GitCommand;
  const { timeout = 20_000, userConfig } = options;
  const result = yield* Effect.tryPromise({
    try: (signal) =>
      runGit(git, args, { cwd, timeout, userConfig, limit: 8 * 1024 * 1024 }, signal),
    catch: (error) =>
      new GitReadError({ detail: error instanceof Error ? error.message : String(error) }),
  });
  return result.stdout.toString();
});

/** The checked-out branch, empty when detached (an unborn branch still has its name). */
const BRANCH = ["branch", "--show-current"];

/** Where a branch's work goes and is counted, and where it started: the one answer for discovery,
 * comparison targets and commits not pushed. */
export interface Upstream {
  /** The remote Git would push the branch to: its push remote, else the one it tracks, else
   * `origin`. */
  readonly remote: string;
  /** The branch's name on that remote (what GitHub calls a pull request's head): the one a push
   * refspec names, else its upstream's when Git pushes there, else its own. */
  readonly name: string;
  /** The remote-tracking ref that push would update, else `refs/remotes/<remote>/<branch>`. Git
   * may not hold it. */
  readonly ref: string;
  /** The remote the branch tracks, else `origin`: where it started, so where its base branch
   * lives. A fork's branch started from `upstream/main` pushes to the fork but compares with
   * `upstream`. */
  readonly tracked: string;
}

/** The branch's upstream and where Git would push it. `push.default` and `remote.pushDefault`
 * usually live in the user's config, so the read keeps it (`userConfig`). */
const UPSTREAM_FORMAT =
  "%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)%00%(push:remotename)%00%(push)%00%(push:remoteref)";
const upstreamRead = (branch: string) => [
  "for-each-ref",
  `--format=${UPSTREAM_FORMAT}`,
  `refs/heads/${branch}`,
];

/**
 * `branch`'s upstream from `upstreamRead`'s answer, as Git would push it. Git names the
 * remote-tracking ref a push updates; when it names none (under `push.default=simple`, a branch
 * tracking another name, as after `git switch -c feat origin/main`), the work goes to the
 * branch's own name on its push remote. A local remote (`.`) counts as none. Git names the
 * remote ref (`%(push:remoteref)`) only for a push refspec, which then names the branch.
 */
function upstreamOf(branch: string, answer: string): Upstream {
  const [remote = "", remoteRef = "", upstream = "", pushRemote = "", push = "", pushRef = ""] =
    answer.trim().split("\0");
  const onRemote = (name: string) => (name && name !== "." ? name : null);
  const heads = (ref: string) =>
    ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
  const tracked = onRemote(remote) ?? "origin";
  const target = onRemote(pushRemote) ?? onRemote(remote) ?? "origin";
  const named = heads(pushRef);
  if (!push.startsWith("refs/remotes/"))
    return {
      remote: target,
      name: named ?? branch,
      ref: `refs/remotes/${target}/${named ?? branch}`,
      tracked,
    };
  // Pushing to its upstream (`push.default=upstream`, or the same name) keeps the upstream's name.
  const name = named ?? ((push === upstream && heads(remoteRef)) || branch);
  return { remote: target, name, ref: push, tracked };
}

/** Where a branch lives: where Git would push it (`Upstream`), that remote's push URL, and
 * whether Git holds what the push updates. The one answer for the session rail's branch link,
 * pull request discovery and its API route, and Changes' "pull request from this branch"; each
 * decides what an unpushed branch means to it. Read from the branch's own checkout: a linked
 * worktree's config (`extensions.worktreeConfig`) can push it elsewhere than the main checkout. */
export interface BranchHome {
  /** Where the branch's work goes; null when detached, whose home is `origin`, unnamed. */
  readonly upstream: Upstream | null;
  /** The push URL of `upstream.remote` (else `origin`): its `pushurl`, else its `url`, after the
   * user's `insteadOf` and `pushInsteadOf` rewrites; where the branch is, which its fetch URL need
   * not name. Null without that remote. */
  readonly url: string | null;
  /** Git holds `upstream.ref`: the branch was pushed, or fetched from where it pushes. */
  readonly pushed: boolean;
}

/** A Git read in one checkout that keeps user config: `push.default`, `remote.pushDefault` and
 * URL rewrites usually live there, and define these answers (INV-06). */
type UserRead = (args: readonly string[]) => Promise<string>;

/** `remote`'s push URL, null without that remote. */
const pushUrlOf = async (read: UserRead, remote: string) => {
  try {
    return (await read(["remote", "get-url", "--push", remote])).trim() || null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("No such remote")) return null;
    throw error;
  }
};

/** The homes of `branches` as one checkout's config answers: one read of their upstreams, one of
 * the refs a push would update and one push URL per remote, however many branches. A detached
 * HEAD (null) is homed at `origin`. */
async function homesOf(
  read: UserRead,
  branches: readonly (string | null)[],
): Promise<Map<string | null, BranchHome>> {
  const wanted = new Set(branches.filter((b) => b !== null));
  const upstreams = new Map<string, Upstream>();
  if (wanted.size > 0) {
    const answer = await read([
      "for-each-ref",
      `--format=%(refname)%00${UPSTREAM_FORMAT}`,
      ...[...wanted].map((b) => `refs/heads/${b}`),
    ]);
    // A pattern also matches refs beneath it (`feature` matches `feature/x`): keep exact names.
    for (const line of answer.split("\n")) {
      const [ref = "", ...rest] = line.split("\0");
      const branch = ref.slice("refs/heads/".length);
      if (ref.startsWith("refs/heads/") && wanted.has(branch))
        upstreams.set(branch, upstreamOf(branch, rest.join("\0")));
    }
  }
  const refs = [...new Set([...upstreams.values()].map((u) => u.ref))];
  const remotes = new Set([...upstreams.values()].map((u) => u.remote));
  if (branches.includes(null) || upstreams.size < wanted.size) remotes.add("origin");
  const [held, urls] = await Promise.all([
    refs.length
      ? read(["for-each-ref", "--format=%(refname)", ...refs]).then(
          (out) => new Set(out.split("\n").filter(Boolean)),
        )
      : new Set<string>(),
    Promise.all([...remotes].map(async (r) => [r, await pushUrlOf(read, r)] as const)).then(
      (pairs) => new Map(pairs),
    ),
  ]);
  return new Map(
    branches.map((branch) => {
      // An unborn branch is listed by no ref: it pushes where an untracked branch would.
      const upstream = branch === null ? null : (upstreams.get(branch) ?? upstreamOf(branch, ""));
      return [
        branch,
        {
          upstream,
          url: urls.get(upstream?.remote ?? "origin") ?? null,
          pushed: !!upstream && held.has(upstream.ref),
        },
      ];
    }),
  );
}

/** `homesOf` in the checkout at `cwd`, as an Effect: one timeout for the whole read. */
const homesIn = (cwd: string, branches: readonly (string | null)[], timeout = 20_000) =>
  Effect.gen(function* () {
    const git = yield* GitCommand;
    return yield* Effect.tryPromise({
      try: (signal) =>
        homesOf(
          async (args) =>
            (
              await runGit(
                git,
                args,
                { cwd, timeout, userConfig: true, limit: 8 * 1024 * 1024 },
                signal,
              )
            ).stdout.toString(),
          branches,
        ),
      catch: (error) =>
        new GitReadError({ detail: error instanceof Error ? error.message : String(error) }),
    });
  });

/**
 * The home of each checkout's branch (`BranchHome`), keyed by checkout path. `repository` is any
 * checkout of the repository the others belong to. Its worktrees share refs and, unless the
 * repository enables per-worktree config (`extensions.worktreeConfig`), config too: then one
 * read from `repository` answers for all of them; otherwise each checkout is read from its own
 * path, as Git would answer there.
 */
export const branchHomes = Effect.fn("GitCheckout.branchHomes")(function* (
  repository: string,
  checkouts: readonly { readonly path: string; readonly branch: string }[],
): Effect.fn.Return<ReadonlyMap<string, BranchHome>, GitReadError> {
  if (checkouts.length === 0) return new Map();
  const perWorktree =
    (yield* gitText(repository, [
      "config",
      "--type=bool",
      "--default=false",
      "extensions.worktreeConfig",
    ])).trim() === "true";
  if (!perWorktree) {
    const homes = yield* homesIn(
      repository,
      checkouts.map((c) => c.branch),
    );
    return new Map(checkouts.map((c) => [c.path, homes.get(c.branch)!]));
  }
  return new Map(
    yield* Effect.forEach(
      checkouts,
      (c) =>
        Effect.map(homesIn(c.path, [c.branch]), (homes) => [c.path, homes.get(c.branch)!] as const),
      { concurrency: 4 },
    ),
  );
});

/** What Git says about a path: outside any repository, inside a working checkout, or `broken`:
 * metadata Git cannot read, a bare repository, a missing directory, a failed or timed-out read. */
export type GitObservation =
  | { readonly status: "non-git" }
  | {
      readonly status: "checkout";
      /** The root of the checkout `path` is in. */
      readonly toplevel: string;
      /** With `branch` or `home`: null when detached. Discovery does not pay for it. */
      readonly branch?: string | null;
      /** With `home`: where the checked-out branch lives, read in this checkout. */
      readonly home?: BranchHome;
    }
  | { readonly status: "broken"; readonly detail: string };

/** Whether directory `path` or a parent holds a `.git` entry. Git's own "not a git repository"
 * also covers metadata it cannot read, so only both together mean non-Git. */
async function hasGitMetadata(path: string): Promise<boolean> {
  let dir = await realpath(path);
  if (!(await stat(dir)).isDirectory()) throw new Error(`Not a directory: ${path}`);
  for (;;) {
    try {
      await lstat(join(dir, ".git"));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** One point-in-time Git observation of any path. Never fails: anything short of a positive
 * non-Git or checkout answer is `broken`, never a healthy fallback (INV-06). */
export const observeGit = Effect.fn("GitCheckout.observeGit")(function* (
  path: string,
  options: {
    readonly branch?: boolean;
    /** Implies `branch`. */
    readonly home?: boolean;
    readonly timeout?: number;
  } = {},
): Effect.fn.Return<GitObservation> {
  const read = (args: readonly string[]) => gitText(path, args, { timeout: options.timeout });
  return yield* Effect.gen(function* () {
    const metadata = yield* Effect.tryPromise({
      try: () => hasGitMetadata(path),
      catch: (e) => new GitReadError({ detail: String(e) }),
    });
    const bare = new GitReadError({
      detail: "This directory is not a Git working checkout (bare repositories are unsupported).",
    });
    // One process: outside a work tree (a bare repository, inside `.git`) Git refuses the
    // toplevel half, so that refusal is the bare case.
    const answer = yield* read(["rev-parse", "--is-inside-work-tree", "--show-toplevel"]).pipe(
      Effect.catchIf(
        (e) => !metadata && e.detail.includes("fatal: not a git repository"),
        () => Effect.succeed(null),
      ),
      Effect.catchIf(
        (e) => e.detail.includes("must be run in a work tree"),
        () => Effect.fail(bare),
      ),
    );
    if (answer === null) return { status: "non-git" } as const;
    const [inside, toplevel] = answer.trim().split("\n");
    if (inside !== "true" || !toplevel) return yield* bare;
    const checkout = { status: "checkout", toplevel: toplevel.trim() } as const;
    if (!options.branch && !options.home) return checkout;
    const branch = (yield* read(BRANCH)).trim() || null;
    if (!options.home) return { ...checkout, branch };
    const home = (yield* homesIn(path, [branch], options.timeout)).get(branch)!;
    return { ...checkout, branch, home };
  }).pipe(
    Effect.catchTag("GitReadError", (e) =>
      Effect.succeed({ status: "broken", detail: e.detail } as const),
    ),
  );
});

/** A failure this module detects. Callers keep their own phrasing through `messages`. */
class CheckoutError extends Error {
  readonly reason: "root" | "limit" | "encoding" | "incomplete" | "path";
  constructor(reason: CheckoutError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface CheckoutMessages {
  readonly root: string;
  readonly limit: string;
  readonly encoding: string;
  readonly incomplete: string;
  readonly path: (path: string) => string;
}
const MESSAGES: CheckoutMessages = {
  root: "This requires the Git checkout root, not a subdirectory.",
  limit: "Git output exceeds the supported size limit.",
  encoding: "Git output contains unsupported non-UTF-8 bytes.",
  incomplete: "Incomplete Git metadata; no file list is available.",
  path: (path) =>
    `Unsupported repository path (including embedded repositories): ${JSON.stringify(path)}`,
};

interface CheckoutOptions extends Pick<ObserveOptions, "limit" | "writes" | "messages"> {
  /** The Git executable (`GitCommand`). */
  readonly git: string;
  readonly signal: AbortSignal;
}
export type ReadOptions = Pick<RunOptions, "input" | "limit" | "okCodes">;

/** A verified checkout root; every read is hardened and bounded. */
export interface Checkout {
  /** The physical checkout root. */
  readonly cwd: string;
  readonly run: (args: readonly string[], options?: ReadOptions) => Promise<RunResult>;
  /** Whole stdout as UTF-8 text. */
  readonly text: (args: readonly string[], options?: ReadOptions) => Promise<string>;
  /** Up to `limit` bytes, cut back to the last complete line so no text is invented. */
  readonly excerpt: (
    args: readonly string[],
    limit: number,
  ) => Promise<{ text: string; truncated: boolean }>;
  /** A complete `-z` list: UTF-8 and NUL-terminated, or it fails. */
  readonly records: (args: readonly string[], options?: ReadOptions) => Promise<string[]>;
  /** A relative path without empty, dot or `.git` segments, or it fails. */
  readonly safePath: (path: string) => string;
  /** The HEAD commit, or null when unborn. */
  readonly head: () => Promise<string | null>;
  /** The checked-out branch, or null when detached. */
  readonly branch: () => Promise<string | null>;
  /** Where `branch`'s work goes and is counted. */
  readonly upstream: (branch: string) => Promise<Upstream>;
  /** The fetch URL Git would contact, including user-config rewrites; null without that remote. */
  readonly remoteUrl: (name: string) => Promise<string | null>;
  /** Where `branch` lives (`BranchHome`), as this checkout's config answers. */
  readonly home: (branch: string | null) => Promise<BranchHome>;
  /** The same checkout answering ignore questions as the user's Git does: with the
   * `core.excludesFile` their config sets (repository-local over global and system, `~`
   * expanded) passed as `-c`. That one key comes back; the rest of user config stays out. */
  readonly withUserExcludes: () => Promise<Checkout>;
  /** The same checkout with added `-c` config or environment (a disposable GIT_INDEX_FILE). */
  readonly with: (extra: {
    readonly config?: readonly string[];
    readonly env?: Record<string, string>;
  }) => Checkout;
}

/** Fails with CheckoutError("root") unless `path` is the root of a Git checkout. */
async function openCheckout(path: string, options: CheckoutOptions): Promise<Checkout> {
  const cwd = await realpath(path);
  const messages = { ...MESSAGES, ...options.messages };
  const fail = (reason: CheckoutError["reason"], message: string): never => {
    throw new CheckoutError(reason, message);
  };
  const decode = (bytes: Buffer) => {
    const value = bytes.toString("utf8");
    if (!Buffer.from(value).equals(bytes)) fail("encoding", messages.encoding);
    return value;
  };
  const make = (config: readonly string[], env: Record<string, string>): Checkout => {
    const run = async (
      args: readonly string[],
      read: ReadOptions & { truncate?: boolean; userConfig?: boolean } = {},
    ) => {
      const { limit = options.limit, ...rest } = read;
      try {
        return await runGit(
          options.git,
          args,
          { ...rest, cwd, limit, config, env },
          options.signal,
        );
      } catch (error) {
        if (error instanceof SubprocessError && error.reason === "limit")
          fail("limit", messages.limit);
        throw error;
      }
    };
    const url = async (args: readonly string[]) => {
      try {
        return decode((await run(args, { userConfig: true })).stdout).trim() || null;
      } catch (error) {
        if (error instanceof Error && error.message.includes("No such remote")) return null;
        throw error;
      }
    };
    const optional = async (args: readonly string[]) => {
      const result = await run(args, { okCodes: [0, 1] });
      return result.code === 0 ? decode(result.stdout).trim() : null;
    };
    return {
      cwd,
      run,
      text: async (args, read) => decode((await run(args, read)).stdout),
      excerpt: async (args, limit) => {
        const { stdout, truncated } = await run(args, { limit, truncate: true });
        return {
          text: decode(truncated ? stdout.subarray(0, stdout.lastIndexOf(10) + 1) : stdout),
          truncated,
        };
      },
      records: async (args, read) => {
        const value = decode((await run(args, read)).stdout);
        if (value && !value.endsWith("\0")) fail("incomplete", messages.incomplete);
        return value.split("\0").filter(Boolean);
      },
      safePath: (path) =>
        !path ||
        isAbsolute(path) ||
        path.split("/").some((p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git")
          ? fail("path", messages.path(path))
          : path,
      head: () => optional(["rev-parse", "--verify", "--quiet", "HEAD"]),
      branch: async () => decode((await run(BRANCH)).stdout).trim() || null,
      upstream: async (branch) =>
        upstreamOf(branch, decode((await run(upstreamRead(branch), { userConfig: true })).stdout)),
      remoteUrl: (name) => url(["remote", "get-url", name]),
      home: async (branch) =>
        (
          await homesOf(
            async (args) => decode((await run(args, { userConfig: true })).stdout),
            [branch],
          )
        ).get(branch)!,
      withUserExcludes: async () => {
        const result = await run(["config", "--path", "--get", "core.excludesFile"], {
          userConfig: true,
          okCodes: [0, 1],
        });
        const file = result.code === 0 ? decode(result.stdout).replace(/\n$/, "") : "";
        return file ? make([...config, "-c", `core.excludesFile=${file}`], env) : make(config, env);
      },
      with: (extra) => make([...config, ...(extra.config ?? [])], { ...env, ...extra.env }),
    };
  };
  const checkout = make(options.writes ? ["-c", "core.hooksPath=/dev/null"] : [], {});
  const top = (await checkout.text(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  if ((await realpath(top)) !== cwd) fail("root", messages.root);
  if (!options.writes) return checkout;
  // Disable every locally configured filter driver before diff/add touches working files.
  const filters = await checkout.records(
    ["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"],
    { okCodes: [0, 1] },
  );
  return checkout.with({
    config: filters.flatMap((key) => ["-c", `${key}=${key.endsWith(".required") ? "false" : ""}`]),
  });
}

export interface ObserveOptions {
  /** The permits this observation takes one of: the caller's concurrency policy. */
  readonly slots: Semaphore.Semaphore;
  /** Default stdout bound for each read. */
  readonly limit: number;
  /** `"index"`: the read writes a disposable index, so hooks and every locally configured
   * filter driver are disabled before it runs (INV-06). */
  readonly writes?: "index";
  /** The caller's phrasing for failures this module detects. */
  readonly messages?: Partial<CheckoutMessages>;
  /** Cancels the read after this many milliseconds (default 30 s). */
  readonly timeout?: number;
}

export interface CheckoutObservation<R> {
  readonly workspace: Workspace;
  readonly observedAt: string;
  readonly result: R | { readonly status: "error"; readonly detail: string };
}

/** A point-in-time observation of the checkout at `workspace.path` (INV-07): one of `slots`
 * permits, the path opened as a checkout root with `GitCommand` under this module's hardening,
 * `read` cancelled after `timeout`, any failure kept as `{ status: "error", detail }` rather than
 * thrown.
 */
export const observeCheckout = Effect.fn("GitCheckout.observeCheckout")(function* <R>(
  workspace: Workspace,
  options: ObserveOptions,
  read: (checkout: Checkout, signal: AbortSignal) => Promise<R>,
): Effect.fn.Return<CheckoutObservation<R>> {
  const git = yield* GitCommand;
  const { slots, limit, writes, messages, timeout = 30_000 } = options;
  return yield* Semaphore.withPermits(
    slots,
    1,
  )(
    Effect.promise(async (interrupt): Promise<CheckoutObservation<R>> => {
      const signal = AbortSignal.any([interrupt, AbortSignal.timeout(timeout)]);
      let result: CheckoutObservation<R>["result"];
      try {
        const checkout = await openCheckout(workspace.path, {
          git,
          signal,
          limit,
          writes,
          messages,
        });
        result = await read(checkout, signal);
      } catch (error) {
        result = {
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      return { workspace, observedAt: new Date().toISOString(), result };
    }),
  );
});
