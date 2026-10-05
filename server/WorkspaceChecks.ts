/** One operator-owned Node check over isolated captured inputs. Owns jobs, persistence,
 * artifacts and evidence evaluation; browsers never own execution (INV-01/07–09/13).
 * Linux/bubblewrap is deliberately required: no mutable-checkout fallback.
 */
import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { arch, release } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import { CheckDefinition, CheckExecution, type CheckEnvironment, type CheckEvidence, type Workspace, type WorkspaceChecksView } from "../shared/wire.ts";
import { redactDisplay } from "./DisplayProjection.ts";
import { RegistryPath } from "./Registry.ts";
import { WorkspaceRevisions } from "./WorkspaceRevisions.ts";

export const CheckConfigPath = Context.Reference<string | undefined>("piano/CheckConfigPath", { defaultValue: () => process.env.PIANO_CHECK_CONFIG });
export const EvidenceStorePath = Context.Reference<string | undefined>("piano/EvidenceStorePath", { defaultValue: () => process.env.PIANO_EVIDENCE_STORE });
export const CheckSandboxCommand = Context.Reference<string>("piano/CheckSandboxCommand", { defaultValue: () => process.env.PIANO_BWRAP ?? "/usr/bin/bwrap" });
export class WorkspaceChecks extends Context.Service<WorkspaceChecks, {
  /** One active run per workspace; concurrent requests return the same execution. No queue/replay. */
  readonly start: (workspace: Workspace) => Effect.Effect<CheckExecution, Error>;
  readonly cancel: (workspace: Workspace, id: string) => Effect.Effect<void, Error>;
  /** Fresh content/policy/environment and artifact evaluation, independent of historical exit. */
  readonly view: (workspace: Workspace) => Effect.Effect<WorkspaceChecksView, Error>;
}>()("piano/WorkspaceChecks") {}

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const error = (e: unknown) => e instanceof Error ? e : new Error(String(e));
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: error });
const execute = promisify(execFile);
const MAX_OUTPUT = 256 * 1024, MAX_RECORD = 128 * 1024, MAX_RUNS = 100;
const vars = { PATH: "/runtime", HOME: "/tmp", LANG: "C", TZ: "UTC" };
const Config = Schema.Struct({ version: Schema.Literal(1), projects: Schema.Array(Schema.Struct({ project: Schema.String, check: CheckDefinition })) });

/** No-follow, bounded reads with a mutation check; always hash the bytes actually copied. */
async function bytes(path: string, limit: number, atomicRecord = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) throw new Error(`Unsupported or oversized input: ${path}`);
    const buffer = Buffer.alloc(Number(before.size) + 1); let offset = 0;
    while (offset < buffer.length) { const r = await file.read(buffer, offset, buffer.length - offset, offset); if (!r.bytesRead) break; offset += r.bytesRead; }
    const after = await file.stat({ bigint: true });
    // Atomic replacement can unlink our still-open old record, changing ctime
    // without changing its contents. That complete older observation is valid.
    const replaced = atomicRecord && before.nlink === 1n && after.nlink === 0n;
    if (offset !== Number(before.size) || (!replaced && before.ctimeNs !== after.ctimeNs) || before.mtimeNs !== after.mtimeNs) throw new Error(`Input changed while reading: ${path}`);
    return buffer.subarray(0, offset);
  } finally { await file.close(); }
}
async function atomic(path: string, content: string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
    const parent = await open(dirname(path), "r"); try { await parent.sync(); } finally { await parent.close(); }
  } finally { await rm(temp, { force: true }); }
}
async function outside(workspace: Workspace, paths: string[]) {
  const roots = await Promise.all([...new Set([workspace.path, workspace.project])].map(path => realpath(path)));
  for (const path of paths) {
    const actual = await realpath(path);
    for (const root of roots) {
      const rel = relative(root, actual);
      if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error("Check policy and evidence storage must be outside the project and workspace; no project file can redefine its own gate.");
    }
  }
}

export const WorkspaceChecksLive = Layer.effect(WorkspaceChecks, Effect.gen(function* () {
  const registry = yield* RegistryPath, revisions = yield* WorkspaceRevisions;
  const configuredPath = yield* CheckConfigPath;
  const config = resolve(configuredPath ?? join(dirname(registry), "checks.json"));
  const configPaths = configuredPath === undefined ? [config, resolve(`${registry}.checks.json`)] : [config];
  const store = resolve((yield* EvidenceStorePath) ?? `${registry}.evidence`);
  const sandbox = yield* CheckSandboxCommand;
  const lock = yield* Semaphore.make(1);
  type Job = { record: CheckExecution; abort: AbortController; done: Promise<void> };
  const active = new Map<string, Job>();
  let storageError: Error | undefined, closing = false;
  const recordPath = (id: string) => join(store, `${id}.json`);
  const outputPath = (id: string) => join(store, `${id}.output.txt`);
  const save = (record: CheckExecution) => atomic(recordPath(record.id), JSON.stringify(record));
  const files = async () => (await readdir(store)).filter(f => /^[a-f0-9-]{36}\.json$/.test(f));
  async function records() {
    const names = await files();
    if (names.length > 1000) throw new Error("Evidence store exceeds 1000 records. Archive it explicitly before continuing.");
    return Promise.all(names.map(async name => {
      const record = Schema.decodeUnknownSync(CheckExecution)(JSON.parse((await bytes(join(store, name), MAX_RECORD, true)).toString()));
      if (`${record.id}.json` !== name || !/^v1-[a-f0-9]{64}$/.test(record.revision) || record.definitionDigest !== hash(JSON.stringify(record.definition)) || (record.outcome === "pass" && (record.exitCode !== 0 || !record.environment || !record.endedAt))) throw new Error("Evidence identity or provenance does not match its record. Restore the damaged store.");
      return record;
    }));
  }
  yield* attempt(async () => {
    await mkdir(store, { recursive: true, mode: 0o700 });
    // Never adopt a saved PID or retry interrupted work. bubblewrap's parent-death
    // and private PID namespace terminate the command on backend loss.
    for (const record of await records()) if (record.outcome === "running") await save({ ...record, outcome: "unknown", endedAt: new Date().toISOString(), detail: "Backend interrupted this execution; it was not resumed. Run a new check." });
    for (const name of await readdir(store)) if (name.startsWith(".run-")) await rm(join(store, name), { recursive: true, force: true });
  });
  async function definition(workspace: Workspace) {
    let path = config;
    // Prefer checks.json. Only absence permits the legacy filename; a malformed,
    // unreadable or project-owned policy must never select a different gate.
    for (const candidate of configPaths) {
      try { await lstat(candidate); path = candidate; break; }
      catch (e) { if ((error(e) as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    await outside(workspace, [store, path]);
    const all = Schema.decodeUnknownSync(Config)(JSON.parse((await bytes(path, 64 * 1024)).toString()));
    if (new Set(all.projects.map(p => p.project)).size !== all.projects.length) throw new Error("Duplicate projects in check configuration.");
    const check = all.projects.find(p => p.project === workspace.project)?.check;
    if (!check) throw new Error(`No check configured for this project. Configure ${config} outside the checkout.`);
    if (![check.id, check.name, check.version, check.script, check.task.id, check.task.source, check.task.version, check.task.content, check.criterion.id, check.criterion.version, check.criterion.content].every(s => s.trim()) || !Number.isInteger(check.timeoutMs) || check.timeoutMs < 100 || check.timeoutMs > 300_000) throw new Error("Check fields must be nonempty; timeoutMs must be an integer from 100 to 300000.");
    return { check, digest: hash(JSON.stringify(check)) };
  }
  /** Copy only Node and its resolved loader/libraries, not /usr, HOME, node_modules
   * or the live checkout. The full content list, kernel and sandbox bind provenance.
   */
  async function environment(root?: string): Promise<CheckEnvironment> {
    if (process.platform !== "linux") throw new Error("Captured checks currently require Linux and bubblewrap 0.9.0.");
    const node = await realpath(process.execPath);
    const options = { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 10_000, maxBuffer: 1024 * 1024 };
    const version = (await execute(sandbox, ["--version"], options)).stdout.trim();
    if (version !== "bubblewrap 0.9.0") throw new Error(`Unsupported isolation runtime: ${version}. Expected bubblewrap 0.9.0.`);
    const linked = (await execute("/usr/bin/ldd", [node], options)).stdout;
    if (linked.includes("not found")) throw new Error("Node runtime dependency is missing.");
    const libs = [...new Set([...linked.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)].map(m => m[1]))].sort();
    if (!libs.length || libs.length > 32 || libs.some(p => !p.startsWith("/lib"))) throw new Error("Unsupported Node runtime dependency layout.");
    const entries: { path: string; sha256: string }[] = []; let total = 0;
    for (const [source, path] of [[node, "/runtime/node"], ...libs.map(p => [p, p])]) {
      const content = await bytes(await realpath(source), 160 * 1024 * 1024);
      total += content.length;
      if (total > 256 * 1024 * 1024) throw new Error("Copied runtime exceeds 256 MiB.");
      entries.push({ path, sha256: hash(content) });
      if (root) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, { flag: "wx", mode: 0o500 }); }
    }
    return { policy: "node-snapshot-v1", node: process.version, platform: process.platform, arch: arch(), kernel: release(),
      runtimeDigest: hash(JSON.stringify(entries)), isolation: `${version}:${hash(await bytes(await realpath(sandbox), 4 * 1024 * 1024))}`,
      variables: Object.entries(vars).map(([name, value]) => ({ name, value })) };
  }
  async function run(job: Job) {
    let temporary: string | undefined, output = Buffer.alloc(0), ready = false, overflow = false;
    try {
      temporary = await mkdtemp(join(store, ".run-"));
      const root = join(temporary, "root"); await mkdir(root);
      await Effect.runPromise(revisions.materialize(job.record.revision, join(root, "workspace")));
      const env = await environment(root);
      const marker = `PIANO_CHECK_READY:${job.record.id}\n`;
      await writeFile(join(root, "policy.mjs"), job.record.definition.script, { mode: 0o400 });
      await writeFile(join(root, "check.mjs"), `if (process.version !== ${JSON.stringify(env.node)}) throw new Error('Node changed on disk; restart the backend before checking.'); process.stdout.write(${JSON.stringify(marker)}); await import('./policy.mjs');\n`, { mode: 0o400 });
      for (const name of ["tmp", "proc", "dev"]) await mkdir(join(root, name));
      job.record = { ...job.record, environment: env }; await save(job.record);
      job.abort.signal.throwIfAborted();
      const result = await new Promise<{ code: number | null; signal: string | null; timedOut: boolean }>((accept, reject) => {
        let timedOut = false, first = Buffer.alloc(0);
        const child = spawn(sandbox, ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--ro-bind", root, "/",
          "--size", "67108864", "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--chdir", "/workspace", "/runtime/node", "/check.mjs"],
        { env: vars, detached: true, stdio: ["ignore", "pipe", "pipe"] });
        const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } } };
        const timer = setTimeout(() => { timedOut = true; kill(); }, job.record.definition.timeoutMs);
        job.abort.signal.addEventListener("abort", kill, { once: true });
        if (job.abort.signal.aborted) kill();
        const append = (data: Buffer) => {
          if (output.length + data.length > MAX_OUTPUT) { overflow = true; output = Buffer.concat([output, data]).subarray(0, MAX_OUTPUT); kill(); }
          else output = Buffer.concat([output, data]);
        };
        child.stdout.on("data", (data: Buffer) => {
          if (ready) { append(data); return; }
          first = Buffer.concat([first, data]);
          if (first.length >= Buffer.byteLength(marker)) {
            if (!first.subarray(0, Buffer.byteLength(marker)).equals(Buffer.from(marker))) { append(first); first = Buffer.alloc(0); kill(); }
            else { ready = true; append(first.subarray(Buffer.byteLength(marker))); first = Buffer.alloc(0); }
          }
        });
        child.stderr.on("data", append);
        child.once("error", reject);
        child.once("close", (code, signal) => { clearTimeout(timer); job.abort.signal.removeEventListener("abort", kill); if (first.length) append(first); accept({ code, signal, timedOut }); });
      });
      const outcome = job.abort.signal.aborted ? "cancelled" : result.timedOut || overflow || !ready || result.signal ? "error" : result.code === 0 ? "pass" : "fail";
      job.record = { ...job.record, outcome, exitCode: result.code, signal: result.signal,
        detail: job.abort.signal.aborted ? "Check cancelled." : result.timedOut ? "Check exceeded its configured deadline." : overflow ? "Output exceeded 256 KiB; execution stopped, output is incomplete." : !ready ? "The isolated Node command could not start." : result.signal ? `Check terminated by ${result.signal}.` : result.code === 0 ? "Configured check passed." : `Configured check exited ${result.code}.` };
    } catch (e) {
      job.record = { ...job.record, outcome: job.abort.signal.aborted ? "cancelled" : "error", detail: job.abort.signal.aborted ? "Check cancelled." : error(e).message };
    } finally {
      try {
        // Redact the whole bounded output at once, including split-chunk secrets.
        const text = redactDisplay(output.toString("utf8"));
        await atomic(outputPath(job.record.id), text);
        job.record = { ...job.record, endedAt: new Date().toISOString(), artifact: { name: "output.txt", sha256: hash(text), bytes: Buffer.byteLength(text) } };
        await save(job.record);
      } catch (e) { storageError = error(e); }
      try { if (temporary) await rm(temporary, { recursive: true, force: true }); } catch (e) { storageError = error(e); }
      active.delete(job.record.workspace.id);
    }
  }
  async function start(workspace: Workspace) {
    if (closing) throw new Error("Backend is shutting down.");
    if (storageError) throw storageError;
    const existing = active.get(workspace.id); if (existing) return existing.record;
    if (active.size >= 2) throw new Error("Two checks are already running. Wait or cancel one before starting another.");
    const { check, digest } = await definition(workspace);
    const history = await records();
    if (history.filter(r => r.workspace.id === workspace.id).length >= MAX_RUNS || history.length >= 1000) throw new Error("Evidence retention limit reached. Archive retained records and artifacts explicitly; nothing was deleted.");
    const capture = await Effect.runPromise(revisions.capture(workspace));
    if (capture.result.status !== "captured") throw new Error(`Cannot run check: ${capture.result.detail}`);
    const record: CheckExecution = { version: 1, id: randomUUID(), workspace, revision: capture.result.revision, definition: check, definitionDigest: digest,
      environment: null, command: ["/runtime/node", "/check.mjs"], cwd: "/workspace", startedAt: new Date().toISOString(), endedAt: null,
      exitCode: null, signal: null, outcome: "running", detail: "Preparing captured inputs.", artifact: null };
    await save(record);
    const job: Job = { record, abort: new AbortController(), done: Promise.resolve() };
    active.set(workspace.id, job); job.done = run(job);
    return record;
  }
  async function view(workspace: Workspace): Promise<WorkspaceChecksView> {
    if (storageError) throw storageError;
    let configured: Awaited<ReturnType<typeof definition>> | undefined, configurationError: string | null = null;
    try { configured = await definition(workspace); } catch (e) { configurationError = (error(e) as NodeJS.ErrnoException).code === "ENOENT" ? `No check configured. Create ${config}; see docs/checks.md.` : error(e).message; }
    const history = (await records()).filter(r => r.workspace.id === workspace.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    let revision: string | null = null, env: CheckEnvironment | undefined, observationError: string | null = null;
    if (history.length) {
      const capture = await Effect.runPromise(revisions.capture(workspace));
      if (capture.result.status === "captured") revision = capture.result.revision; else observationError = capture.result.detail;
      try { env = await environment(); } catch (e) { observationError = [observationError, error(e).message].filter(Boolean).join(" "); }
    }
    const executions: CheckEvidence[] = [];
    for (const execution of history) {
      let output: string | null = null, artifactError: string | undefined;
      try {
        if (!execution.artifact) throw new Error("No completed output artifact.");
        const content = await bytes(outputPath(execution.id), MAX_OUTPUT * 4);
        if (hash(content) !== execution.artifact.sha256 || content.length !== execution.artifact.bytes) throw new Error("Output artifact is damaged.");
        output = content.toString();
      } catch (e) { artifactError = `Output unavailable: ${error(e).message}`; }
      let validity: CheckEvidence["validity"] = "unknown", reason = "Execution is incomplete or its inputs cannot be established.";
      if (execution.outcome === "running") reason = "Check is running; no criterion conclusion yet.";
      else if (execution.outcome !== "pass" && execution.outcome !== "fail") reason = execution.detail;
      else if (artifactError) reason = artifactError;
      else if (!configured || !revision || !env || !execution.environment) reason = configurationError ?? observationError ?? execution.detail;
      else if (execution.revision !== revision) { validity = "stale"; reason = "Workspace content changed."; }
      else if (execution.definitionDigest !== configured.digest) { validity = "stale"; reason = "Check, requirement or policy configuration changed."; }
      else if (JSON.stringify(execution.environment) !== JSON.stringify(env)) { validity = "stale"; reason = "Execution environment changed."; }
      else if (execution.outcome === "pass" || execution.outcome === "fail") { validity = "current"; reason = "Matches the observed revision, requirement, check and environment."; }
      else reason = execution.detail;
      executions.push({ execution, validity, reason, evaluation: validity !== "current" ? "unknown" : execution.outcome === "pass" ? "satisfied" : "not-satisfied", output });
    }
    return { workspace, observedAt: new Date().toISOString(), revision, definition: configured?.check ?? null, configurationError, observationError, executions };
  }
  yield* Effect.addFinalizer(() => Effect.sync(() => { closing = true; }).pipe(Effect.andThen(
    Semaphore.withPermits(lock, 1)(attempt(async () => {
      const jobs = [...active.values()]; for (const job of jobs) job.abort.abort();
      await Promise.all(jobs.map(job => job.done));
    })),
  ), Effect.orDie));
  return WorkspaceChecks.of({
    start: workspace => Semaphore.withPermits(lock, 1)(attempt(() => start(workspace))).pipe(Effect.uninterruptible),
    cancel: (workspace, id) => attempt(async () => { const job = active.get(workspace.id); if (!job || job.record.id !== id || job.record.outcome !== "running") throw new Error("This check is no longer running in this workspace. Refresh its evidence."); job.abort.abort(); await job.done; if (storageError) throw storageError; }),
    view: workspace => attempt(() => view(workspace)),
  });
}));
