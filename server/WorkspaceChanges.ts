/** Bounded live browsing (INV-01/07/09), deliberately independent of exact capture.
 * Only a disposable index is written. No hooks, clean filters, textconv or external diff.
 */
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import { CHANGES_FILE_PATCH_BYTES, CHANGES_INITIAL_PATCH_BYTES, type ChangeFile, type WorkspaceChanges as Observation, type Workspace } from "../shared/wire.ts";

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
  if (!path || isAbsolute(path) || path.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git")) {
    throw new Error("Unsupported repository path (including embedded repositories).");
  }
  return path;
}

async function preview(workspace: Workspace, path: string | undefined, signal: AbortSignal): Promise<Observation["result"]> {
  if (path !== undefined) safePath(path);
  const cwd = await realpath(workspace.path);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", LC_ALL: "C" };
  const config = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
  const git = (args: string[], limit = METADATA, truncate = false, input?: Buffer, allowed = [0]) => new Promise<{ bytes: Buffer; truncated: boolean; code: number | null }>((resolve, reject) => {
    const child = spawn("git", ["--no-pager", ...config, ...args], { cwd, env, signal, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let size = 0, overflow = false, stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = limit - size;
      if (chunk.length > remaining) overflow = true;
      if (remaining > 0) { const kept = chunk.subarray(0, remaining); chunks.push(kept); size += kept.length; }
      if (overflow && !truncate) child.kill();
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(0, 8192); });
    child.on("error", reject); child.stdin.on("error", () => {});
    child.on("close", code => {
      if (overflow && !truncate) reject(new Error("Git metadata exceeds 16 MiB; no partial file list is shown."));
      else if (!allowed.includes(code ?? -1)) reject(new Error(`Git ${args[0]} failed: ${stderr.trim() || `exit ${code}`}`));
      else resolve({ bytes: Buffer.concat(chunks), truncated: overflow, code });
    });
    child.stdin.end(input);
  });
  const top = text((await git(["rev-parse", "--show-toplevel"])).bytes).trimEnd();
  if (await realpath(top) !== cwd) throw new Error("Changes requires the Git checkout root.");
  // Disable every locally configured filter driver before diff/add touches working files.
  const filters = paths((await git(["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"], METADATA, false, undefined, [0, 1])).bytes);
  for (const key of filters) config.push("-c", `${key}=${key.endsWith(".required") ? "false" : ""}`);
  const headRead = await git(["rev-parse", "--verify", "--quiet", "HEAD"], METADATA, false, undefined, [0, 1]);
  const head = headRead.code === 0 ? text(headRead.bytes).trim() : null;
  const branchRead = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], METADATA, false, undefined, [0, 1]);
  const branch = branchRead.code === 0 ? text(branchRead.bytes).trim() : null;
  const base = head ?? text((await git(["hash-object", "-w", "-t", "tree", "--stdin"], METADATA, false, Buffer.alloc(0))).bytes).trim();
  const temp = await mkdtemp(join(tmpdir(), "piano-changes-"));
  try {
    const index = text((await git(["rev-parse", "--path-format=absolute", "--git-path", "index"])).bytes).trimEnd();
    const temporaryIndex = join(temp, "index");
    try { await copyFile(index, temporaryIndex); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    Object.assign(env, { GIT_INDEX_FILE: temporaryIndex });
    const pathArgs = path === undefined ? [] : [`:(top,literal)${path}`];
    if ((await git(["ls-files", "--unmerged", "-z", "--", ...pathArgs])).bytes.length) {
      throw new Error("Unresolved merge conflicts; resolve them before browsing this diff.");
    }
    const untracked = paths((await git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathArgs])).bytes);
    for (const name of untracked) safePath(name);
    if (untracked.length) await git(["--literal-pathspecs", "add", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul"], METADATA, false, Buffer.from(`${untracked.join("\0")}\0`));
    const diffArgs = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none", "--src-prefix=a/", "--dst-prefix=b/"];
    const stats = paths((await git([...diffArgs, "--numstat", "-z", base, "--", ...pathArgs])).bytes);
    const files: ChangeFile[] = stats.map(row => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("Incomplete or unsupported Git metadata; no file list is available.");
      return { path: safePath(match[3]), binary: match[1] === "-", additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 };
    });
    const patch = await git([...diffArgs, "--patch", base, "--", ...pathArgs], path === undefined ? CHANGES_INITIAL_PATCH_BYTES : CHANGES_FILE_PATCH_BYTES, true);
    // Drop a cut UTF-8 character/line: never invent text at the byte boundary.
    const bytes = patch.truncated ? patch.bytes.subarray(0, Math.max(0, patch.bytes.lastIndexOf(10) + 1)) : patch.bytes;
    return { status: "ready", head, branch, files, diff: text(bytes), truncated: patch.truncated };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export const WorkspaceChangesLive = Layer.effect(WorkspaceChanges, Effect.gen(function* () {
  // Expanding many files must not spawn an unbounded number of Git processes/index copies.
  const slots = yield* Semaphore.make(4);
  return WorkspaceChanges.of({ preview: (workspace, path) => Semaphore.withPermits(slots, 1)(Effect.promise(async signal => {
    let result: Observation["result"];
    try { result = await preview(workspace, path, AbortSignal.any([signal, AbortSignal.timeout(30_000)])); }
    catch (error) { result = { status: "error", detail: error instanceof Error ? error.message : String(error) }; }
    return { workspace, observedAt: new Date().toISOString(), result };
  })) });
}));
