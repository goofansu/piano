/** Bounded live browsing (INV-01/07/09), deliberately independent of exact capture.
 * Only a disposable index is written. No hooks, clean filters, textconv or external diff.
 */
import { copyFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import {
  CHANGES_FILE_PATCH_BYTES,
  CHANGES_INITIAL_PATCH_BYTES,
  type ChangeFile,
  type WorkspaceIgnoredFiles as IgnoredObservation,
  type WorkspaceChanges as Observation,
  type Workspace,
} from "../shared/wire.ts";
import { type Checkout, observeCheckout } from "./GitCheckout.ts";
import { within } from "./WorkspaceFiles.ts";

export class WorkspaceChanges extends Context.Service<
  WorkspaceChanges,
  {
    readonly preview: (workspace: Workspace, path?: string) => Effect.Effect<Observation>;
    /** Which of `paths` (as a session's tool calls named them: relative to the workspace, or
     * absolute) Git ignores, and which lie outside the workspace. A tracked file is never ignored. */
    readonly ignored: (
      workspace: Workspace,
      paths: readonly string[],
    ) => Effect.Effect<IgnoredObservation>;
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

/** The physical path: the nearest existing ancestor resolved, the rest (a file not written yet,
 * or already removed) reattached. */
async function physical(target: string): Promise<string> {
  let head = target;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(await realpath(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return target;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/** `git check-ignore` over the paths inside the checkout; it exits 1 when none is ignored. A path
 * is placed by the workspace's own (possibly symlinked) path first, then by the physical root. */
async function ignored(
  checkout: Checkout,
  workspacePath: string,
  paths: readonly string[],
): Promise<IgnoredObservation["result"]> {
  const logical = resolve(workspacePath);
  const inside = new Map<string, string>();
  const outside: string[] = [];
  for (const path of paths) {
    const target = resolve(logical, path);
    if (within(logical, target)) {
      inside.set(path, relative(logical, target));
      continue;
    }
    const real = await physical(target);
    if (within(checkout.cwd, real)) inside.set(path, relative(checkout.cwd, real));
    else outside.push(path);
  }
  if (inside.size === 0) return { status: "ready", ignored: [], outside };
  const result = await checkout.run(["check-ignore", "-z", "--stdin"], {
    input: Buffer.from(`${[...inside.values()].join("\0")}\0`),
    okCodes: [0, 1],
  });
  const hits = new Set(result.stdout.toString("utf8").split("\0").filter(Boolean));
  return {
    status: "ready",
    ignored: [...inside].filter(([, name]) => hits.has(name)).map(([path]) => path),
    outside,
  };
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
      ignored: (workspace, paths) =>
        observeCheckout(
          workspace,
          {
            slots,
            limit: 1024 * 1024,
            messages: { root: "Files requires the Git checkout root." },
          },
          (checkout) => ignored(checkout, workspace.path, paths),
        ),
    });
  }),
);
