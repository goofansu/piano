// INV-01/04/12: a real model tool call waits for Piano's dialog, returns once, and persists in Pi.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { type PiSession, PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import type { SessionEvent } from "../shared/wire.ts";
import { askUserFixture } from "./fixtures/AskUser.ts";

const watch = Effect.fn("test.watchAskUser")(function* (
  session: PiSession,
  until: (event: SessionEvent) => boolean,
) {
  const ready = yield* Deferred.make<void>();
  const fiber = yield* session.events.pipe(
    Stream.tap((event) =>
      event._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
    ),
    Stream.takeUntil(until),
    Stream.runCollect,
    Effect.forkChild,
  );
  yield* Deferred.await(ready);
  return fiber;
});

test("real Pi ask_user returns choices, multiline replies and cancellation; Stop releases the tool", {
  timeout: 60_000,
}, async () => {
  const fixture = await askUserFixture();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        for (const [prompt, value] of [
          ["ASK_CHOICE", "SQLite"],
          ["ASK_TEXT", "Keep the API\nChange the layout"],
          ["ASK_CANCEL", undefined],
          ["ASK_STOP", undefined],
        ] as const) {
          yield* Effect.gen(function* () {
            const session = yield* sessions.open({
              cwd: fixture.root,
              sessionId: prompt,
              model: "piano-ask-test/local",
            });
            const question = yield* watch(session, (event) => event._tag === "dialog");
            yield* session.act({ _tag: "prompt", text: prompt });
            const event = (yield* Fiber.join(question)).find((event) => event._tag === "dialog");
            assert.ok(event?._tag === "dialog");
            const dialog = event.dialog;
            assert.equal(dialog.method, prompt === "ASK_CHOICE" ? "select" : "editor");
            if (prompt === "ASK_CHOICE") assert.deepEqual(dialog.options, ["PostgreSQL", "SQLite"]);
            const before = fixture.requests.filter((request) => request.prompt === prompt);
            assert.equal(before.length, 1, "the model must wait for the user's answer");
            assert.ok(before[0].tools.includes("ask_user"), "Piano's launch exposes the tool");
            const settled = yield* watch(
              session,
              (event) => event._tag === "state" && !event.state.isStreaming,
            );
            if (prompt === "ASK_STOP") yield* session.act({ _tag: "stop" });
            else
              yield* session.act({
                _tag: "answer",
                id: dialog.id,
                generation: dialog.generation,
                ...(value === undefined ? { cancelled: true } : { value }),
              });
            yield* Fiber.join(settled);
            const late = yield* session
              .act({
                _tag: "answer",
                id: dialog.id,
                generation: dialog.generation,
                value: "late reply",
              })
              .pipe(Effect.result);
            assert.equal(late._tag, "Failure", "closed questions must never accept another answer");
            const requests = fixture.requests.filter((request) => request.prompt === prompt);
            assert.equal(requests.length, prompt === "ASK_STOP" ? 1 : 2);
            if (prompt !== "ASK_STOP") {
              assert.equal(requests[1].results.length, 1);
              assert.deepEqual(
                JSON.parse(requests[1].results[0]),
                value === undefined
                  ? { status: "cancelled" }
                  : { status: "answered", answer: value },
              );
            }
            const state = yield* session.state;
            const history = yield* sessions.history.peek(prompt, state.sessionFile);
            assert.deepEqual(
              history.messages
                .filter((message) => message.role === "user")
                .map((message) => message.text),
              [prompt],
              "answers are tool results, not synthetic user turns",
            );
            if (value !== undefined)
              assert.ok(
                history.messages.some(
                  (message) =>
                    message.role === "tool_result" && message.text.includes(JSON.stringify(value)),
                ),
                "Pi persists the exact answer in the tool result",
              );
          }).pipe(Effect.scoped);
        }
      }).pipe(
        Effect.timeout("50 seconds"),
        Effect.scoped,
        Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
        Effect.provideService(PiCli, fixture.cli),
      ),
    );
  } finally {
    await fixture.close();
  }
});
