/** Bounded live browsing (INV-01/07/09), deliberately independent of exact capture.
 * Only a disposable index is written. No hooks, clean filters, textconv or external diff.
 */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import {
  CHANGES_FILE_PATCH_BYTES,
  CHANGES_INITIAL_PATCH_BYTES,
  type ChangeFile,
  type WorkspaceChanges as Observation,
  type Workspace,
} from "../shared/wire.ts";
import { observe, openCheckout } from "./GitCheckout.ts";
import { GitCommand } from "./Subprocess.ts";

export class WorkspaceChanges extends Context.Service<
  WorkspaceChanges,
  {
    readonly preview: (workspace: Workspace, path?: string) => Effect.Effect<Observation>;
  }
>()("piano/WorkspaceChanges") {}

async function preview(
  git: string,
  workspace: Workspace,
  path: string | undefined,
  signal: AbortSignal,
): Promise<Observation["result"]> {
  const checkout = await openCheckout(workspace.path, {
    git,
    signal,
    limit: 16 * 1024 * 1024,
    config: ["-c", "core.hooksPath=/dev/null"],
    messages: {
      root: "Changes requires the Git checkout root.",
      limit: "Git metadata exceeds 16 MiB; no partial file list is shown.",
      path: () => "Unsupported repository path (including embedded repositories).",
    },
  });
  if (path !== undefined) checkout.safePath(path);
  // Disable every locally configured filter driver before diff/add touches working files.
  const filters = await checkout.records(
    ["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"],
    { okCodes: [0, 1] },
  );
  const filtered = checkout.with({
    config: filters.flatMap((key) => ["-c", `${key}=${key.endsWith(".required") ? "false" : ""}`]),
  });
  const head = await filtered.head();
  const branch = await filtered.branch();
  const base =
    head ??
    (
      await filtered.text(["hash-object", "-w", "-t", "tree", "--stdin"], {
        input: Buffer.alloc(0),
      })
    ).trim();
  const temp = await mkdtemp(join(tmpdir(), "piano-changes-"));
  try {
    const index = (
      await filtered.text(["rev-parse", "--path-format=absolute", "--git-path", "index"])
    ).trimEnd();
    const temporaryIndex = join(temp, "index");
    try {
      await copyFile(index, temporaryIndex);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const git = filtered.with({ env: { GIT_INDEX_FILE: temporaryIndex } });
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

export const WorkspaceChangesLive = Layer.effect(
  WorkspaceChanges,
  Effect.gen(function* () {
    // Expanding many files must not spawn an unbounded number of Git processes/index copies.
    const slots = yield* Semaphore.make(4);
    const git = yield* GitCommand;
    return WorkspaceChanges.of({
      preview: (workspace, path) =>
        observe(workspace, slots, (signal) => preview(git, workspace, path, signal)),
    });
  }),
);
