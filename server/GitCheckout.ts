/** The one place Piano decides how it reads Git safely. Every Git read runs without inherited
 * GIT_* state (GIT_DIR/INDEX/OBJECT overrides), global or system config, replace refs,
 * optional locks, fsmonitor or pager, so the environment cannot redirect an answer (INV-06).
 * Source-local repository config is still read by Git; an observation that writes (an index)
 * declares `writes: "index"` and this module disables hooks and filter drivers. A read whose answer the user's Git config defines
 * (a remote URL after `url.<base>.insteadOf`) opts back into global and system config with
 * `userConfig`; inherited GIT_* state stays cleared. Output is bounded, UTF-8 checked and NUL lists
 * must be complete; repository paths must be relative and stay out of embedded repositories.
 * `observeGit` is the one answer to "is this path a Git checkout, and of what branch".
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

/** What Git says about a path: outside any repository, inside a working checkout, or `broken`:
 * metadata Git cannot read, a bare repository, a missing directory, a failed or timed-out read. */
export type GitObservation =
  | { readonly status: "non-git" }
  | {
      readonly status: "checkout";
      /** The root of the checkout `path` is in. */
      readonly toplevel: string;
      /** With `branch` or `remote`: null when detached. Discovery does not pay for it. */
      readonly branch?: string | null;
      /** With `remote`: the URL Git would contact for the branch's tracking remote (else
       * `origin`), after the user's `url.<base>.insteadOf` rewrites; null without that remote. */
      readonly remote?: string | null;
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
    readonly remote?: boolean;
    readonly timeout?: number;
  } = {},
): Effect.fn.Return<GitObservation> {
  const read = (args: readonly string[], userConfig?: boolean) =>
    gitText(path, args, { timeout: options.timeout, userConfig });
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
    if (!options.branch && !options.remote) return checkout;
    const branch = (yield* read(BRANCH)).trim() || null;
    if (!options.remote) return { ...checkout, branch };
    const tracking = branch
      ? (yield* read([
          "for-each-ref",
          "--format=%(upstream:remotename)",
          `refs/heads/${branch}`,
        ])).trim()
      : "";
    // The one read whose answer the user's Git config defines (e.g. an exe.dev integration
    // proxy configured globally), so it keeps user config.
    const remote = yield* read(
      ["remote", "get-url", tracking && tracking !== "." ? tracking : "origin"],
      true,
    ).pipe(
      Effect.map((out) => out.trim() || null),
      Effect.catchIf(
        (e) => e.detail.includes("No such remote"),
        () => Effect.succeed(null),
      ),
    );
    return { ...checkout, branch, remote };
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
  /** The URL Git would contact, including user-config rewrites; null without that remote. */
  readonly remoteUrl: (name: string) => Promise<string | null>;
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
      remoteUrl: async (name) => {
        try {
          return (
            decode((await run(["remote", "get-url", name], { userConfig: true })).stdout).trim() ||
            null
          );
        } catch (error) {
          if (error instanceof Error && error.message.includes("No such remote")) return null;
          throw error;
        }
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
