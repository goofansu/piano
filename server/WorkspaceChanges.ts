/** Bounded live browsing (INV-01/07/09), deliberately independent of exact capture.
 * Only a disposable index is written. No hooks, clean filters, textconv or external diff.
 */
import { copyFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import {
  CHANGES_FILE_PATCH_BYTES,
  CHANGES_INITIAL_PATCH_BYTES,
  type ChangeFile,
  type ChangesScope,
  type LocalWork,
  type WorkspaceChanges as Observation,
  type Workspace,
  type WrittenFile,
  type WorkspaceWrittenFiles as WrittenObservation,
} from "../shared/wire.ts";
import {
  type Comparisons,
  commitsNotPushed,
  resolveComparisons,
  type TargetHints,
} from "./ComparisonBase.ts";
import { type Checkout, type CheckoutObservation, observeCheckout } from "./GitCheckout.ts";
import { place } from "./WorkspaceFiles.ts";

type Ready = Extract<Observation["result"], { readonly status: "ready" }>;
type Unavailable = Extract<Observation["result"], { readonly status: "unavailable" }>;
type Summary = Omit<Ready, "diff" | "truncated">;
/** A preview's facts without its patch: what a status read carries. */
export type ChangesSummary = CheckoutObservation<Summary | Unavailable>;

/** What to compare, and for which file. Without `scope`, use `uncommitted`. */
export interface PreviewOptions {
  readonly scope?: ChangesScope;
  readonly hints?: TargetHints;
}

export class WorkspaceChanges extends Context.Service<
  WorkspaceChanges,
  {
    readonly preview: (
      workspace: Workspace,
      options?: PreviewOptions & { readonly path?: string },
    ) => Effect.Effect<Observation>;
    /** The branch and changed files `preview` would show, read without rendering any patch. */
    readonly summary: (
      workspace: Workspace,
      options?: PreviewOptions,
    ) => Effect.Effect<ChangesSummary>;
    /** Where each of `paths` (as a session's tool calls named them: relative to the workspace, or
     * absolute) stands: outside the workspace, ignored by Git, no longer existing, or listed. A
     * tracked file is never ignored. */
    readonly written: (
      workspace: Workspace,
      paths: readonly string[],
    ) => Effect.Effect<WrittenObservation>;
  }
>()("piano/WorkspaceChanges") {}

/** The checkout's changes against the scope's base, with the patch only when asked for. */
function preview(
  checkout: Checkout,
  options: PreviewOptions,
  path: string | undefined,
  patch: true,
): Promise<Ready | Unavailable>;
function preview(
  checkout: Checkout,
  options: PreviewOptions,
  path: string | undefined,
  patch: false,
): Promise<Summary | Unavailable>;
async function preview(
  checkout: Checkout,
  options: PreviewOptions,
  path: string | undefined,
  patch: boolean,
): Promise<Ready | Summary | Unavailable> {
  if (path !== undefined) checkout.safePath(path);
  const comparisons = await resolveComparisons(checkout, options.hints);
  const { head, branch, pullRequestFromBranch, scopes } = comparisons;
  const scope = options.scope ?? "uncommitted";
  const resolved = comparisons.of(scope);
  const unavailable = async (detail: string): Promise<Unavailable> => ({
    status: "unavailable",
    head,
    branch,
    pullRequestFromBranch,
    scope,
    detail,
    scopes,
    local: await localWork(checkout, comparisons),
  });
  if ("unavailable" in resolved) return unavailable(resolved.unavailable);
  const pathArgs = path === undefined ? [] : [`:(top,literal)${path}`];
  // A merge in progress leaves no single diff to browse, yet the scopes and local work still hold.
  if ((await checkout.run(["ls-files", "--unmerged", "-z", "--", ...pathArgs])).stdout.length)
    return unavailable("Unresolved merge conflicts; resolve them before browsing this diff.");
  const { comparison } = resolved;
  const base = comparison.base;
  const temp = await mkdtemp(join(tmpdir(), "piano-changes-"));
  try {
    const index = (
      await checkout.text(["rev-parse", "--path-format=absolute", "--git-path", "index"])
    ).trimEnd();
    const temporaryIndex = join(temp, "index");
    try {
      await copyFile(index, temporaryIndex);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const git = checkout.with({ env: { GIT_INDEX_FILE: temporaryIndex } });
    const untracked = (
      await git.records(["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathArgs])
    ).map(git.safePath);
    if (untracked.length)
      await git.run(
        [
          "--literal-pathspecs",
          "add",
          "--intent-to-add",
          "--pathspec-from-file=-",
          "--pathspec-file-nul",
        ],
        { input: Buffer.from(`${untracked.join("\0")}\0`) },
      );
    const diffArgs = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--ignore-submodules=none",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    ];
    const files: ChangeFile[] = (
      await git.records([...diffArgs, "--numstat", "-z", base, "--", ...pathArgs])
    ).map((row) => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);
      if (!match)
        throw new Error("Incomplete or unsupported Git metadata; no file list is available.");
      return {
        path: git.safePath(match[3]),
        binary: match[1] === "-",
        additions: Number(match[1]) || 0,
        deletions: Number(match[2]) || 0,
      };
    });
    const local = await localWork(checkout, comparisons);
    if (!patch)
      return {
        status: "ready",
        head,
        branch,
        pullRequestFromBranch,
        comparison,
        scopes,
        local,
        files,
      };
    const excerpt = await git.excerpt(
      [...diffArgs, "--patch", base, "--", ...pathArgs],
      path === undefined ? CHANGES_INITIAL_PATCH_BYTES : CHANGES_FILE_PATCH_BYTES,
    );
    return {
      status: "ready",
      head,
      branch,
      pullRequestFromBranch,
      comparison,
      scopes,
      local,
      files,
      diff: excerpt.text,
      truncated: excerpt.truncated,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** What is still only here, whatever the scope and whether it can be read: edits HEAD lacks
 * (untracked, non-ignored files included) and commits the remote-tracking ref lacks. */
async function localWork(checkout: Checkout, comparisons: Comparisons): Promise<LocalWork> {
  const { head, branch } = comparisons;
  const untracked = await checkout.records(["ls-files", "--others", "--exclude-standard", "-z"]);
  const uncommitted =
    untracked.length > 0 ||
    (
      await checkout.run(
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--ignore-submodules=none",
          "--quiet",
          comparisons.of("uncommitted").comparison.base,
          "--",
        ],
        { okCodes: [0, 1] },
      )
    ).code === 1;
  return { commitsNotPushed: await commitsNotPushed(checkout, head, branch), uncommitted };
}

/** Whether `path` (relative to the workspace, or absolute) names something on disk; a dangling
 * symlink does. Fails on anything but the path's absence. */
export const exists = (workspace: Workspace, path: string): Promise<boolean> =>
  lstat(resolve(workspace.path, path)).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return false;
    },
  );

/** Each path placed as the Files list places it, then `git check-ignore` over the placed names of
 * those inside (it exits 1 when none is ignored). A path inside that names nothing on disk (a file a
 * later command removed) is missing; a dangling symlink still exists. */
async function written(
  checkout: Checkout,
  workspace: Workspace,
  paths: readonly string[],
): Promise<WrittenObservation["result"]> {
  const placed: (string | undefined)[] = [];
  for (const path of paths) placed.push(await place(workspace, path));
  const inside = placed.filter((name) => name !== undefined);
  const hits = new Set<string>();
  if (inside.length) {
    const result = await checkout.run(["check-ignore", "-z", "--stdin"], {
      input: Buffer.from(`${inside.join("\0")}\0`),
      okCodes: [0, 1],
    });
    for (const name of result.stdout.toString("utf8").split("\0")) if (name) hits.add(name);
  }
  const files: WrittenFile[] = [];
  for (const [i, path] of paths.entries()) {
    const name = placed[i];
    if (name === undefined) files.push({ path, verdict: "outside" });
    else if (hits.has(name)) files.push({ path, verdict: "ignored", placed: name });
    else
      files.push({
        path,
        verdict: (await exists(workspace, path)) ? "listed" : "missing",
        placed: name,
      });
  }
  return { status: "ready", files };
}

export const WorkspaceChangesLive = Layer.effect(
  WorkspaceChanges,
  Effect.gen(function* () {
    // Expanding many files must not spawn an unbounded number of Git processes/index copies.
    const slots = yield* Semaphore.make(4);
    const changes = {
      slots,
      limit: 16 * 1024 * 1024,
      writes: "index",
      messages: {
        root: "Changes requires the Git checkout root.",
        limit: "Git metadata exceeds 16 MiB; no partial file list is shown.",
        path: () => "Unsupported repository path (including embedded repositories).",
      },
    } as const;
    return WorkspaceChanges.of({
      preview: (workspace, options = {}) =>
        observeCheckout(workspace, changes, (checkout) =>
          preview(checkout, options, options.path, true),
        ),
      summary: (workspace, options = {}) =>
        observeCheckout(workspace, changes, (checkout) =>
          preview(checkout, options, undefined, false),
        ),
      written: (workspace, paths) =>
        observeCheckout(
          workspace,
          {
            slots,
            limit: 1024 * 1024,
            messages: { root: "Files requires the Git checkout root." },
          },
          (checkout) => written(checkout, workspace, paths),
        ),
    });
  }),
);
