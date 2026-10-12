/** The one place Piano decides how it reads Git safely. Every Git read runs without inherited
 * GIT_* state (GIT_DIR/INDEX/OBJECT overrides), global or system config, replace refs,
 * optional locks, fsmonitor or pager, so the environment cannot redirect an answer (INV-06).
 * Source-local repository config is still read by Git; a caller that writes (an index) adds
 * `-c` config to disable hooks and filters. A read whose answer the user's Git config defines
 * (a remote URL after `url.<base>.insteadOf`) opts back into global and system config with
 * `userConfig`; inherited GIT_* state stays cleared. Output is bounded, UTF-8 checked and NUL lists
 * must be complete; repository paths must be relative and stay out of embedded repositories.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Effect, Semaphore } from "effect";
import type { Workspace } from "../shared/wire.ts";
import {
  GitCommand,
  type RunOptions,
  type RunResult,
  runAsync,
  SubprocessError,
} from "./Subprocess.ts";

function hardenedEnv(extra: Record<string, string> = {}, userConfig = false): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
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

/** One hardened Git read in `cwd`, for callers that need no checkout root (worktree discovery,
 * directory hints). Interruption kills the child.
 */
export const gitRead = (
  args: readonly string[],
  options: Pick<GitOptions, "cwd" | "timeout" | "limit" | "userConfig">,
): Effect.Effect<RunResult, Error> =>
  Effect.flatMap(GitCommand, (git) =>
    Effect.tryPromise({
      try: (signal) => runGit(git, args, options, signal),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  );

/** A failure this module detects. Callers keep their own phrasing through `messages`. */
export class CheckoutError extends Error {
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

export interface CheckoutOptions {
  /** The Git executable (`GitCommand`). */
  readonly git: string;
  readonly signal: AbortSignal;
  /** Default stdout bound for each read. */
  readonly limit: number;
  readonly config?: readonly string[];
  readonly messages?: Partial<CheckoutMessages>;
}
export interface ReadOptions extends Pick<RunOptions, "input" | "limit" | "okCodes"> {
  /** Run outside the checkout with the same hardening, e.g. `diff --no-index` over copies. */
  readonly cwd?: string;
}

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
  /** The same checkout with added `-c` config or environment (a disposable GIT_INDEX_FILE). */
  readonly with: (extra: {
    readonly config?: readonly string[];
    readonly env?: Record<string, string>;
  }) => Checkout;
}

/** Fails with CheckoutError("root") unless `path` is the root of a Git checkout. */
export async function openCheckout(path: string, options: CheckoutOptions): Promise<Checkout> {
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
      read: ReadOptions & { truncate?: boolean } = {},
    ) => {
      const { cwd: elsewhere = cwd, limit = options.limit, ...rest } = read;
      try {
        return await runGit(
          options.git,
          args,
          { ...rest, cwd: elsewhere, limit, config, env },
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
      branch: () => optional(["symbolic-ref", "--quiet", "--short", "HEAD"]),
      with: (extra) => make([...config, ...(extra.config ?? [])], { ...env, ...extra.env }),
    };
  };
  const checkout = make(options.config ?? [], {});
  const top = (await checkout.text(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  if ((await realpath(top)) !== cwd) fail("root", messages.root);
  return checkout;
}

/** A point-in-time observation of `workspace` (INV-07): one of `slots` permits, cancelled after
 * `timeout`, any failure kept as `{ status, detail }` rather than thrown.
 */
export const observe = <R, S extends string = "error">(
  workspace: Workspace,
  slots: Semaphore.Semaphore,
  read: (signal: AbortSignal) => Promise<R>,
  options: { readonly timeout?: number; readonly status?: (error: unknown) => S } = {},
): Effect.Effect<{
  workspace: Workspace;
  observedAt: string;
  result: R | { status: S; detail: string };
}> =>
  Semaphore.withPermits(
    slots,
    1,
  )(
    Effect.promise(async (signal) => {
      let result: R | { status: S; detail: string };
      try {
        result = await read(
          AbortSignal.any([signal, AbortSignal.timeout(options.timeout ?? 30_000)]),
        );
      } catch (error) {
        result = {
          status: options.status?.(error) ?? ("error" as S),
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      return { workspace, observedAt: new Date().toISOString(), result };
    }),
  );
