import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Effect, Layer } from "effect";
import type { CheckDefinition, CheckEvidence, CheckExecution } from "../shared/wire.ts";
import { CheckConfigPath, CheckSandboxCommand, EvidenceStorePath, WorkspaceChecks, WorkspaceChecksLive } from "../server/WorkspaceChecks.ts";
import { RevisionStorePath, WorkspaceRevisionsLive } from "../server/WorkspaceRevisions.ts";

function fixture(t: TestContext) {
  const previous = process.env.PIANO_TEST_SECRET;
  process.env.PIANO_TEST_SECRET = "must-not-be-inherited-by-the-check";
  t.after(() => { if (previous === undefined) delete process.env.PIANO_TEST_SECRET; else process.env.PIANO_TEST_SECRET = previous; });
  const root = mkdtempSync(join(tmpdir(), "piano-checks-")), repo = join(root, "repo"), store = join(root, "evidence"), config = join(root, "checks.json"), candidates = join(root, "candidates");
  mkdirSync(repo); execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "source.txt"), "good\n"); writeFileSync(join(repo, ".gitignore"), "ignored/\n");
  mkdirSync(join(repo, "ignored")); writeFileSync(join(repo, "ignored", "dependency"), "must not read this");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = { id: "root-workspace", project: repo, path: repo };
  let policy: CheckDefinition = { id: "source-check", name: "Source contract", version: "1", timeoutMs: 10_000,
    task: { id: "TASK-8", source: "human:phase8", version: "1", content: "Retain a good source file" },
    criterion: { id: "AC-1", version: "1", content: "source.txt contains good" },
    script: `import assert from 'node:assert/strict'; import {readFileSync,writeFileSync,existsSync} from 'node:fs';
assert.equal(readFileSync('source.txt','utf8'),'good\\n');
assert.equal(existsSync('ignored/dependency'),false);
assert.equal(existsSync(${JSON.stringify(repo)}),false);
assert.equal(process.env.PIANO_TEST_SECRET,undefined);
assert.throws(()=>writeFileSync('source.txt','mutation'), /EROFS/);
console.log('CHECK_OK'); console.log('sk-'+'redaction-canary-123456');`,
  };
  const configure = (update: Partial<CheckDefinition> = {}) => { policy = { ...policy, ...update }; writeFileSync(config, JSON.stringify({ version: 1, projects: [{ project: repo, check: policy }] })); };
  configure();
  const run = <A, E>(e: Effect.Effect<A, E, WorkspaceChecks>, sandbox = "/usr/bin/bwrap") => Effect.runPromise(e.pipe(
    Effect.provide(WorkspaceChecksLive.pipe(Layer.provide(WorkspaceRevisionsLive))), Effect.provideService(CheckConfigPath, config),
    Effect.provideService(EvidenceStorePath, store), Effect.provideService(RevisionStorePath, candidates), Effect.provideService(CheckSandboxCommand, sandbox)));
  return { root, repo, store, config, candidates, workspace, run, configure, policy };
}
const finished = (checks: WorkspaceChecks["Service"], workspace: Parameters<WorkspaceChecks["Service"]["view"]>[0], id: string) => Effect.gen(function* () {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const view = yield* checks.view(workspace), found = view.executions.find(e => e.execution.id === id);
    if (found && found.execution.outcome !== "running") return found;
    yield* Effect.yieldNow;
  }
  throw new Error("Check completion deadline exceeded");
});

test("INV-01/07–09/13: isolated check, persisted output, bounded criterion and conservative input/policy currency", { timeout: 60000 }, async t => {
  const f = fixture(t); let saved: CheckExecution;
  await f.run(Effect.gen(function* () {
    const checks = yield* WorkspaceChecks;
    const starts = yield* Effect.all([checks.start(f.workspace), checks.start(f.workspace)], { concurrency: "unbounded" });
    assert.equal(starts[0].id, starts[1].id, "two callers share one active check"); saved = starts[0];
    // The source changes after capture, before/during isolated execution. It cannot
    // change what the check reads; even a write from inside the command is EROFS.
    writeFileSync(join(f.repo, "source.txt"), "live changed\n");
    const result = yield* finished(checks, f.workspace, saved.id);
    assert.equal(result.execution.outcome, "pass", JSON.stringify(result)); assert.equal(result.validity, "stale"); assert.equal(result.evaluation, "unknown");
    assert.match(result.output!, /CHECK_OK/); assert.match(result.output!, /\[REDACTED\]/); assert.doesNotMatch(result.output!, /redaction-canary/);
    assert.equal(result.execution.workspace.id, f.workspace.id); assert.ok(result.execution.environment?.runtimeDigest);
    writeFileSync(join(f.repo, "source.txt"), "good\n");
    const restored = (yield* checks.view(f.workspace)).executions[0]; assert.equal(restored.validity, "current"); assert.equal(restored.evaluation, "satisfied");
  }));
  await f.run(Effect.gen(function* () {
    const checks = yield* WorkspaceChecks, reopened = yield* checks.view(f.workspace);
    assert.equal(reopened.executions.length, 1); assert.equal(reopened.executions[0].execution.id, saved.id);
    assert.equal(reopened.executions[0].evaluation, "satisfied"); assert.match(reopened.executions[0].output!, /CHECK_OK/);
    f.configure({ criterion: { ...f.policy.criterion, version: "2", content: "A new requirement" } });
    let historical = (yield* checks.view(f.workspace)).executions[0]; assert.equal(historical.validity, "stale"); assert.match(historical.reason, /configuration changed/);
    f.configure({ criterion: f.policy.criterion, script: `${f.policy.script}\n// approved policy change` });
    historical = (yield* checks.view(f.workspace)).executions[0]; assert.equal(historical.validity, "stale");
    f.configure({ script: f.policy.script });
    writeFileSync(join(f.repo, "source.txt"), "bad\n");
    const failed = yield* finished(checks, f.workspace, (yield* checks.start(f.workspace)).id);
    assert.equal(failed.execution.outcome, "fail"); assert.equal(failed.validity, "current"); assert.equal(failed.evaluation, "not-satisfied");
    assert.match(failed.output!, /AssertionError/);
    writeFileSync(join(f.repo, "source.txt"), "good\n");
    rmSync(join(f.store, `${saved.id}.output.txt`));
    const missing = (yield* checks.view(f.workspace)).executions.find(e => e.execution.id === saved.id)!;
    assert.equal(missing.execution.outcome, "pass"); assert.equal(missing.validity, "unknown"); assert.equal(missing.evaluation, "unknown"); assert.equal(missing.output, null);
    assert.deepEqual(readdirSync(f.store).filter(n => n.startsWith(".run-")), []);
  }));
});

test("INV-09: cancellation, deadline, excessive output and unavailable isolation never satisfy a criterion", { timeout: 60000 }, async t => {
  const f = fixture(t);
  await f.run(Effect.gen(function* () {
    const checks = yield* WorkspaceChecks;
    f.configure({ script: "await new Promise(() => { setInterval(() => {}, 1000); });" });
    const started = yield* checks.start(f.workspace);
    // Wait for persisted environment, not an arbitrary delay. The cancellation
    // contract includes preparation/spawn and a running process equally.
    while (!(yield* checks.view(f.workspace)).executions[0].execution.environment) yield* Effect.yieldNow;
    yield* checks.cancel(f.workspace, started.id);
    let result = yield* finished(checks, f.workspace, started.id);
    assert.equal(result.execution.outcome, "cancelled"); assert.equal(result.evaluation, "unknown");
    f.configure({ timeoutMs: 100 });
    result = yield* finished(checks, f.workspace, (yield* checks.start(f.workspace)).id);
    assert.equal(result.execution.outcome, "error"); assert.match(result.execution.detail, /deadline/); assert.equal(result.evaluation, "unknown");
    f.configure({ timeoutMs: 10000, script: "console.log('x'.repeat(300000));" });
    result = yield* finished(checks, f.workspace, (yield* checks.start(f.workspace)).id);
    assert.equal(result.execution.outcome, "error"); assert.match(result.execution.detail, /incomplete/); assert.ok(result.output!.length <= 256 * 1024); assert.equal(result.evaluation, "unknown");
  }));
  await f.run(Effect.gen(function* () {
    const checks = yield* WorkspaceChecks;
    const result = yield* finished(checks, f.workspace, (yield* checks.start(f.workspace)).id);
    assert.equal(result.execution.outcome, "error"); assert.equal(result.evaluation, "unknown");
  }), join(f.root, "missing-bwrap"));
});

test("INV-08/09: unsupported shared inputs and corrupt captures fail closed; interrupted records are not replayed", { timeout: 60000 }, async t => {
  const f = fixture(t); let last: CheckEvidence;
  await f.run(Effect.gen(function* () {
    const checks = yield* WorkspaceChecks;
    symlinkSync("source.txt", join(f.repo, "link"));
    last = yield* finished(checks, f.workspace, (yield* checks.start(f.workspace)).id);
    assert.equal(last.execution.outcome, "error"); assert.match(last.execution.detail, /symlinks/); assert.equal(last.evaluation, "unknown");
    rmSync(join(f.repo, "link"));
    last = yield* finished(checks, f.workspace, (yield* checks.start(f.workspace)).id);
    assert.equal(last.execution.outcome, "pass");
    const dir = join(f.candidates, last.execution.revision), manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const blob = join(dir, "blobs", manifest.files.find((e: {path: string}) => e.path === "source.txt").sha256);
    chmodSync(blob, 0o600); writeFileSync(blob, "corrupt");
    const failed = yield* checks.start(f.workspace).pipe(Effect.flip); assert.match(failed.message, /damaged/);
    writeFileSync(blob, "good\n"); chmodSync(blob, 0o400);
  }));
  // Durable restart reconciliation uses a real previously observed record with
  // the pre-completion state restored. Browser gate separately kills the backend.
  const record = { ...last!.execution, outcome: "running", endedAt: null, artifact: null };
  writeFileSync(join(f.store, `${record.id}.json`), JSON.stringify(record));
  await f.run(Effect.gen(function* () {
    const checks = yield* WorkspaceChecks, view = yield* checks.view(f.workspace);
    const recovered = view.executions.find(e => e.execution.id === record.id)!;
    assert.equal(view.executions.length, 2); assert.equal(recovered.execution.outcome, "unknown"); assert.equal(recovered.evaluation, "unknown"); assert.match(recovered.reason, /not resumed/);
    writeFileSync(f.config, "broken");
    const invalid = yield* checks.view(f.workspace); assert.ok(invalid.configurationError); assert.equal(invalid.executions.every(e => e.evaluation === "unknown"), true);
    f.configure(); const projectPolicy = join(f.repo, "policy.json");
    writeFileSync(projectPolicy, readFileSync(f.config)); rmSync(f.config); symlinkSync(projectPolicy, f.config);
    assert.match((yield* checks.start(f.workspace).pipe(Effect.flip)).message, /outside the project and workspace/);
  }));
});
