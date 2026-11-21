import { copyFile, lstat, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import { answerJson } from "../../../../shared/endpoint.ts";
import type { ChangesScope, Workspace } from "../../../../shared/wire.ts";
import {
  CHANGES_ANSWER_BYTES,
  CHANGES_FILE_PATCH_BYTES,
  CHANGES_INITIAL_PATCH_BYTES,
  type ChangeFile,
  type LocalWork,
  type WorkspaceChanges as Observation,
} from "../../contracts/changes/http.ts";
import type {
  WrittenFile,
  WorkspaceWrittenFiles as WrittenObservation,
} from "../../contracts/files/http.ts";
import { place, spell } from "../files/WorkspaceFiles.ts";
import { type Checkout, type CheckoutObservation, observeCheckout } from "../GitCheckout.ts";
import {
  type Comparisons,
  commitsNotPushed,
  resolveComparisons,
  type TargetHints,
} from "./ComparisonBase.ts";

type Ready = Extract<Observation["result"], { readonly status: "ready" }>;
type Unavailable = Extract<Observation["result"], { readonly status: "unavailable" }>;
type Summary = Omit<Ready, "diff" | "truncated">;
export type ChangesSummary = CheckoutObservation<Summary | Unavailable>;

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
    readonly summary: (
      workspace: Workspace,
      options?: PreviewOptions,
    ) => Effect.Effect<ChangesSummary>;
    readonly written: (
      workspace: Workspace,
      paths: readonly string[],
    ) => Effect.Effect<WrittenObservation>;
  }
>()("piano/WorkspaceChanges") {}

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
  if ((await checkout.run(["ls-files", "--unmerged", "-z", "--", ...pathArgs])).stdout.length)
    return unavailable("Unresolved merge conflicts; resolve them before browsing this diff.");
  const { comparison } = resolved;
  const base = comparison.base;
  const temp = await mkdtemp(join(tmpdir(), "piano-changes-"));
  try {
    const index = (
      await checkout.text(["rev-parse", "--path-format=absolute", "--git-path", "index"])
    ).trimEnd();
    // Two copies: intent-to-add entries for untracked paths can displace a staged file at a
    // colliding path (a staged `dir` and an untracked `dir/child`), so staged reads keep the copy
    // that intent-to-add never touches.
    const stagedIndex = join(temp, "index");
    const workingIndex = join(temp, "working-index");
    try {
      // Git trusts cached stat data for entries older than the index file, so a fresh copy's mtime
      // would hide a same-size edit made in the tick of the last index write. Stat before copying
      // and round down, so the copy is never newer than what it holds.
      const { atimeMs, mtimeMs } = await stat(index);
      for (const copy of [stagedIndex, workingIndex]) {
        await copyFile(index, copy);
        await utimes(copy, new Date(Math.floor(atimeMs)), new Date(Math.floor(mtimeMs)));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const cachedGit = checkout.with({ env: { GIT_INDEX_FILE: stagedIndex } });
    const git = checkout.with({ env: { GIT_INDEX_FILE: workingIndex } });
    const diffArgs = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--ignore-submodules=none",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    ];
    const numstat = async (reader: typeof git, args: readonly string[]): Promise<ChangeFile[]> =>
      (
        await reader.records([...diffArgs, ...args, "--numstat", "-z", base, "--", ...pathArgs])
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
    const indexed = scope === "uncommitted" ? await numstat(cachedGit, ["--cached"]) : [];
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
    const working = await numstat(git, []);
    const listed = new Set(working.map((file) => file.path));
    const staged = indexed
      .filter((file) => !listed.has(file.path))
      .map((file) => ({ ...file, staged: true as const }));
    const files: ChangeFile[] = [...working, ...staged];
    const local = await localWork(
      checkout,
      comparisons,
      scope === "uncommitted" && path === undefined ? files : undefined,
    );
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
    const limit = path === undefined ? CHANGES_INITIAL_PATCH_BYTES : CHANGES_FILE_PATCH_BYTES;
    const patches = async (
      reader: typeof git,
      args: readonly string[],
      selections: Iterable<readonly string[]>,
      rest: number,
    ): Promise<{ text: string; truncated: boolean }> => {
      let text = "";
      for (const selection of selections) {
        if (rest <= 0) return { text, truncated: true };
        const part = await reader.excerpt(
          [...diffArgs, ...args, "--patch", base, "--", ...selection],
          rest,
        );
        text += part.text;
        rest -= Buffer.byteLength(part.text);
        if (part.truncated) return { text, truncated: true };
      }
      return { text, truncated: false };
    };
    let excerpt = await patches(
      git,
      [],
      !working.length ? [] : staged.length ? exactBatches(working) : [pathArgs],
      limit,
    );
    if (staged.length && !excerpt.truncated) {
      const index = await patches(
        cachedGit,
        ["--cached"],
        exactBatches(staged),
        limit - Buffer.byteLength(excerpt.text),
      );
      excerpt = { text: excerpt.text + index.text, truncated: index.truncated };
    }
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

// A literal or plain-glob pathspec also matches every path beneath it, so selecting a file `dir`
// would also pull in `dir/child`. Escaping each character makes Git's glob matcher compare the
// whole path, matching only the file itself.
const exactGlob = (path: string): string =>
  `:(top,glob)${path.replace(/[^/]/gu, (char) => `\\${char}`)}`;

// Thousands of long paths in one Git command exceed Linux's exec argument limit (spawn E2BIG), so
// paths are selected in batches of bounded size.
const PATHSPEC_BATCH_BYTES = 128 * 1024;

function* exactBatches(files: readonly ChangeFile[]): Generator<string[]> {
  let batch: string[] = [];
  let bytes = 0;
  for (const file of files) {
    const spec = exactGlob(file.path);
    const size = Buffer.byteLength(spec) + 1;
    if (batch.length && bytes + size > PATHSPEC_BATCH_BYTES) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(spec);
    bytes += size;
  }
  if (batch.length) yield batch;
}

const bounded = (observation: Observation): Observation =>
  Buffer.byteLength(answerJson(observation)) <= CHANGES_ANSWER_BYTES
    ? observation
    : {
        ...observation,
        result: {
          status: "error",
          detail: "Changes are too large to list; no partial file list is shown.",
        },
      };

async function localWork(
  checkout: Checkout,
  comparisons: Comparisons,
  uncommittedFiles?: readonly ChangeFile[],
): Promise<LocalWork> {
  const commits = await commitsNotPushed(checkout, comparisons);
  if (uncommittedFiles)
    return { commitsNotPushed: commits, uncommitted: uncommittedFiles.length > 0 };
  const base = comparisons.of("uncommitted").comparison.base;
  const differs = async (cached: readonly string[]) =>
    (
      await checkout.run(
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--ignore-submodules=none",
          "--quiet",
          ...cached,
          base,
          "--",
        ],
        { okCodes: [0, 1] },
      )
    ).code === 1;
  const untracked = await checkout.records(["ls-files", "--others", "--exclude-standard", "-z"]);
  const uncommitted = untracked.length > 0 || (await differs([])) || (await differs(["--cached"]));
  return { commitsNotPushed: commits, uncommitted };
}

const exists = (workspace: Workspace, path: string): Promise<boolean> =>
  lstat(spell(workspace, path)).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return false;
    },
  );

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
        observeCheckout(workspace, changes, async (checkout) =>
          preview(await checkout.withUserExcludes(), options, options.path, true),
        ).pipe(Effect.map(bounded)),
      summary: (workspace, options = {}) =>
        observeCheckout(workspace, changes, async (checkout) =>
          preview(await checkout.withUserExcludes(), options, undefined, false),
        ),
      written: (workspace, paths) =>
        observeCheckout(
          workspace,
          {
            slots,
            limit: 1024 * 1024,
            messages: { root: "Files requires the Git checkout root." },
          },
          async (checkout) => written(await checkout.withUserExcludes(), workspace, paths),
        ),
    });
  }),
);
