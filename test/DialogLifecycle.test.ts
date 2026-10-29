import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { PiCli } from "../server/PiCli.ts";
import {
  PiDialogRecoveryMs,
  PiRequestTimeoutMs,
  type PiSession,
  PiSessions,
  PiSessionsLive,
} from "../server/PiSessions.ts";
import type { Dialog, SessionEvent } from "../shared/wire.ts";

const cli = {
  node: process.execPath,
  cli: new URL("./fake-dialog-pi.mjs", import.meta.url).pathname,
  extraArgs: [],
};
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(PiCli, cli),
    ),
  );
const watch = (session: PiSession, until: (event: SessionEvent) => boolean) =>
  Effect.gen(function* () {
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
const openDialog = (session: PiSession, text = "/dialog input") =>
  Effect.gen(function* () {
    const seen = yield* watch(session, (e) => e._tag === "dialog");
    const prompt = yield* session.act({ _tag: "prompt", text }).pipe(Effect.forkChild);
    const event = (yield* Fiber.join(seen)).find((e) => e._tag === "dialog");
    assert.ok(event?._tag === "dialog");
    return { dialog: event.dialog, prompt };
  });
const answer = (dialog: Dialog) => ({
  _tag: "answer" as const,
  id: dialog.id,
  generation: dialog.generation,
  value: "A",
});
const audit = (session: PiSession) =>
  Effect.gen(function* () {
    const seen = yield* watch(
      session,
      (e) => e._tag === "notice" && e.message.startsWith("audit "),
    );
    yield* session.act({ _tag: "prompt", text: "/audit" });
    const event = (yield* Fiber.join(seen)).find(
      (e) => e._tag === "notice" && e.message.startsWith("audit "),
    );
    assert.ok(event?._tag === "notice");
    return JSON.parse(event.message.slice(6)) as Array<{
      id: string;
      cancelled?: boolean;
      confirmed?: boolean;
      value?: string;
    }>;
  });
const snapshot = (session: PiSession) =>
  session.events.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map((events) => {
      assert.ok(events[0]._tag === "snapshot");
      return events[0].snapshot;
    }),
  );

test("INV-04: competing tabs claim one supported dialog before writing; late attachment never reopens it", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "dialog-race",
      });
      for (const method of ["input", "select", "confirm", "editor"]) {
        const { dialog, prompt } = yield* openDialog(session, `/dialog ${method}`);
        const response =
          method === "confirm"
            ? { ...answer(dialog), confirmed: false }
            : {
                ...answer(dialog),
                value:
                  method === "input" ? "" : method === "editor" ? "First line\nSecond line" : "A",
              };
        const other =
          method === "confirm" ? { ...response, confirmed: true } : { ...response, value: "B" };
        const outcomes = yield* Effect.all(
          [session.act(response).pipe(Effect.result), session.act(other).pipe(Effect.result)],
          { concurrency: "unbounded" },
        );
        assert.equal(outcomes.filter((result) => result._tag === "Success").length, 1);
        yield* Fiber.join(prompt);
        assert.equal(
          (yield* session.state).model,
          "fake/beta",
          "answering must not suppress the originating command's state reconciliation",
        );
        const records = (yield* audit(session)).filter((record) => record.id === dialog.id);
        assert.equal(
          records.length,
          1,
          "count actual extension_ui_response records, not local events",
        );
        const late = yield* snapshot(session);
        assert.deepEqual(late.dialogs, []);
        assert.equal(late.state.dialogResolution?.delivery, "written");
        assert.deepEqual(
          late.state.dialogResolution?.answer,
          {
            title: `Fixture ${dialog.id}`,
            value: records[0].confirmed ?? records[0].value,
          },
          "every attachment sees the winning reply, including false, empty and multiline answers",
        );
      }
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("INV-04: estimated timeout survives attachment, rejects expired answers, and races answers only once", {
  timeout: 10_000,
}, async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "dialog-timeout",
      });
      const first = yield* openDialog(session, "/dialog input 1000");
      assert.equal(first.dialog.timeoutMs, 1000);
      assert.equal(first.dialog.deadlineKind, "pi-timeout", "Pi's timeout precedes host recovery");
      assert.equal(first.dialog.deadlineAt - first.dialog.receivedAt, 1000);
      yield* TestClock.adjust(400);
      assert.equal(
        (yield* snapshot(session)).dialogs[0].deadlineAt,
        first.dialog.deadlineAt,
        "reload cannot reset the original host estimate",
      );
      const expired = yield* watch(session, (e) => e._tag === "dialog_resolved");
      yield* TestClock.adjust(600);
      yield* Fiber.join(expired);
      assert.equal((yield* session.act(answer(first.dialog)).pipe(Effect.result))._tag, "Failure");
      assert.deepEqual(
        yield* audit(session),
        [],
        "Pi owns advertised timeout; the host sends no answer after its estimate",
      );
      assert.equal((yield* session.state).dialogResolution?.reason, "expired");
      assert.equal((yield* session.state).dialogResolution?.answer, undefined);
      assert.deepEqual((yield* snapshot(session)).dialogs, []);
      // Controlled competition at the deadline: either answer or timeout may win,
      // but Pi must never receive two responses and late attachment stays closed.
      const second = yield* openDialog(session, "/dialog input 1000");
      yield* Effect.all(
        [session.act(answer(second.dialog)).pipe(Effect.result), TestClock.adjust(1000)],
        { concurrency: "unbounded" },
      );
      assert.ok(
        (yield* audit(session)).filter((record) => record.id === second.dialog.id).length <= 1,
      );
      assert.deepEqual((yield* snapshot(session)).dialogs, []);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
});

test("INV-04: invisible extension cancellation is bounded by an explicit host recovery policy", {
  timeout: 10_000,
}, async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "dialog-recovery",
      });
      // Without a Pi timeout, and with one later than the policy, host recovery bounds the dialog.
      for (const text of ["/dialog input", "/dialog input 120000"]) {
        const { dialog, prompt } = yield* openDialog(session, text);
        assert.equal(dialog.deadlineKind, "host-recovery");
        assert.equal(dialog.deadlineAt - dialog.receivedAt, 2000);
        const resolved = yield* watch(
          session,
          (e) =>
            e._tag === "state" &&
            e.state.dialogResolution?.id === dialog.id &&
            e.state.dialogResolution.delivery === "written",
        );
        yield* TestClock.adjust(2000);
        yield* Fiber.join(resolved);
        yield* Fiber.join(prompt);
        assert.deepEqual(
          (yield* audit(session)).filter((record) => record.id === dialog.id),
          [{ type: "extension_ui_response", id: dialog.id, cancelled: true }],
        );
        assert.equal((yield* session.state).dialogResolution?.reason, "recovery");
        assert.equal((yield* session.state).dialogResolution?.answer, undefined);
        assert.deepEqual((yield* snapshot(session)).dialogs, []);
      }
    }).pipe(
      Effect.scoped,
      Effect.provide(TestClock.layer()),
      Effect.provideService(PiDialogRecoveryMs, 2000),
    ),
  );
});

test("INV-02/04: abort releases pre-ack command dialogs, cancels arrivals, and a late abort cannot clear a new turn", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "dialog-abort",
      });
      yield* session.act({ _tag: "prompt", text: "/hold-abort" });
      const { dialog, prompt } = yield* openDialog(session);
      const cancelledArrival = yield* watch(
        session,
        (e) => e._tag === "notice" && e.message === "received d2",
      );
      const oldAbort = yield* session.act({ _tag: "abort" }).pipe(Effect.forkChild);
      // Competes with the abort's claim. Whichever wins must be the only write.
      yield* session.act(answer(dialog)).pipe(Effect.result);
      yield* Fiber.join(cancelledArrival);
      yield* Fiber.join(prompt);
      const nextDialog = yield* watch(session, (e) => e._tag === "dialog" && e.dialog.id === "d3");
      yield* session.act({ _tag: "prompt", text: "/new-turn" });
      yield* Fiber.join(nextDialog);
      yield* session.act({ _tag: "prompt", text: "/release-abort" });
      yield* Fiber.join(oldAbort);
      assert.equal((yield* session.state).isStreaming, true);
      assert.deepEqual(
        (yield* snapshot(session)).dialogs.map((d) => d.id),
        ["d3"],
      );
      const records = yield* audit(session);
      assert.equal(records.filter((record) => record.id === "d1").length, 1);
      assert.deepEqual(
        records.filter((record) => record.id === "d2"),
        [{ type: "extension_ui_response", id: "d2", cancelled: true }],
      );
      assert.equal(
        records.some((record) => record.id === "d3"),
        false,
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("INV-04: dialog identity rejects a stale tab after child restart", async () => {
  await run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const oldDialog = yield* Effect.scoped(
        Effect.gen(function* () {
          const old = yield* sessions.open({ cwd: process.cwd(), sessionId: "same-session" });
          return (yield* openDialog(old)).dialog;
        }),
      );
      const current = yield* sessions.open({ cwd: process.cwd(), sessionId: "same-session" });
      const { dialog, prompt } = yield* openDialog(current);
      assert.equal(
        dialog.id,
        oldDialog.id,
        "fixture deliberately reuses Pi's dialog ID across incarnations",
      );
      assert.notEqual(dialog.generation, oldDialog.generation);
      assert.equal((yield* current.act(answer(oldDialog)).pipe(Effect.result))._tag, "Failure");
      assert.deepEqual(yield* audit(current), []);
      yield* current.act(answer(dialog));
      yield* Fiber.join(prompt);
      assert.equal((yield* audit(current)).length, 1);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("INV-04: process exit retires a waiting dialog with an explicit outcome", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "dialog-exit",
      });
      const { dialog } = yield* openDialog(session);
      const closed = yield* watch(session, (e) => e._tag === "closed");
      yield* session.act({ _tag: "prompt", text: "/exit" }).pipe(Effect.ignore);
      yield* Fiber.join(closed);
      assert.deepEqual((yield* snapshot(session)).dialogs, []);
      assert.equal((yield* session.state).dialogResolution?.reason, "exited");
      assert.equal((yield* session.state).dialogResolution?.delivery, "not-sent");
      assert.equal((yield* session.act(answer(dialog)).pipe(Effect.result))._tag, "Failure");
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("INV-04: broken stdin is delivery-uncertain, never silently reopened or retried", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "dialog-pipe",
      });
      const { dialog } = yield* openDialog(session);
      const closedInput = yield* watch(
        session,
        (e) => e._tag === "notice" && e.message === "input closed",
      );
      yield* session
        .act({ _tag: "prompt", text: "/close-input" })
        .pipe(Effect.ignore, Effect.forkChild);
      yield* Fiber.join(closedInput);
      const stopped = yield* watch(session, (e) => e._tag === "closed");
      const failed = yield* session.act(answer(dialog)).pipe(Effect.result);
      assert.equal(failed._tag, "Failure");
      yield* Fiber.join(stopped);
      assert.equal(
        (yield* session.state).closure?._tag,
        "failed",
        "a broken input pipe cannot leave an uncontrollable live session",
      );
      assert.equal((yield* session.state).dialogResolution?.delivery, "uncertain");
      assert.deepEqual((yield* snapshot(session)).state.dialogResolution?.answer, {
        title: `Fixture ${dialog.id}`,
        value: "A",
      });
      assert.deepEqual((yield* snapshot(session)).dialogs, []);
      assert.equal((yield* session.act(answer(dialog)).pipe(Effect.result))._tag, "Failure");
    }).pipe(
      // Nothing here waits on this deadline; it only bounds a hang. A loaded machine can take
      // longer than 500ms to answer the startup read.
      Effect.provideService(PiRequestTimeoutMs, 3000),
      Effect.timeout("8 seconds"),
      Effect.scoped,
    ),
  );
});
