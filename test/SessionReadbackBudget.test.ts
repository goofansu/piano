import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

test("PIN-53: compaction and active tool boundaries defer full context reads until settlement", async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "piano-readback-budget-"));
  const metricsPath = join(scratch, "metrics.json");
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: scratch,
          sessionId: "readback-budget",
        });
        const ready = yield* Deferred.make<void>();
        const collector = yield* session.events.pipe(
          Stream.tap((event) =>
            event._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.takeUntil(
            (event) => event._tag === "context" && event.messages.at(-1)?.text === "DONE",
          ),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(ready);
        yield* session.act({ _tag: "prompt", text: "Run five tools" });
        const events = yield* Fiber.join(collector);
        while (!(yield* session.state).isQuiescent) yield* Effect.sleep("10 millis");
        const first = (yield* session.events.pipe(Stream.take(1), Stream.runCollect))[0];
        assert.equal(first._tag, "snapshot");
        if (first._tag !== "snapshot") return;
        const { messages, state } = first.snapshot;
        assert.deepEqual(
          messages.map(({ role, text }) => [role, text]),
          [
            ["context", "x".repeat(1024 * 1024)],
            ["user", "Run five tools"],
            ...Array.from({ length: 5 }, (_, i) => [
              ["assistant", ""],
              ["tool_result", `result ${i}`],
            ]).flat(),
            ["assistant", "DONE"],
          ],
        );
        assert.deepEqual(
          messages.flatMap((message) => message.toolCalls?.map((call) => call.id) ?? []),
          ["tool-0", "tool-1", "tool-2", "tool-3", "tool-4"],
        );
        assert.equal(new Set(messages.map((message) => message.id)).size, messages.length);
        const finalState = {
          isStreaming: state.isStreaming,
          isQuiescent: state.isQuiescent,
          projectionError: state.projectionError,
          model: state.model,
          cost: state.cost,
          context: state.context,
        };
        assert.deepEqual(finalState, {
          isStreaming: false,
          isQuiescent: true,
          projectionError: undefined,
          model: "fake/alpha",
          cost: 1.25,
          context: { tokens: 1000, contextWindow: 10000, percent: 10 },
        });
        const ends = events.flatMap((event) =>
          event._tag === "message_end" ? [event.message] : [],
        );
        assert.equal(
          ends.length,
          12,
          "every live user, assistant and tool result ends exactly once",
        );
        assert.equal(new Set(ends.map((message) => message.id)).size, ends.length);
        for (let i = 1; i < events.length; i++)
          assert.equal(events[i].cursor.sequence, events[i - 1].cursor.sequence + 1);
        const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
        const finalDigest = createHash("sha256")
          .update(
            JSON.stringify({
              messages: messages.map(({ id, role, text }) => ({ id, role, text })),
              state: finalState,
            }),
          )
          .digest("hex");
        t.diagnostic(JSON.stringify({ ...metrics, finalDigest }));
        assert.equal(
          metrics.activeReads,
          0,
          "known-active boundaries must not download full context",
        );
        assert.equal(metrics.activeBytes, 0);
        // The final message and settlement can overlap one in-flight refresh; pending
        // requests coalesce into at most one more, independent of the active boundary count.
        assert.ok(metrics.settledReads >= 1 && metrics.settledReads <= 2);
        assert.ok(metrics.settledBytes < 2.02 * 1024 * 1024);
        assert.ok(
          !events.some((event) => event._tag === "state" && event.state.projectionError),
          "active work is expected deferral, not a projection failure",
        );
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.scoped,
        Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
        Effect.provideService(PiCli, {
          node: process.execPath,
          cli: new URL("./fake-readback-pi.mjs", import.meta.url).pathname,
          extraArgs: ["--metrics", metricsPath],
        }),
      ),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
