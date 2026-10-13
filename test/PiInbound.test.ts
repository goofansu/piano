import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { inboundLimits } from "../server/InboundCapacity.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiRequestTimeoutMs, PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
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

// Each action whose policy is priority, sent while ordinary prompts hold every ordinary slot from
// session admission down to Pi's command lane.
for (const control of ["answer", "abort", "stop", "restore_queue"] as const) {
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
        const answer = {
          _tag: "answer",
          id: dialog.id,
          generation: dialog.generation,
          value: "release",
        } as const;
        if (control === "restore_queue") {
          // Pi answers clear_queue past the held prompts; the dialog answer then releases them.
          const restored = yield* session.act({ _tag: "restore_queue" });
          assert.equal(restored?._tag, "queue_restored");
          yield* session.act(answer);
        } else yield* session.act(control === "answer" ? answer : { _tag: control });
        for (const fiber of pending) yield* Fiber.join(fiber);
        assert.equal((yield* session.state).closure, undefined);
        yield* session.commands; // capacity is released after work completes
        yield* Fiber.interrupt(heard);
      }).pipe(Effect.scoped, Effect.timeout("15 seconds")),
    );
  });
}

// Above, session admission rejects ordinary input before it reaches Pi's command lane. Here a
// background usage readback that Pi holds takes one of those slots instead, so session admission
// has room and a readback must be refused by Pi's command lane itself.
test("INV-04: a readback stays ordinary work at Pi's command capacity", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "capacity-readback",
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
      for (let n = 1; n < inboundLimits.requests.messages; n++)
        pending.push(
          yield* session.act({ _tag: "prompt", text: "capacity hold" }).pipe(Effect.forkChild),
        );
      yield* Deferred.await(full);
      const read = yield* session.commands.pipe(Effect.result);
      assert.equal(read._tag, "Failure", "a readback must not borrow the control reserve");
      assert.equal(read.failure.reason, "rejected");
      assert.match(read.failure.detail, /Pi command capacity is full.*Nothing was sent/);
      assert.ok(dialog);
      yield* session.act({
        _tag: "answer",
        id: dialog.id,
        generation: dialog.generation,
        value: "release",
      });
      for (const fiber of pending) yield* Fiber.join(fiber);
      yield* session.commands; // capacity is released after work completes
      yield* Fiber.interrupt(heard);
    }).pipe(Effect.scoped, Effect.timeout("15 seconds")),
  );
});

// Pi's input lane fills only while Pi stops reading stdin: each ordinary write then keeps its slot
// after its command times out, until Pi reads it.
test("INV-04: an answer stays live while ordinary input fills Pi's stdin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "piano-stdin-"));
  const resume = join(dir, "resume");
  try {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: "stdin-backpressure",
        });
        const opened = yield* Deferred.make<Dialog>();
        const received = yield* Deferred.make<void>();
        const heard = yield* session.events.pipe(
          Stream.runForEach((event) =>
            event._tag === "dialog"
              ? Deferred.succeed(opened, event.dialog)
              : event._tag === "notice" && event.message === "answered paused with release"
                ? Deferred.succeed(received, undefined)
                : Effect.void,
          ),
          Effect.forkChild,
        );
        const paused = yield* session
          .act({ _tag: "set_name", name: `pause stdin until ${resume}` })
          .pipe(Effect.flip);
        assert.equal(paused.reason, "timeout");
        const dialog = yield* Deferred.await(opened);
        // Each record outgrows the pipe, so none is accepted before Pi reads again.
        const name = "x".repeat(256 * 1024);
        yield* Effect.forEach(
          Array.from({ length: inboundLimits.writes.messages }),
          () => session.act({ _tag: "set_name", name }).pipe(Effect.flip),
          { concurrency: "unbounded" },
        );
        const excess = yield* session.act({ _tag: "set_name", name: "excess" }).pipe(Effect.flip);
        assert.equal(excess.reason, "rejected");
        assert.match(excess.detail, /input capacity is full.*Nothing was sent/);
        // Admitted, so it waits behind the input Pi has not read and times out undelivered.
        const answer = yield* session
          .act({ _tag: "answer", id: dialog.id, generation: dialog.generation, value: "release" })
          .pipe(Effect.flip);
        assert.equal(answer.reason, "transport", answer.detail);
        assert.match(answer.detail, /write timed out/);
        writeFileSync(resume, "");
        yield* Deferred.await(received);
        assert.equal((yield* session.state).closure, undefined);
        yield* Fiber.interrupt(heard);
      }).pipe(
        // Bounds each held write; open's readbacks also answer within it.
        Effect.provideService(PiRequestTimeoutMs, 1000),
        Effect.scoped,
        Effect.timeout("15 seconds"),
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
