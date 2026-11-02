// The session UI's view of its managed app, through PiSessions: what the live generation's state
// shows, how the browser re-observes and stops it, and what it must never show or stop. The host
// supervisor is the substituted boundary (fixtures/preview-host.ts); lifecycle ownership itself is
// PreviewOwner.test.ts's contract.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, Option, type Scope, Stream } from "effect";
import type { PreviewConfig } from "../scripts/PreviewAdapter.ts";
import { PiCli } from "../server/PiCli.ts";
import {
  type PiSession,
  PiSessions,
  PiSessionsLive,
  PreviewOwnerOptions,
} from "../server/PiSessions.ts";
import type { SessionState } from "../shared/wire.ts";
import { type FakeHost, fakeAdapter, type Platform } from "./fixtures/preview-host.ts";

const fakeCli = {
  node: process.execPath,
  cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
  extraArgs: [],
};
const platform = process.platform as Platform;
const supported = platform === "linux" || platform === "darwin";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "session-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const host: FakeHost = {
    phase: "failed",
    runs: 1,
    owner: "self",
    journal: "",
    unavailable: false,
    lostReply: false,
    hangOnSubmit: false,
  };
  const { adapter, launched, stops } = fakeAdapter(platform, join(root, "state"), host);
  const config: PreviewConfig = { origin: "http://localhost" };
  const run = <A, E>(effect: Effect.Effect<A, E, PiSessions | Scope.Scope>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.scoped,
        Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
        Effect.provideService(PiCli, fakeCli),
        Effect.provideService(PreviewOwnerOptions, {
          adapter,
          root: join(root, "state"),
          config: async () => config,
        }),
      ),
    );
  return { root, host, config, launched, stops, run };
}

/** The first state, from the snapshot onwards, that satisfies `pred`. */
const stateWhere = (session: PiSession, pred: (state: SessionState) => boolean) =>
  session.events.pipe(
    Stream.map((frame) =>
      frame._tag === "snapshot"
        ? frame.snapshot.state
        : frame._tag === "state"
          ? frame.state
          : undefined,
    ),
    Stream.filter((state): state is SessionState => !!state && pred(state)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

/** The session's tool sends `request`; the reply the agent reads. */
const askTool = (session: PiSession, request: object) =>
  Effect.gen(function* () {
    const reply = yield* session.events.pipe(
      Stream.filter((frame) => frame._tag === "notice" && frame.message.startsWith("preview ")),
      Stream.runHead,
      Effect.map((frame) => (Option.getOrThrow(frame) as { message: string }).message),
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    yield* session.act({
      _tag: "prompt",
      text: `preview ${JSON.stringify(request)}`,
    });
    return yield* Fiber.join(reply);
  });

/** The session's tool starts an app, as the agent would. */
const startFromTool = (session: PiSession) =>
  Effect.gen(function* () {
    yield* askTool(session, {
      action: "start",
      command: [process.execPath, "-e", "process.exit(1)"],
    });
    return (yield* stateWhere(session, (s) => !!s.preview)).preview!;
  });

test("the tool's app reaches the session state; the browser re-observes and stops exactly it", async (t) => {
  if (!supported) return t.skip("managed previews need launchd or systemd");
  const f = await fixture(t);
  await f.run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: f.root,
        sessionId: "preview-own",
      });
      const app = yield* startFromTool(session);
      assert.equal(app.state, "failed");
      assert.equal(app.ready, false);
      assert.equal(app.url, null, "an unready app offers nothing to open");
      assert.deepEqual(app.command, [process.execPath, "-e", "process.exit(1)"]);

      // Unavailable supervision is unknown: not stopped, and not openable.
      f.host.unavailable = true;
      const failed = yield* session.act({ _tag: "preview_status", requestId: "failed-read" });
      assert.equal(failed?._tag === "preview_observed" && failed.requestId, "failed-read");
      assert.equal(failed?._tag === "preview_observed" && failed.instanceId, app.instanceId);
      assert.match((failed?._tag === "preview_observed" && failed.error) || "", /unavailable/);
      const unknown = (yield* session.state).preview;
      assert.equal(unknown?.state, "unknown");
      assert.equal(unknown?.instanceId, app.instanceId);
      f.host.unavailable = false;

      assert.deepEqual(
        {
          ...(yield* session.act({ _tag: "preview_status", requestId: "current-read" })),
          logs: "",
        },
        {
          _tag: "preview_observed",
          requestId: "current-read",
          instanceId: app.instanceId,
          logs: "",
        },
      );
      assert.equal((yield* session.state).preview?.state, "failed");

      // A stale instance is never retargeted to the current one.
      assert.deepEqual(yield* session.act({ _tag: "preview_stop", instanceId: "replaced" }), {
        _tag: "preview_stopped",
        instanceId: "replaced",
        outcome: "not-current",
      });
      assert.equal(f.stops.length, 0);
      assert.equal((yield* session.state).preview?.instanceId, app.instanceId);

      const stopped = yield* session.act({
        _tag: "preview_stop",
        instanceId: app.instanceId,
      });
      assert.equal(stopped?._tag === "preview_stopped" && stopped.outcome, "stopped");
      assert.equal(f.stops.length, 1);
      const after = yield* session.state;
      assert.equal(after.preview, undefined);
      assert.equal(after.closure, undefined, "stopping the app leaves Pi available");
      assert.deepEqual(yield* session.act({ _tag: "preview_status" }), {
        _tag: "preview_observed",
        instanceId: null,
        logs: "",
      });
      assert.equal(f.launched.length, 1, "observing and stopping never launch");
    }),
  );
});

test("another session's app is never shown as, or stopped through, this session's preview", async (t) => {
  if (!supported) return t.skip("managed previews need launchd or systemd");
  const f = await fixture(t);
  await f.run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const owner = yield* sessions.open({
        cwd: f.root,
        sessionId: "preview-owner",
      });
      const other = yield* sessions.open({
        cwd: f.root,
        sessionId: "preview-other",
      });
      const app = yield* startFromTool(owner);

      assert.deepEqual(yield* other.act({ _tag: "preview_status" }), {
        _tag: "preview_observed",
        instanceId: null,
        logs: "",
      });
      assert.equal((yield* other.state).preview, undefined);
      const refused = yield* other
        .act({ _tag: "preview_stop", instanceId: app.instanceId })
        .pipe(Effect.flip);
      assert.match(refused.detail, /ownership conflict/);
      assert.equal(f.stops.length, 0);
      assert.equal((yield* other.state).preview, undefined);
      assert.equal((yield* owner.state).preview?.instanceId, app.instanceId);
    }),
  );
});

test("a stale stop after a replacement neither stops nor clears the replacement", async (t) => {
  if (!supported) return t.skip("managed previews need launchd or systemd");
  const f = await fixture(t);
  await f.run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: f.root,
        sessionId: "preview-swap",
      });
      const first = yield* startFromTool(session);
      yield* session.act({
        _tag: "prompt",
        text: `preview ${JSON.stringify({ action: "start", replace: first.instanceId, command: [process.execPath, "-e", "process.exit(1)"] })}`,
      });
      const next = (yield* stateWhere(
        session,
        (s) => !!s.preview && s.preview.instanceId !== first.instanceId,
      )).preview!;
      const stopped = f.stops.length;

      // The browser still shows the old instance and asks to stop it.
      assert.deepEqual(
        yield* session.act({
          _tag: "preview_stop",
          instanceId: first.instanceId,
        }),
        {
          _tag: "preview_stopped",
          instanceId: first.instanceId,
          outcome: "not-current",
        },
      );
      assert.equal(f.stops.length, stopped, "a stale ID never stops the replacement");
      assert.equal((yield* session.state).preview?.instanceId, next.instanceId);

      const exact = yield* session.act({
        _tag: "preview_stop",
        instanceId: next.instanceId,
      });
      assert.equal(exact?._tag === "preview_stopped" && exact.outcome, "stopped");
      assert.equal(f.stops.length, stopped + 1);
      assert.equal((yield* session.state).preview, undefined);
      const repeated = yield* session.act({
        _tag: "preview_stop",
        instanceId: next.instanceId,
      });
      assert.equal(repeated?._tag === "preview_stopped" && repeated.outcome, "not-current");
      assert.equal(f.stops.length, stopped + 1, "a repeated stop is harmless");
    }),
  );
});

test("a replacement that fails after stopping the app no longer shows the stopped app", async (t) => {
  if (!supported) return t.skip("managed previews need launchd or systemd");
  const f = await fixture(t);
  await f.run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: f.root,
        sessionId: "preview-lost",
      });
      const app = yield* startFromTool(session);
      f.config.ports = [5173]; // Reserved for Piano: no free port remains.

      const reply = yield* askTool(session, {
        action: "start",
        replace: app.instanceId,
        command: [process.execPath, "-e", "process.exit(1)"],
      });
      assert.match(reply, /preview failed: .*No free supported preview port/);
      assert.equal(f.stops.length, 1, "the replaced app was stopped");
      assert.equal((yield* session.state).preview, undefined);
    }),
  );
});

test("a first start whose observation fails shows its app as unknown, and can stop it", async (t) => {
  if (!supported) return t.skip("managed previews need launchd or systemd");
  const f = await fixture(t);
  await f.run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: f.root,
        sessionId: "preview-blind",
      });
      f.host.unavailableAfterSubmit = true;

      const reply = yield* askTool(session, {
        action: "start",
        command: [process.execPath, "-e", "process.exit(1)"],
      });
      assert.match(reply, /preview failed: .*unavailable/);
      assert.equal(f.launched.length, 1, "the app was submitted");
      const unknown = (yield* session.state).preview;
      assert.equal(unknown?.state, "unknown");
      assert.equal(unknown?.url, null);
      assert.deepEqual(unknown?.command, [process.execPath, "-e", "process.exit(1)"]);

      f.host.unavailable = false;
      const stopped = yield* session.act({
        _tag: "preview_stop",
        instanceId: unknown!.instanceId,
      });
      assert.equal(stopped?._tag === "preview_stopped" && stopped.outcome, "stopped");
      assert.equal((yield* session.state).preview, undefined);
    }),
  );
});
