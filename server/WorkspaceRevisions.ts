/** Git owns repository facts. Capture raw bytes once into a private candidate, never run
 * filters/hooks or diff the moving checkout. No verification claim includes ignored or
 * external inputs. Unsupported/racing inputs fail closed (INV-07/08).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { type BigIntStats, constants, type FSWatcher, watch } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import type { RevisionFile, RevisionManifest, Workspace, WorkspaceCapture } from "../shared/wire.ts";
import { RegistryDatabasePath } from "./Registry.ts";

export const RevisionGitCommand = Context.Reference<string>("piano/RevisionGitCommand", { defaultValue: () => "git" });
export const RevisionStorePath = Context.Reference<string | undefined>("piano/RevisionStorePath", { defaultValue: () => process.env.PIANO_REVISION_STORE });
export class WorkspaceRevisions extends Context.Service<WorkspaceRevisions, {
  /** Bounded, serialized capture. The result and persisted candidate share one manifest.
   * Cancellation discards incomplete candidates; repeated unchanged input has the same ID.
   */
  readonly capture: (workspace: Workspace) => Effect.Effect<WorkspaceCapture>;
}>()("piano/WorkspaceRevisions") {}

const MAX_BYTES = 64 * 1024 * 1024, MAX_FILE = 8 * 1024 * 1024, MAX_PATHS = 10_000, MAX_DIFF = 2 * 1024 * 1024;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
class CaptureProblem extends Error {
  readonly status: "unsupported" | "inconclusive";
  constructor(status: "unsupported" | "inconclusive", message: string) { super(message); this.status = status; }
}
const unsupported = (message: string): never => { throw new CaptureProblem("unsupported", message); };
const raced = (): never => { throw new CaptureProblem("inconclusive", "Workspace changed during capture. Stop writers and refresh; no candidate was published."); };
const split = (bytes: Buffer) => {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) unsupported("Non-UTF-8 paths are not supported for capture.");
  return text.split("\0").filter(Boolean);
};
function safePath(path: string) {
  if (!path || isAbsolute(path) || path.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git")) unsupported(`Unsafe or unsupported repository path: ${JSON.stringify(path)}`);
  return path;
}
function mode(value: string): RevisionFile["mode"] {
  if (value === "160000") unsupported("Submodules are not supported for exact capture. Their checkout and external inputs must be captured before verification.");
  if (value !== "100644" && value !== "100755" && value !== "120000") unsupported(`Unsupported file mode ${value}.`);
  return value as RevisionFile["mode"];
}

/** No inherited GIT_DIR/INDEX/OBJECT overrides or user diff programs. Source local
 * repository config is still read by Git, but plumbing reads never invoke filters.
 */
function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", LC_ALL: "C" };
}
function command(cli: string, cwd: string, args: string[], signal: AbortSignal, input?: Buffer, diff = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ["--no-pager", "-c", "core.fsmonitor=false", ...args], { cwd, env: gitEnv(), stdio: ["pipe", "pipe", "pipe"], signal });
    const output: Buffer[] = [], errors: Buffer[] = []; let bytes = 0, errorBytes = 0, overflow = false;
    child.stdout.on("data", (b: Buffer) => { bytes += b.length; if (bytes > (diff ? MAX_DIFF : MAX_BYTES)) { overflow = true; child.kill(); } else output.push(b); });
    child.stderr.on("data", (b: Buffer) => { errorBytes += b.length; if (errorBytes < 16_384) errors.push(b); });
    child.on("error", reject); child.stdin.on("error", () => {});
    child.on("close", code => {
      if (overflow) reject(new CaptureProblem("unsupported", "Capture output exceeds the supported size limit."));
      else if (code !== 0 && !(diff && code === 1)) reject(new Error(`Git ${args[0]} failed: ${Buffer.concat(errors).toString("utf8").trim() || `exit ${code}`}`));
      else resolve(Buffer.concat(output));
    });
    child.stdin.end(input);
  });
}
type GitEntry = { path: string; mode: RevisionFile["mode"]; oid: string };

export const WorkspaceRevisionsLive = Layer.effect(WorkspaceRevisions, Effect.gen(function* () {
  const database = resolve(yield* RegistryDatabasePath);
  const store = resolve((yield* RevisionStorePath) ?? join(dirname(database), `${basename(database)}.revisions`));
  const cli = yield* RevisionGitCommand;
  const lock = yield* Semaphore.make(1);

  async function capture(workspace: Workspace, signal: AbortSignal): Promise<WorkspaceCapture["result"]> {
    const cwd = await realpath(workspace.path);
    // Candidate writes must not be observed as source edits or recursively captured.
    await mkdir(store, { recursive: true, mode: 0o700 });
    const relativeStore = relative(cwd, await realpath(store));
    if (relativeStore !== ".." && !relativeStore.startsWith(`..${sep}`) && !isAbsolute(relativeStore)) unsupported("Revision storage must be outside the workspace. Set PIANO_REVISION_STORE to a private external directory.");
    const git = (...args: string[]) => command(cli, cwd, args, signal);
    const top = (await git("rev-parse", "--show-toplevel")).toString().trim();
    if (await realpath(top) !== cwd) unsupported("Capture requires the Git checkout root, not a project subdirectory.");
    const gitDir = (await git("rev-parse", "--absolute-git-dir")).toString().trim();
    let changes = 0, watchError: Error | undefined;
    const watchers: FSWatcher[] = [];
    let temporary: string | undefined;
    try {
      for (const path of new Set([cwd, gitDir])) {
        const watcher = watch(path, { recursive: true }, () => { changes++; });
        watcher.on("error", error => { watchError = error; }); watchers.push(watcher);
      }
      const head = (await git("rev-parse", "--verify", "HEAD")).toString().trim();
      const branchRef = (await git("rev-parse", "--abbrev-ref", "HEAD")).toString().trim();
      const branch = branchRef === "HEAD" ? null : branchRef;
      async function inventory() {
        const index = await git("ls-files", "--stage", "-z");
        const flags = await git("ls-files", "--debug", "-z");
        // Extended index flags: skip-worktree and intent-to-add have semantics not
        // represented by ordinary stage-0 blobs. Do not silently flatten them.
        if ([...flags.toString().matchAll(/\n {2}size: \d+\s+flags: ([0-9a-f]+)\n/g)].some(m => (parseInt(m[1], 16) & 0x60000000) !== 0)) unsupported("Sparse/skip-worktree and intent-to-add index entries are not supported for capture.");
        return { head: (await git("rev-parse", "--verify", "HEAD")).toString().trim(),
          branch: (await git("rev-parse", "--abbrev-ref", "HEAD")).toString().trim(),
          index, untracked: await git("ls-files", "--others", "--exclude-standard", "-z"),
          ignored: await git("ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z") };
      }
      const before = await inventory();
      const index: GitEntry[] = split(before.index).map(line => {
        const match = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(line);
        if (!match) throw new Error("Malformed Git index entry.");
        if (match[3] !== "0") unsupported("Unresolved index conflicts prevent capture. Resolve the conflicts and refresh.");
        return { mode: mode(match[1]), oid: match[2], path: safePath(match[4]) };
      });
      const base: GitEntry[] = split(await git("ls-tree", "-r", "-z", head)).map(line => {
        const match = /^(\d+) \w+ ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
        if (!match) throw new Error("Malformed Git tree entry.");
        return { mode: mode(match[1]), oid: match[2], path: safePath(match[3]) };
      });
      const paths = [...new Set([...index.map(e => e.path), ...split(before.untracked).map(safePath)])].sort();
      if (Math.max(paths.length, base.length, index.length) > MAX_PATHS) unsupported(`Capture supports at most ${MAX_PATHS} paths per tree.`);
      // Read Git blobs in one bounded process; mode/path never comes from filename parsing by a shell.
      const oids = [...new Set([...base, ...index].map(e => e.oid))];
      const batch = await command(cli, cwd, ["cat-file", "--batch"], signal, Buffer.from(oids.map(oid => `${oid}\n`).join("")));
      const blobs = new Map<string, Buffer>(); let position = 0, total = 0;
      for (const oid of oids) {
        const end = batch.indexOf(10, position), header = batch.subarray(position, end).toString();
        const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
        if (!match || match[1] !== oid) throw new Error("Missing or invalid Git blob during capture.");
        const size = Number(match[2]);
        if (size > MAX_FILE) unsupported("Capture supports files up to 8 MiB.");
        const data = batch.subarray(end + 1, end + 1 + size); position = end + size + 2;
        if (data.length !== size) throw new Error("Incomplete Git blob during capture.");
        total += size; blobs.set(oid, data);
      }
      const content = new Map<string, Buffer>();
      const entry = (path: string, mode: RevisionFile["mode"], data: Buffer): RevisionFile => {
        const sha256 = digest(data); content.set(sha256, data); return { path, mode, sha256, bytes: data.length };
      };
      const fromGit = (entries: GitEntry[]) => entries.map(e => entry(e.path, e.mode, blobs.get(e.oid)!)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      async function readWorking(): Promise<RevisionFile[]> {
        const entries: RevisionFile[] = [];
        let workingBytes = 0;
        for (const path of paths) {
          signal.throwIfAborted();
          const full = join(cwd, path);
          let stat: BigIntStats;
          try { stat = await lstat(full, { bigint: true }); }
          catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
          // A tracked file can become a directory containing new untracked files.
          if (stat.isDirectory()) continue;
          if (await realpath(dirname(full)) !== dirname(full)) unsupported(`Symlinked parent directory at ${path}; external contents are not captured.`);
          let data: Buffer, fileMode: RevisionFile["mode"];
          if (stat.isSymbolicLink()) { data = await readlink(full, { encoding: "buffer" }); fileMode = "120000"; }
          else if (stat.isFile()) {
            if (stat.size > BigInt(MAX_FILE)) unsupported(`File exceeds 8 MiB: ${path}`);
            const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
              const buffer = Buffer.alloc(Number(stat.size) + 1); let offset = 0;
              while (offset < buffer.length) {
                const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
                if (!bytesRead) break;
                offset += bytesRead;
              }
              if (offset !== Number(stat.size)) raced();
              data = buffer.subarray(0, offset);
            } finally { await file.close(); }
            fileMode = (stat.mode & 0o100n) !== 0n ? "100755" : "100644";
          } else unsupported(`Special file is not supported: ${path}`);
          const after = await lstat(full, { bigint: true });
          if (stat.ino !== after.ino || stat.size !== after.size || stat.mode !== after.mode || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs) raced();
          workingBytes += data!.length;
          if (workingBytes + total > MAX_BYTES) unsupported("Capture exceeds 64 MiB of content.");
          entries.push(entry(path, fileMode!, data!));
        }
        return entries;
      }
      const files = await readWorking();
      const manifest: RevisionManifest = { version: 1, baseHead: head,
        scope: { included: "All tracked paths and non-ignored untracked files (repository ignore rules, no global config); raw bytes, Git executable bit and symlinks.",
          excluded: ["Git administrative files", "Ignored untracked contents", "External inputs and dependencies", "Empty directories, timestamps and permission bits other than owner-executable"], ignored: split(before.ignored).sort() },
        base: fromGit(base), index: fromGit(index), files };
      const revision = `v1-${digest(JSON.stringify(manifest))}`;
      temporary = await mkdtemp(join(store, ".capture-"));
      async function materialize(root: string, entries: readonly RevisionFile[]) {
        await mkdir(root, { recursive: true });
        for (const e of entries) {
          const path = join(root, e.path); await mkdir(dirname(path), { recursive: true });
          if (e.mode === "120000") await symlink(content.get(e.sha256)!, path);
          else await writeFile(path, content.get(e.sha256)!, { mode: e.mode === "100755" ? 0o755 : 0o644, flag: "wx" });
        }
      }
      // Compare only materialized captured bytes. Diff never reads the live source.
      async function diff(left: readonly RevisionFile[], right: readonly RevisionFile[]) {
        const dir = await mkdtemp(join(temporary!, "diff-"));
        try {
          await materialize(join(dir, "a"), left); await materialize(join(dir, "b"), right);
          return (await command(cli, dir, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=", "--dst-prefix=", "--", "a", "b"], signal, undefined, true)).toString("utf8");
        } finally { await rm(dir, { recursive: true, force: true }); }
      }
      const workingDiff = await diff(manifest.base, files), stagedDiff = await diff(manifest.base, manifest.index), unstagedDiff = await diff(manifest.index, files);
      // A second content scan and inventory catch missed/coalesced metadata changes;
      // the watch also rejects ABA/transient edits. Not an adversarial FS snapshot.
      if (JSON.stringify(files) !== JSON.stringify(await readWorking())) raced();
      const after = await inventory();
      if (head !== before.head || branchRef !== before.branch || JSON.stringify(before) !== JSON.stringify(after) || await realpath(workspace.path) !== cwd) raced();
      await new Promise<void>(r => setImmediate(r));
      if (watchError) throw watchError;
      if (changes) raced();
      // Freeze the source boundary now; later live edits cannot alter these bytes.
      for (const watcher of watchers) watcher.close();
      await mkdir(join(temporary, "blobs"));
      for (const [hash, bytes] of content) await writeFile(join(temporary, "blobs", hash), bytes, { mode: 0o400 });
      const limitations = ["Ignored/generated dependencies and external configuration are excluded from this capture."];
      if (files.some(e => e.mode === "120000")) limitations.push("Symlinks are captured as link bytes, not referent contents.");
      const result: Extract<WorkspaceCapture["result"], { status: "captured" }> = { status: "captured", revision, physicalPath: cwd, branch, manifest, diff: workingDiff, stagedDiff, unstagedDiff, limitations };
      // Revision records are content-only. Workspace/observation identity stays on the caller's receipt.
      await writeFile(join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o400 });
      await writeFile(join(temporary, "diff.json"), JSON.stringify({ diff: workingDiff, stagedDiff, unstagedDiff }), { mode: 0o400 });
      try { await rename(temporary, join(store, revision)); }
      catch (e) { if (!["ENOTEMPTY", "EEXIST"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
        // Never trust an existing record after external alteration.
        if (!Buffer.from(JSON.stringify(manifest, null, 2)).equals(await readFile(join(store, revision, "manifest.json")))) throw new Error("Stored revision is damaged; restore or remove that candidate before recapturing.");
        for (const [hash, bytes] of content) if (!bytes.equals(await readFile(join(store, revision, "blobs", hash)))) throw new Error("Stored candidate blob is damaged.");
        // Records written before the combined diff existed lack `diff`; their other diffs must still match.
        const stored = JSON.parse(await readFile(join(store, revision, "diff.json"), "utf8")) as Partial<Record<"diff" | "stagedDiff" | "unstagedDiff", string>>;
        if (stored.stagedDiff !== stagedDiff || stored.unstagedDiff !== unstagedDiff || (stored.diff !== undefined && stored.diff !== workingDiff)) throw new Error("Stored candidate diff is damaged.");
      }
      return result;
    } finally {
      for (const watcher of watchers) watcher.close();
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
  return WorkspaceRevisions.of({ capture: workspace => Semaphore.withPermits(lock, 1)(Effect.tryPromise({
    try: signal => capture(workspace, AbortSignal.any([signal, AbortSignal.timeout(30_000)])),
    catch: e => e,
  }).pipe(Effect.catch(e => Effect.succeed<WorkspaceCapture["result"]>({ status: e instanceof CaptureProblem ? e.status : "error", detail: e instanceof Error ? e.message : String(e) })),
    Effect.map(result => ({ workspace, observedAt: new Date().toISOString(), result })))) });
}));
