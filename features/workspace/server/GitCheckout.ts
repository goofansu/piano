import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Data, Effect, Semaphore } from "effect";
import { childEnvironment } from "../../../server/shared/ChildEnvironment.ts";
import {
  GitCommand,
  type RunOptions,
  type RunResult,
  runAsync,
  SubprocessError,
} from "../../../server/shared/Subprocess.ts";
import type { Workspace } from "../../../shared/wire.ts";

function hardenedEnv(extra: Record<string, string> = {}, userConfig = false): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(childEnvironment()).filter(([key]) => !key.startsWith("GIT_")),
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

interface GitOptions extends Pick<
  RunOptions,
  "input" | "limit" | "truncate" | "okCodes" | "timeout"
> {
  readonly cwd: string;
  readonly config?: readonly string[];
  readonly env?: Record<string, string>;
  readonly userConfig?: boolean;
}

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

export class GitReadError extends Data.TaggedError("GitReadError")<{ readonly detail: string }> {
  override get message() {
    return this.detail;
  }
}

export const gitText = Effect.fn("GitCheckout.gitText")(function* (
  cwd: string,
  args: readonly string[],
  options: Pick<GitOptions, "timeout" | "userConfig" | "config"> = {},
): Effect.fn.Return<string, GitReadError> {
  const git = yield* GitCommand;
  const { timeout = 20_000, ...settings } = options;
  const result = yield* Effect.tryPromise({
    try: (signal) =>
      runGit(git, args, { cwd, timeout, ...settings, limit: 8 * 1024 * 1024 }, signal),
    catch: (error) =>
      new GitReadError({ detail: error instanceof Error ? error.message : String(error) }),
  });
  return result.stdout.toString();
});

export async function worktreeInstance(gitDir: string): Promise<string> {
  const { ino, birthtimeNs } = await stat(gitDir, { bigint: true });
  return `${ino}:${birthtimeNs}`;
}

const BRANCH = ["branch", "--show-current"];

export interface Upstream {
  readonly remote: string;
  readonly name: string;
  readonly ref: string;
  readonly tracked: string;
}

const UPSTREAM_FORMAT =
  "%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)%00%(push:remotename)%00%(push)%00%(push:remoteref)";

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
  const name = named ?? ((push === upstream && heads(remoteRef)) || branch);
  return { remote: target, name, ref: push, tracked };
}

export interface BranchHome {
  readonly upstream: Upstream | null;
  readonly url: string | null;
  readonly pushed: boolean;
}

type UserRead = (args: readonly string[]) => Promise<string>;

const pushUrlOf = async (read: UserRead, remote: string) => {
  try {
    return (await read(["remote", "get-url", "--push", "--", remote])).trim() || null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("No such remote")) return null;
    throw error;
  }
};

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

export type GitObservation =
  | { readonly status: "non-git" }
  | {
      readonly status: "checkout";
      readonly toplevel: string;
      readonly branch?: string | null;
      readonly home?: BranchHome;
    }
  | { readonly status: "broken"; readonly detail: string };

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

export const observeGit = Effect.fn("GitCheckout.observeGit")(function* (
  path: string,
  options: {
    readonly branch?: boolean;
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
  readonly git: string;
  readonly signal: AbortSignal;
}
export type ReadOptions = Pick<RunOptions, "input" | "limit" | "okCodes">;

export interface Checkout {
  readonly cwd: string;
  readonly run: (args: readonly string[], options?: ReadOptions) => Promise<RunResult>;
  readonly text: (args: readonly string[], options?: ReadOptions) => Promise<string>;
  readonly excerpt: (
    args: readonly string[],
    limit: number,
  ) => Promise<{ text: string; truncated: boolean }>;
  readonly records: (args: readonly string[], options?: ReadOptions) => Promise<string[]>;
  readonly safePath: (path: string) => string;
  readonly head: () => Promise<string | null>;
  readonly branch: () => Promise<string | null>;
  readonly remoteUrl: (name: string) => Promise<string | null>;
  readonly home: (branch: string | null) => Promise<BranchHome>;
  readonly withUserExcludes: () => Promise<Checkout>;
  readonly with: (extra: {
    readonly config?: readonly string[];
    readonly env?: Record<string, string>;
  }) => Checkout;
}

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
      remoteUrl: (name) => url(["remote", "get-url", "--", name]),
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
  const filters = await checkout.records(
    ["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"],
    { okCodes: [0, 1] },
  );
  return checkout.with({
    config: filters.flatMap((key) => ["-c", `${key}=${key.endsWith(".required") ? "false" : ""}`]),
  });
}

export interface ObserveOptions {
  readonly slots: Semaphore.Semaphore;
  readonly limit: number;
  readonly writes?: "index";
  readonly messages?: Partial<CheckoutMessages>;
  readonly timeout?: number;
}

export interface CheckoutObservation<R> {
  readonly workspace: Workspace;
  readonly observedAt: string;
  readonly result: R | { readonly status: "error"; readonly detail: string };
}

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
