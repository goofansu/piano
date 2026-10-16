import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import type { SessionAction } from "../shared/wire.ts";

test("completion is a live settled success, not agent_end, retry, error, abort, duplicate settle or a reopened snapshot", async () => {
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
        return events.filter((e) => e._tag === "response_completed").length;
      });
      assert.equal(yield* act({ _tag: "prompt", text: "notification pause" }), 0);
      assert.equal(yield* act({ _tag: "prompt", text: "notification finish" }), 1);
      assert.equal(yield* act({ _tag: "prompt", text: "notification error" }), 0);
      assert.equal(yield* act({ _tag: "prompt", text: "notification pause" }), 0);
      assert.equal(
        yield* act({ _tag: "abort" }),
        0,
        "even a preceding stop message is suppressed by abort",
      );
      assert.equal(yield* act({ _tag: "prompt", text: "notification success" }), 1);
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
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
    ),
  );
});
