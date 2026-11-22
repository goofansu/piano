import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import type { SessionAction } from "../../../../shared/wire.ts";
import { PiCli } from "../../server/pi/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../../server/pi/PiSessions.ts";

test("completion is a live settled success (a truncated reply included), not agent_end, retry, error, abort, duplicate settle or a reopened snapshot; failure is a settled error, once", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "response-notifications",
      });
      const act = Effect.fn("Test.act")(function* (action: SessionAction) {
        const ready = yield* Deferred.make<void>();
        const collector = yield* session.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.takeUntil((e) => e._tag === "notice" && e.message === "completion barrier"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(ready);
        yield* session.act(action);
        const events = yield* Fiber.join(collector);
        const count = (tag: string) => events.filter((e) => e._tag === tag).length;
        return [count("response_completed"), count("response_failed")];
      });
      assert.deepEqual(yield* act({ _tag: "prompt", text: "notification pause" }), [0, 0]);
      assert.deepEqual(yield* act({ _tag: "prompt", text: "notification finish" }), [1, 0]);
      assert.deepEqual(yield* act({ _tag: "prompt", text: "notification error" }), [0, 1]);
      assert.deepEqual(
        yield* act({ _tag: "prompt", text: "notification length" }),
        [1, 0],
        "a reply cut off at the token limit still ended the turn",
      );
      assert.deepEqual(yield* act({ _tag: "prompt", text: "notification pause" }), [0, 0]);
      assert.deepEqual(
        yield* act({ _tag: "abort" }),
        [0, 0],
        "even a preceding stop message is suppressed by abort",
      );
      assert.deepEqual(
        yield* act({ _tag: "prompt", text: "retry recover" }),
        [1, 0],
        "a failed attempt that a retry recovers completes",
      );
      assert.deepEqual(
        yield* act({ _tag: "prompt", text: "retry exhaust" }),
        [0, 1],
        "only the attempt that exhausts retries fails, once",
      );
      assert.deepEqual(yield* act({ _tag: "prompt", text: "retry wait" }), [0, 0]);
      assert.deepEqual(
        yield* act({ _tag: "abort" }),
        [0, 0],
        "cancelling during a retry's backoff is not a failure",
      );
      assert.deepEqual(yield* act({ _tag: "prompt", text: "notification success" }), [1, 0]);
      const reopened = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      assert.deepEqual(
        reopened.map((e) => e._tag),
        ["snapshot"],
      );
    }).pipe(
      Effect.timeout("5 seconds"),
      Effect.scoped,
      Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("../../../../test/fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
    ),
  );
});
