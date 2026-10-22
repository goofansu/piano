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
  type WorkspaceChanges as Observation,
  type Workspace,
  type WrittenFile,
  type WorkspaceWrittenFiles as WrittenObservation,
} from "../shared/wire.ts";
import { type Checkout, observeCheckout } from "./GitCheckout.ts";
import { place } from "./WorkspaceFiles.ts";

export class WorkspaceChanges extends Context.Service<
  WorkspaceChanges,
  {
    readonly preview: (workspace: Workspace, path?: string) => Effect.Effect<Observation>;
    /** Where each of `paths` (as a session's tool calls named them: relative to the workspace, or
     * absolute) stands: outside the workspace, ignored by Git, no longer existing, or listed. A
     * tracked file is never ignored. */
    readonly written: (
      workspace: Workspace,
      paths: readonly string[],
    ) => Effect.Effect<WrittenObservation>;
  }
>()("piano/WorkspaceChanges") {}

async function preview(
  checkout: Checkout,
  path: string | undefined,
): Promise<Observation["result"]> {
  if (path !== undefined) checkout.safePath(path);
  const head = await checkout.head();
  const branch = await checkout.branch();
  const base =
    head ??
    (
      await checkout.text(["hash-object", "-w", "-t", "tree", "--stdin"], {
        input: Buffer.alloc(0),
      })
    ).trim();
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
    const pathArgs = path === undefined ? [] : [`:(top,literal)${path}`];
    if ((await git.run(["ls-files", "--unmerged", "-z", "--", ...pathArgs])).stdout.length) {
      throw new Error("Unresolved merge conflicts; resolve them before browsing this diff.");
    }
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
    const patch = await git.excerpt(
      [...diffArgs, "--patch", base, "--", ...pathArgs],
      path === undefined ? CHANGES_INITIAL_PATCH_BYTES : CHANGES_FILE_PATCH_BYTES,
    );
    return { status: "ready", head, branch, files, diff: patch.text, truncated: patch.truncated };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
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
    return WorkspaceChanges.of({
      preview: (workspace, path) =>
        observeCheckout(
          workspace,
          {
            slots,
            limit: 16 * 1024 * 1024,
            writes: "index",
            messages: {
              root: "Changes requires the Git checkout root.",
              limit: "Git metadata exceeds 16 MiB; no partial file list is shown.",
              path: () => "Unsupported repository path (including embedded repositories).",
            },
          },
          (checkout) => preview(checkout, path),
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
