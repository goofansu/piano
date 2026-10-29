// INV-01/04/12: one real tool call collects a batch through Piano's dialogs and persists one result.
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

test("real Pi ask_user collects a batch without model turns between questions; cancellation and Stop end it", {
  timeout: 60_000,
}, async () => {
  const fixture = await askUserFixture();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        for (const [prompt, values, expected] of [
          ["ASK_CHOICE", ["SQLite"], { status: "answered", answers: { database: "SQLite" } }],
          [
            "ASK_TEXT",
            ["Keep the API\nChange the layout"],
            { status: "answered", answers: { requirements: "Keep the API\nChange the layout" } },
          ],
          ["ASK_CANCEL", [undefined], { status: "cancelled", answers: {} }],
          ["ASK_STOP", [undefined], undefined],
          [
            "ASK_BATCH",
            ["SQLite", "Keep the API\nChange the layout", ""],
            {
              status: "answered",
              answers: {
                database: "SQLite",
                requirements: "Keep the API\nChange the layout",
                schedule: "",
              },
            },
          ],
          [
            "ASK_BATCH_CANCEL",
            ["SQLite", undefined],
            { status: "cancelled", answers: { database: "SQLite" } },
          ],
          ["ASK_BATCH_STOP", ["SQLite", undefined], undefined],
        ] as const) {
          yield* Effect.gen(function* () {
            const session = yield* sessions.open({
              cwd: fixture.root,
              sessionId: prompt,
              model: "piano-ask-test/local",
            });
            let question = yield* watch(session, (event) => event._tag === "dialog");
            yield* session.act({ _tag: "prompt", text: prompt });
            const first = (yield* Fiber.join(question)).find((event) => event._tag === "dialog");
            assert.ok(first?._tag === "dialog");
            let dialog = first.dialog;
            assert.equal(dialog.deadlineAt, null, "an ask_user question has no automatic expiry");
            assert.equal(dialog.deadlineKind, "tool-end");
            assert.ok(dialog.toolCallId, "the running ask_user call owns its question");
            const settled = yield* watch(
              session,
              (event) => event._tag === "state" && !event.state.isStreaming,
            );
            for (const [index, value] of values.entries()) {
              if (index > 0) {
                const next = (yield* Fiber.join(question)).find((event) => event._tag === "dialog");
                assert.ok(next?._tag === "dialog");
                dialog = next.dialog;
              }
              const batch = prompt.startsWith("ASK_BATCH");
              assert.equal(
                dialog.method,
                index === 0 && (batch || prompt === "ASK_CHOICE") ? "select" : "editor",
              );
              assert.equal(
                dialog.title,
                batch
                  ? [
                      "1 of 3: Which database?",
                      "2 of 3: What should change?",
                      "3 of 3: When should it ship?",
                    ][index]
                  : prompt === "ASK_CHOICE"
                    ? "Which database?"
                    : "What should change?",
              );
              if (dialog.method === "select")
                assert.deepEqual(dialog.options, ["PostgreSQL", "SQLite"]);
              const before = fixture.requests.filter((request) => request.prompt === prompt);
              assert.equal(before.length, 1, "no model turns between questions");
              assert.ok(before[0].tools.includes("ask_user"), "Piano's launch exposes the tool");
              if (index < values.length - 1)
                question = yield* watch(session, (event) => event._tag === "dialog");
              if (value === undefined && prompt.endsWith("STOP"))
                yield* session.act({ _tag: "stop" });
              else {
                const accepted = yield* watch(
                  session,
                  (event) =>
                    event._tag === "state" &&
                    event.state.dialogResolution?.id === dialog.id &&
                    event.state.dialogResolution?.delivery === "accepted",
                );
                yield* session.act({
                  _tag: "answer",
                  id: dialog.id,
                  generation: dialog.generation,
                  ...(value === undefined ? { cancelled: true } : { value }),
                });
                yield* Fiber.join(accepted);
              }
              const late = yield* session
                .act({
                  _tag: "answer",
                  id: dialog.id,
                  generation: dialog.generation,
                  value: "late reply",
                })
                .pipe(Effect.result);
              assert.equal(
                late._tag,
                "Failure",
                "an old question cannot overwrite an answer or answer the next one",
              );
            }
            const events = yield* Fiber.join(settled);
            assert.equal(
              events.filter((event) => event._tag === "dialog").length,
              values.length - 1,
              "cancellation/Stop must not open the rest of the batch",
            );
            const requests = fixture.requests.filter((request) => request.prompt === prompt);
            assert.equal(requests.length, expected ? 2 : 1);
            if (expected) {
              assert.equal(requests[1].results.length, 1);
              assert.deepEqual(JSON.parse(requests[1].results[0]), expected);
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
            if (expected) {
              const results = history.messages.filter((message) => message.role === "tool_result");
              assert.equal(results.length, 1, "Pi persists one result for the whole batch");
              assert.deepEqual(JSON.parse(results[0].text), expected);
            }
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
