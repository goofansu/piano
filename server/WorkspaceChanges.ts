/** Bounded live browsing (INV-01/07/09), deliberately independent of exact capture.
 * Only a disposable index is written. No hooks, clean filters, textconv or external diff.
 */
import { copyFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import { CHANGES_FILE_PATCH_BYTES, CHANGES_INITIAL_PATCH_BYTES, type ChangeFile, type WorkspaceChanges as Observation, type Workspace } from "../shared/wire.ts";
import { hardenedGit, isSafePath } from "./HardenedGit.ts";
import { GitCommand, SubprocessError } from "./Subprocess.ts";

export class WorkspaceChanges extends Context.Service<WorkspaceChanges, {
  readonly preview: (workspace: Workspace, path?: string) => Effect.Effect<Observation>;
}>()("piano/WorkspaceChanges") {}
const METADATA = 16 * 1024 * 1024;

function text(bytes: Buffer) {
  const value = bytes.toString("utf8");
  if (!Buffer.from(value).equals(bytes)) throw new Error("Git output contains unsupported non-UTF-8 bytes.");
  return value;
}
function paths(bytes: Buffer) {
  const value = text(bytes);
  if (value && !value.endsWith("\0")) throw new Error("Incomplete Git metadata; no file list is available.");
  return value.split("\0").filter(Boolean);
}
function safePath(path: string) {
  if (!isSafePath(path)) throw new Error("Unsupported repository path (including embedded repositories).");
  return path;
}

async function preview(cli: string, workspace: Workspace, path: string | undefined, signal: AbortSignal): Promise<Observation["result"]> {
  if (path !== undefined) safePath(path);
  const cwd = await realpath(workspace.path);
  const env: Record<string, string> = {};
  const config = ["-c", "core.hooksPath=/dev/null"];
  const git = async (args: string[], limit = METADATA, truncate = false, input?: Buffer, okCodes = [0]) => {
    try { return await hardenedGit(cli, args, { cwd, config, env, limit, truncate, input, okCodes }, signal); }
    catch (error) {
      if (error instanceof SubprocessError && error.reason === "limit") throw new Error("Git metadata exceeds 16 MiB; no partial file list is shown.");
      throw error;
    }
  };
  const top = text((await git(["rev-parse", "--show-toplevel"])).stdout).trimEnd();
  if (await realpath(top) !== cwd) throw new Error("Changes requires the Git checkout root.");
  // Disable every locally configured filter driver before diff/add touches working files.
  const filters = paths((await git(["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"], METADATA, false, undefined, [0, 1])).stdout);
  for (const key of filters) config.push("-c", `${key}=${key.endsWith(".required") ? "false" : ""}`);
  const headRead = await git(["rev-parse", "--verify", "--quiet", "HEAD"], METADATA, false, undefined, [0, 1]);
  const head = headRead.code === 0 ? text(headRead.stdout).trim() : null;
  const branchRead = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], METADATA, false, undefined, [0, 1]);
  const branch = branchRead.code === 0 ? text(branchRead.stdout).trim() : null;
  const base = head ?? text((await git(["hash-object", "-w", "-t", "tree", "--stdin"], METADATA, false, Buffer.alloc(0))).stdout).trim();
  const temp = await mkdtemp(join(tmpdir(), "piano-changes-"));
  try {
    const index = text((await git(["rev-parse", "--path-format=absolute", "--git-path", "index"])).stdout).trimEnd();
    const temporaryIndex = join(temp, "index");
    try { await copyFile(index, temporaryIndex); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    env.GIT_INDEX_FILE = temporaryIndex;
    const pathArgs = path === undefined ? [] : [`:(top,literal)${path}`];
    if ((await git(["ls-files", "--unmerged", "-z", "--", ...pathArgs])).stdout.length) {
      throw new Error("Unresolved merge conflicts; resolve them before browsing this diff.");
    }
    const untracked = paths((await git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathArgs])).stdout);
    for (const name of untracked) safePath(name);
    if (untracked.length) await git(["--literal-pathspecs", "add", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul"], METADATA, false, Buffer.from(`${untracked.join("\0")}\0`));
    const diffArgs = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none", "--src-prefix=a/", "--dst-prefix=b/"];
    const stats = paths((await git([...diffArgs, "--numstat", "-z", base, "--", ...pathArgs])).stdout);
    const files: ChangeFile[] = stats.map(row => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("Incomplete or unsupported Git metadata; no file list is available.");
      return { path: safePath(match[3]), binary: match[1] === "-", additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 };
    });
    const patch = await git([...diffArgs, "--patch", base, "--", ...pathArgs], path === undefined ? CHANGES_INITIAL_PATCH_BYTES : CHANGES_FILE_PATCH_BYTES, true);
    // Drop a cut UTF-8 character/line: never invent text at the byte boundary.
    const bytes = patch.truncated ? patch.stdout.subarray(0, Math.max(0, patch.stdout.lastIndexOf(10) + 1)) : patch.stdout;
    return { status: "ready", head, branch, files, diff: text(bytes), truncated: patch.truncated };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export const WorkspaceChangesLive = Layer.effect(WorkspaceChanges, Effect.gen(function* () {
  // Expanding many files must not spawn an unbounded number of Git processes/index copies.
  const slots = yield* Semaphore.make(4);
  const cli = yield* GitCommand;
  return WorkspaceChanges.of({ preview: (workspace, path) => Semaphore.withPermits(slots, 1)(Effect.promise(async signal => {
    let result: Observation["result"];
    try { result = await preview(cli, workspace, path, AbortSignal.any([signal, AbortSignal.timeout(30_000)])); }
    catch (error) { result = { status: "error", detail: error instanceof Error ? error.message : String(error) }; }
    return { workspace, observedAt: new Date().toISOString(), result };
  })) });
}));
