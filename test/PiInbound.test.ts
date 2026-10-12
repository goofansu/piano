import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { inboundLimits } from "../server/InboundCapacity.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import type { Dialog } from "../shared/wire.ts";

const layer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(layer),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
    ),
  );

for (const control of ["answer", "abort", "stop"] as const) {
  test(`INV-03/04: ${control} stays live at ordinary Pi capacity; excess input is never sent`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: `capacity-${control}`,
        });
        const full = yield* Deferred.make<void>();
        let dialog: Dialog | undefined;
        const heard = yield* session.events.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event._tag === "dialog") dialog = event.dialog;
              if (
                event._tag === "notice" &&
                event.message === `Capacity held: ${inboundLimits.requests.messages}`
              )
                yield* Deferred.succeed(full, undefined);
            }),
          ),
          Effect.forkChild,
        );
        const pending = [];
        for (let n = 0; n < inboundLimits.requests.messages; n++)
          pending.push(
            yield* session.act({ _tag: "prompt", text: "capacity hold" }).pipe(Effect.forkChild),
          );
        yield* Deferred.await(full);
        const rejected = yield* session
          .act({ _tag: "prompt", text: "must not execute" })
          .pipe(Effect.flip);
        assert.equal(rejected.reason, "rejected");
        assert.match(rejected.detail, /capacity.*Nothing was sent/);
        assert.ok(dialog);
        yield* session.act(
          control === "answer"
            ? { _tag: "answer", id: dialog.id, generation: dialog.generation, value: "release" }
            : { _tag: control },
        );
        for (const fiber of pending) yield* Fiber.join(fiber);
        assert.equal((yield* session.state).closure, undefined);
        const result = yield* session.act({ _tag: "commands" });
        assert.equal(result?._tag, "commands", "capacity is released after work completes");
        yield* Fiber.interrupt(heard);
      }).pipe(Effect.scoped, Effect.timeout("15 seconds")),
    );
  });
}

for (const sessionId of ["capacity-records", "capacity-record-bytes"]) {
  test(`INV-03: ${sessionId} fails readiness without dropping output or waiting for timeout`, async () => {
    await run(
      Effect.gen(function* () {
        const error = yield* (yield* PiSessions)
          .open({ cwd: process.cwd(), sessionId })
          .pipe(Effect.flip);
        assert.notEqual(error.reason, "timeout");
        assert.match(error.detail, /pending record limit/);
      }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
    );
  });
}

test("INV-03: oversized newline-free stdout closes a session and settles pending input", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "line-limit",
      });
      const closed = yield* session.events.pipe(
        Stream.filter((e) => e._tag === "closed"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      const error = yield* session
        .act({ _tag: "prompt", text: "capacity oversized-line" })
        .pipe(Effect.flip);
      assert.notEqual(error.reason, "timeout");
      const [event] = yield* Fiber.join(closed);
      assert.ok(event?._tag === "closed" && event.closure._tag === "failed");
      assert.match(event.closure.detail, /RPC line byte limit/);
    }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
  );
});

test("oversized Pi input is rejected before delivery; fragmented UTF-8 records still decode", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "input-limit",
      });
      const before = (yield* session.state).sessionName;
      const error = yield* session
        .act({ _tag: "set_name", name: "x".repeat(inboundLimits.rpcLineBytes + 1) })
        .pipe(Effect.flip);
      assert.equal(error.reason, "rejected");
      assert.match(error.detail, /byte limit/);
      assert.equal((yield* session.state).sessionName, before);
      const notice = yield* session.events.pipe(
        Stream.filter((e) => e._tag === "notice" && e.message === "Fragmented € record"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* session.act({ _tag: "prompt", text: "capacity fragmented" });
      assert.equal((yield* Fiber.join(notice)).length, 1);
      assert.equal((yield* session.state).closure, undefined);
    }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
  );
});
