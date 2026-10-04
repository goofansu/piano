/** Real locked-CLI checkpoint through PiSessions, no paid model calls.
 * Run: node test/phase0-checkpoint.ts /tmp/piano-phase0-evidence/runtime
 * Exit 0: all observed contracts pass; 2: known compatibility gaps; 1: unexpected check/fixture failure.
 * This is deliberately separate from npm test: known incompatibility must not become a passing assertion.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Deferred, Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { NodeServices } from "@effect/platform-node";
import type { SessionEvent } from "../shared/wire.ts";
import { PiCli, type PiCliConfig } from "../server/PiCli.ts";
import { PiRequestTimeoutMs, PiSessions, PiSessionsLive, type PiSession } from "../server/PiSessions.ts";
import { createPiCompatibilityFixture, sentinelTool } from "./fixtures/PiCompatibility.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-phase0-evidence/runtime");
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
const layer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));
const packets: Array<{ label: string; events: ReadonlyArray<SessionEvent> }> = [];
const checks: Array<{ name: string; outcome: "pass" | "fail" | "blocked"; detail: unknown; followUp?: string }> = [];
let unexpectedFailure = false;
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions | Scope.Scope>, cli: PiCliConfig = fixture.cli()) => Effect.runPromise(effect.pipe(
  Effect.timeout("20 seconds"), Effect.scoped, Effect.provide(layer), Effect.provideService(PiCli, cli),
));
async function check(name: string, observe: () => Promise<unknown>) {
  try { checks.push({ name, outcome: "pass", detail: await observe() }); }
  catch (error) {
    unexpectedFailure = true;
    checks.push({ name, outcome: "fail", detail: String(error) });
  }
  console.log(JSON.stringify(checks[checks.length - 1]));
}
const watch = (session: PiSession, label: string, until: (event: SessionEvent) => boolean) => Effect.gen(function* () {
  const ready = yield* Deferred.make<void>();
  const collected = yield* session.events.pipe(
    Stream.tap(event => event._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void),
    Stream.takeUntil(until), Stream.runCollect,
    Effect.tap(events => Effect.sync(() => { packets.push({ label, events: [...events] }); })), Effect.forkChild,
  );
  yield* Deferred.await(ready);
  return collected;
});
const notice = (session: PiSession, text: string, includes: string) => Effect.gen(function* () {
  const collected = yield* watch(session, text, event => event._tag === "notice" && event.message.startsWith(includes));
  yield* session.act({ _tag: "prompt", text });
  const events = yield* Fiber.join(collected);
  const event = events.find(event => event._tag === "notice" && event.message.startsWith(includes));
  assert.ok(event?._tag === "notice");
  return event.message;
});
interface Facts { cwd: string; trusted: boolean; model: string; effort: string; tools: string[]; commands: string[]; cacheWarming: string }
const facts = (session: PiSession) => notice(session, "/phase0-facts", "PHASE0_FACTS ").pipe(
  Effect.map(message => JSON.parse(message.slice("PHASE0_FACTS ".length)) as Facts),
);
const connecting = (status: string, observed: Facts) => {
  assert.match(status, /^piano-sentinel: connected, 1 tools \(direct\)$/m);
  assert.ok(observed.tools.includes(sentinelTool), "Pi must register the sentinel tool; a disabled/broken global server cannot pass the control");
};
const control = fixture.project("connecting-control", false);
const overridden = fixture.project("project-override", true);
const untrusted = fixture.project("untrusted-project", true);
const startup = fixture.project("startup-dialog", true);
try {
  await check("effective locked CLI", async () => {
    const result = spawnSync(process.execPath, [fixture.installedCli, "--version"], { encoding: "utf8" });
    assert.equal(result.status, 0); assert.equal(result.stdout.trim(), "1.0.2");
    return { version: result.stdout.trim(), cli: fixture.installedCli, node: process.version, override: fixture.cli() };
  });
  for (const [name, cwd, trust, enabled] of [
    ["connecting control", control, "approved", true],
    ["trusted project override", overridden, "approved", false],
    ["headless untrusted control", untrusted, "untrusted", true],
  ] as const) {
    await check(name, () => run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd, sessionId: `phase0-${trust}-${enabled}` });
      const status = yield* notice(session, "/mcp", "piano-sentinel:");
      const observed = yield* facts(session);
      assert.equal(observed.cwd, cwd);
      assert.equal(observed.trusted, trust === "approved");
      assert.equal(observed.model, trust === "approved" ? "piano-phase0/project" : "piano-phase0/global");
      assert.equal(observed.effort, trust === "approved" ? "high" : "low");
      assert.equal(observed.tools.includes("phase0_project_marker"), trust === "approved", "normal project extension discovery respects trust");
      assert.equal(observed.cacheWarming, "off");
      const state = yield* session.state;
      assert.equal(state.model, observed.model); assert.equal(state.thinkingLevel, observed.effort);
      if (enabled) connecting(status, observed);
      else {
        assert.match(status, /^piano-sentinel: disabled \(direct\)$/m);
        assert.equal(observed.tools.includes(sentinelTool), false);
        assert.equal(fixture.observe().mcp.some(event => event.event === "spawn" && event.cwd === cwd), false);
      }
      assert.equal(fixture.observe().requests.length, 0, "/mcp and resource inspection must not invoke a model");
      return { status, facts: observed, state };
    }), fixture.cli(trust)));
  }
  // Demonstrate the connecting assertion rejects both false-positive configurations.
  for (const mode of ["disabled", "broken"] as const) {
    fixture.configureSentinel(mode);
    await check(`negative control: globally ${mode} sentinel`, () => run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: control, sessionId: `phase0-negative-${mode}` });
      const status = yield* notice(session, "/mcp", "piano-sentinel:");
      const observed = yield* facts(session);
      assert.throws(() => connecting(status, observed), `globally ${mode} MCP must not pass`);
      assert.equal(observed.tools.includes(sentinelTool), false);
      assert.match(status, mode === "disabled" ? /piano-sentinel: disabled/ : /piano-sentinel: failed/);
      return { status, controlAccepted: false };
    })));
  }
  fixture.configureSentinel("enabled");
  await check("model and effective effort", () => run(Effect.gen(function* () {
    const session = yield* (yield* PiSessions).open({ cwd: overridden, sessionId: "phase0-model" });
    yield* session.act({ _tag: "set_thinking_level", level: "low" });
    assert.equal((yield* session.state).thinkingLevel, "low");
    yield* session.act({ _tag: "set_model", model: "piano-phase0/plain" });
    yield* session.act({ _tag: "set_thinking_level", level: "high" });
    const observed = yield* facts(session);
    assert.equal(observed.model, "piano-phase0/plain"); assert.equal(observed.effort, "off");
    assert.equal((yield* session.state).thinkingLevel, "off", "report Pi's clamp, not the requested effort");
    return observed;
  })));
  await check("supported dialog after readiness", () => run(Effect.gen(function* () {
    const session = yield* (yield* PiSessions).open({ cwd: overridden, sessionId: "phase0-dialog" });
    const received = yield* watch(session, "supported-dialog", event => event._tag === "dialog");
    const action = yield* session.act({ _tag: "prompt", text: "/phase0-dialog" }).pipe(Effect.forkChild);
    const events = yield* Fiber.join(received);
    const event = events.find(event => event._tag === "dialog"); assert.ok(event?._tag === "dialog");
    assert.equal((yield* session.state).isStreaming, false, "idle command dialog is not an agent run");
    const snapshot = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
    assert.ok(snapshot[0]._tag === "snapshot"); assert.equal(snapshot[0].snapshot.dialogs.length, 1);
    const answered = yield* watch(session, "dialog-answer", event => event._tag === "notice" && event.message === "PHASE0_DIALOG_RESULT CHECKPOINT0");
    yield* session.act({ _tag: "answer", id: event.dialog.id, generation: event.dialog.generation, value: "CHECKPOINT0" });
    yield* Fiber.join(action); yield* Fiber.join(answered);
    assert.equal((yield* session.state).submission?.outcome, "handled");
    const after = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
    assert.ok(after[0]._tag === "snapshot"); assert.deepEqual(after[0].snapshot.dialogs, []);
    assert.deepEqual(after[0].snapshot.messages, [], "handled extension input is not invented transcript history");
    return { method: event.dialog.method, reply: "CHECKPOINT0", outcome: "handled", lateSnapshotDialogCount: 1 };
  })));
  await check("native abort of local fixture wait and explicit child exit", () => run(Effect.gen(function* () {
    const session = yield* (yield* PiSessions).open({ cwd: overridden, sessionId: "phase0-abort-exit" });
    const working = yield* watch(session, "local-wait", event => event._tag === "message_update" && event.message.text === "PHASE0_WAITING");
    yield* session.act({ _tag: "prompt", text: "/phase0-wait" });
    yield* Fiber.join(working);
    assert.equal((yield* session.state).isStreaming, true);
    const settled = yield* watch(session, "native-abort", event => event._tag === "state" && !event.state.isStreaming);
    yield* session.act({ _tag: "abort" });
    yield* Fiber.join(settled); yield* Effect.promise(() => fixture.aborted);
    assert.equal(fixture.observe().requests.length, 1); assert.equal(fixture.observe().requests[0].aborted, true);
    const closed = yield* watch(session, "explicit-exit", event => event._tag === "closed");
    yield* session.act({ _tag: "prompt", text: "/phase0-exit" }).pipe(Effect.ignore);
    const events = yield* Fiber.join(closed);
    const last = events[events.length - 1]; assert.ok(last._tag === "closed"); assert.match(last.reason, /code 0\b/);
    assert.equal((yield* session.state).isStreaming, false);
    return { syntheticRequests: 1, providerResponseClosedByAbort: true, exit: last.reason };
  })));
  // This is a compatibility observation, not an assertion that abandoned dialogs are acceptable.
  const abortObservation = await run(Effect.gen(function* () {
    const session = yield* (yield* PiSessions).open({ cwd: overridden, sessionId: "phase0-dialog-abort" });
    const received = yield* watch(session, "dialog-before-abort", event => event._tag === "dialog");
    const action = yield* session.act({ _tag: "prompt", text: "/phase0-dialog" }).pipe(Effect.forkChild);
    const events = yield* Fiber.join(received);
    const dialog = events.find(event => event._tag === "dialog"); assert.ok(dialog?._tag === "dialog");
    yield* session.act({ _tag: "abort" });
    const after = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
    assert.ok(after[0]._tag === "snapshot"); packets.push({ label: "dialog-after-abort-ack", events: [...after] });
    const retained = after[0].snapshot.dialogs.some(pending => pending.id === dialog.dialog.id);
    const pendingAcknowledgement = (yield* session.state).submission?.outcome === "submitting";
    // Recover explicitly so the check never abandons a fixture child or extension.
    if (retained) yield* session.act({ _tag: "answer", id: dialog.dialog.id, generation: dialog.dialog.generation, cancelled: true });
    yield* Fiber.join(action);
    return { abortAcknowledged: true, dialogRetained: retained, originatingPromptPending: pendingAcknowledgement, recovery: retained ? "explicit dialog cancellation" : "none" };
  }));
  checks.push({ name: "abort releases supported command dialog", outcome: abortObservation.dialogRetained ? "fail" : "pass", detail: abortObservation, followUp: "Phase 2 / INV-04" });
  console.log(JSON.stringify(checks[checks.length - 1]));
  for (const keepAlive of [false, true]) {
    const started = Date.now();
    const startupError = await run(Effect.gen(function* () {
      return yield* (yield* PiSessions).open({ cwd: startup, sessionId: `phase0-startup-${keepAlive}` }).pipe(Effect.flip);
    }).pipe(Effect.provideService(PiRequestTimeoutMs, 4000)), fixture.cli("approved", true, keepAlive));
    const elapsedMs = Date.now() - started;
    assert.equal(startupError.reason, keepAlive ? "timeout" : "spawn", "startup must fail explicitly, not claim readiness");
    assert.ok(elapsedMs < 12_000, "startup failure plus scoped cleanup must remain bounded");
    assert.ok(fixture.observe().pi.some(event => event.cwd === startup && event.event === "startup-dialog" && event.keepAlive === keepAlive), "prove the real extension reached the blocking startup dialog");
    assert.equal(fixture.observe().pi.some(event => event.cwd === startup && event.event === "startup-dialog-returned"), false);
    checks.push({ name: `startup dialog readiness (${keepAlive ? "live extension handle" : "no other handles"})`, outcome: "blocked", detail: { reason: startupError.reason, error: startupError.detail, elapsedMs, acknowledgementDeadlineMs: 4000, shutdownGraceMs: 3000 }, followUp: "Pi 1.0.2 startup limitation; bounded failure, no startup-dialog support claim" });
    console.log(JSON.stringify(checks[checks.length - 1]));
  }
} catch (error) {
  unexpectedFailure = true;
  checks.push({ name: "checkpoint execution", outcome: "fail", detail: String(error) });
  console.error(error);
} finally {
  fixture.retain(evidence);
  try { await fixture.close(); checks.push({ name: "scratch cleanup", outcome: "pass", detail: "Pi/MCP children exited, local endpoint closed, scratch repositories/session storage removed" }); }
  catch (error) { unexpectedFailure = true; checks.push({ name: "scratch cleanup", outcome: "fail", detail: String(error) }); }
  const complete = checks.every(check => check.outcome === "pass");
  writeFileSync(join(evidence, "events.json"), `${JSON.stringify(packets, null, 2)}\n`);
  writeFileSync(join(evidence, "checkpoint.json"), `${JSON.stringify({ complete, checks }, null, 2)}\n`);
  console.log(`Phase 0 checkpoint: ${complete ? "PASS" : "INCOMPLETE"}; evidence ${evidence}`);
  process.exitCode = unexpectedFailure ? 1 : complete ? 0 : 2;
}
