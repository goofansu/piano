import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiPreviewAdapter, PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { type FakeHost, fakeAdapter } from "./fixtures/preview-host.ts";

// The fake Pi invokes the real owner socket like piano_preview; only the supervisor is fake.
// Browser actions below use PiSessions, not that socket or adapter internals.
test("live preview projection, generation isolation, exact stop and honest uncertainty", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piano-session-preview-"));
  const stateRoot = join(root, "previews");
  const cwd = join(root, "checkout");
  await mkdir(cwd);
  const config = join(root, "config.json");
  await writeFile(config, JSON.stringify({ origin: "http://localhost" }));
  const previous = {
    config: process.env.PIANO_PREVIEW_CONFIG,
    state: process.env.PIANO_PREVIEW_STATE,
  };
  process.env.PIANO_PREVIEW_CONFIG = config;
  process.env.PIANO_PREVIEW_STATE = stateRoot;
  t.after(async () => {
    if (previous.config === undefined) delete process.env.PIANO_PREVIEW_CONFIG;
    else process.env.PIANO_PREVIEW_CONFIG = previous.config;
    if (previous.state === undefined) delete process.env.PIANO_PREVIEW_STATE;
    else process.env.PIANO_PREVIEW_STATE = previous.state;
    await rm(root, { recursive: true, force: true });
  });
  const host: FakeHost = {
    phase: "failed",
    runs: 1,
    owner: "self",
    journal: "x".repeat(7000),
    unavailable: false,
    lostReply: false,
    hangOnSubmit: false,
  };
  const { adapter, launched, stops } = fakeAdapter(
    process.platform === "darwin" ? "darwin" : "linux",
    stateRoot,
    host,
  );
  const command = [process.execPath, "-e", "process.exit(1)"];
  const audit = join(root, "audit.jsonl");
  const rpc = () => readFile(audit, "utf8");
  const layer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));
  await Effect.runPromise(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      // A dormant history query cannot spawn Pi, inspect another owner's record, or touch a supervisor.
      assert.equal((yield* sessions.history.peek("dormant", undefined)).state.preview, undefined);
      yield* Effect.promise(() => assert.rejects(rpc(), { code: "ENOENT" }));
      const scope = yield* Scope.make();
      yield* Effect.addFinalizer(() => {
        host.unavailable = false;
        host.phase = "failed";
        return Scope.close(scope, Exit.void);
      });
      const session = yield* sessions.open({ cwd, sessionId: "owner" }).pipe(Scope.provide(scope));
      host.unavailable = true;
      yield* session.act({ _tag: "preview_refresh", details: true });
      assert.equal(
        (yield* session.state).preview,
        null,
        "unattempted live owner never observes the supervisor",
      );
      host.unavailable = false;
      yield* session.act({
        _tag: "prompt",
        text: `preview ${JSON.stringify({ action: "start", command })}`,
      });
      const first = (yield* session.state).preview!;
      assert.equal(first.state, "failed");
      assert.equal(first.ready, false);
      assert.equal(first.url, null);
      assert.ok(first.instanceId);
      assert.equal(first.details, undefined, "logs are not delivered until requested");
      assert.equal(launched.length, 1);
      const snapshot = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      assert.ok(snapshot[0]._tag === "snapshot");
      assert.deepEqual(
        snapshot[0].snapshot.state.preview,
        first,
        "reconnect sees the same instance without an observation",
      );
      const other = yield* sessions.open({ cwd, sessionId: "other" });
      yield* other.act({ _tag: "preview_refresh", details: true });
      assert.equal(
        (yield* other.state).preview,
        null,
        "another live session never adopts the workspace's preview",
      );
      const otherCwd = join(root, "other-checkout");
      yield* Effect.promise(() => mkdir(otherCwd));
      const independent = yield* sessions.open({ cwd: otherCwd, sessionId: "independent" });
      yield* independent.act({
        _tag: "prompt",
        text: `preview ${JSON.stringify({ action: "start", command })}`,
      });
      const independentPreview = (yield* independent.state).preview!;
      assert.notEqual(independentPreview.instanceId, first.instanceId);
      assert.deepEqual((yield* session.state).preview, first);
      // Prompt acknowledgement precedes its scheduled usage readback; wait for actual quiescence.
      while (!(yield* session.state).isQuiescent || !(yield* independent.state).isQuiescent)
        yield* Effect.yieldNow;
      const before = yield* Effect.promise(rpc);
      yield* session.act({ _tag: "preview_refresh", details: true });
      assert.equal((yield* session.state).preview?.details?.logs.length, 6000);
      host.phase = "running";
      yield* session.act({ _tag: "preview_refresh" });
      assert.equal((yield* session.state).preview?.state, "running");
      assert.equal((yield* session.state).preview?.ready, false, "running is not local readiness");
      host.unavailable = true;
      yield* session.act({ _tag: "preview_refresh", details: true });
      const unknown = (yield* session.state).preview!;
      assert.equal(unknown.state, "unknown");
      assert.equal(unknown.instanceId, first.instanceId);
      assert.equal(unknown.ready, null);
      assert.equal(unknown.url, null);
      assert.match(unknown.details?.detail ?? "", /unavailable/);
      const failedStop = yield* session
        .act({ _tag: "preview_stop", instanceId: first.instanceId })
        .pipe(Effect.flip);
      assert.match(failedStop.detail, /unavailable/);
      assert.equal((yield* session.state).preview?.state, "unknown");
      assert.equal(yield* Effect.promise(rpc), before, "refresh and stop send no Pi requests");
      host.unavailable = false;
      host.phase = "failed";
      yield* session.act({
        _tag: "prompt",
        text: `preview ${JSON.stringify({ action: "start", replace: first.instanceId, command })}`,
      });
      const next = (yield* session.state).preview!;
      assert.notEqual(next.instanceId, first.instanceId);
      const stoppedCount = stops.length;
      assert.deepEqual(yield* session.act({ _tag: "preview_stop", instanceId: first.instanceId }), {
        _tag: "preview_stopped",
        status: "not-current",
      });
      assert.equal(stops.length, stoppedCount, "stale ID never stops a replacement");
      assert.deepEqual(
        (yield* session.state).preview,
        next,
        "stale reply never clears the replacement",
      );
      while (!(yield* session.state).isQuiescent) yield* Effect.yieldNow;
      const beforeStop = yield* Effect.promise(rpc);
      assert.deepEqual(yield* session.act({ _tag: "preview_stop", instanceId: next.instanceId! }), {
        _tag: "preview_stopped",
        status: "stopped",
      });
      assert.equal(stops.length, stoppedCount + 1);
      assert.equal((yield* session.state).preview, null);
      assert.deepEqual(yield* session.act({ _tag: "preview_stop", instanceId: next.instanceId! }), {
        _tag: "preview_stopped",
        status: "not-current",
      });
      assert.equal(yield* Effect.promise(rpc), beforeStop);
      yield* session.act({ _tag: "set_name", name: "Still usable" });
      assert.equal((yield* session.state).sessionName, "Still usable");
      assert.equal(
        yield* session.prepareRelease(true),
        true,
        "confirmed stop permits idle retirement",
      );
      yield* Scope.close(scope, Exit.void);
      assert.equal((yield* session.state).preview, null);
      const reopened = yield* sessions.open({ cwd, sessionId: "owner" });
      yield* reopened.act({ _tag: "preview_refresh" });
      assert.equal((yield* reopened.state).preview, null);
      assert.equal(launched.length, 3, "reopen never relaunches");
      assert.deepEqual(
        (yield* independent.state).preview,
        independentPreview,
        "stopping one workspace never changes another",
      );
      const closed = yield* independent.events.pipe(
        Stream.takeUntil((e) => e._tag === "closed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* independent.act({ _tag: "prompt", text: "crash now" }).pipe(Effect.ignore);
      yield* Fiber.join(closed);
      assert.equal((yield* independent.state).preview, null, "Pi death clears its live projection");
    }).pipe(
      Effect.scoped,
      Effect.timeout("20 seconds"),
      Effect.provide(layer),
      Effect.provideService(PiPreviewAdapter, adapter),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs: ["--preview-audit", audit],
      }),
    ),
  );
});
