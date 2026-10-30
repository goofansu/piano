import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { PiCli } from "../server/PiCli.ts";
import { PiRequestTimeoutMs, PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import {
  type Attachment,
  Attachments,
  decodeClientMessage,
  type SessionEvent,
} from "../shared/wire.ts";

const fakeCli = {
  node: process.execPath,
  cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
  extraArgs: [],
};
const TestLayer = PiSessionsLive.pipe(Layer.provide(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer), Effect.provideService(PiCli, fakeCli)));

const collectUntil = <E>(
  events: Stream.Stream<SessionEvent, E>,
  pred: (e: SessionEvent) => boolean,
) =>
  events.pipe(
    Stream.takeUntil(pred),
    Stream.runCollect,
    Effect.map((c) => [...c]),
  );

const step = (...a: unknown[]) => {
  if (process.env.PIANO_DEBUG) console.error("[test]", ...a);
};

test("command discovery is read-only, distinguishes probe/live resources and keeps invocation precedence", async () => {
  await run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const preliminary = yield* sessions.probe(process.cwd());
      assert.ok(preliminary.commands.some((c) => c.name === "probe-only"));
      const session = yield* sessions.open({ cwd: process.cwd(), sessionId: "commands" });
      const before = yield* session.state;
      const commands = yield* session.commands;
      assert.ok(commands.some((c) => c.name === "live-only"));
      assert.equal(
        commands.some((c) => c.name === "probe-only"),
        false,
      );
      assert.deepEqual(
        commands.filter((c) => c.name === "handled"),
        [{ name: "handled", description: "Handle without a model call", source: "extension" }],
      );
      assert.deepEqual(
        yield* session.state,
        before,
        "discovery cannot submit work or alter run state",
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("Pi children omit Node watch reporting while preserving the rest of the environment", async () => {
  const previousWatch = process.env.WATCH_REPORT_DEPENDENCIES;
  const previousPreserved = process.env.PIANO_TEST_PRESERVED_ENV;
  process.env.WATCH_REPORT_DEPENDENCIES = "1";
  process.env.PIANO_TEST_PRESERVED_ENV = "preserved";
  try {
    await run(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const session = yield* sessions.open({
          cwd: process.cwd(),
          sessionId: "child-environment",
        });
        assert.equal((yield* session.state).sessionName, "env:preserved;image:accepted");
        const probe = yield* sessions.probe(process.cwd());
        assert.equal(
          probe.models.find((model) => model.id === "alpha")?.name,
          "env:preserved;image:accepted",
        );
      }).pipe(
        Effect.provideService(PiCli, { ...fakeCli, extraArgs: ["--verify-child-environment"] }),
        Effect.timeout("5 seconds"),
        Effect.scoped,
      ),
    );
  } finally {
    if (previousWatch === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
    else process.env.WATCH_REPORT_DEPENDENCIES = previousWatch;
    if (previousPreserved === undefined) delete process.env.PIANO_TEST_PRESERVED_ENV;
    else process.env.PIANO_TEST_PRESERVED_ENV = previousPreserved;
  }
});

for (const input of [
  "null",
  "17",
  "true",
  "[]",
  "{}",
  '{"type":7}',
  "not-json",
  '{"type":"response","id":"q3","command":"prompt","success":"yes"}',
  '{"type":"response","success":true}',
  "eof",
]) {
  test(`INV-03: invalid Pi output closes the session and settles pending input: ${input}`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: "protocol-failure",
        });
        const collector = yield* collectUntil(session.events, (e) => e._tag === "closed").pipe(
          Effect.forkChild,
        );
        const error = yield* session
          .act({ _tag: "prompt", text: input === "eof" ? "protocol eof" : `protocol raw:${input}` })
          .pipe(Effect.flip);
        assert.notEqual(
          error.reason,
          "timeout",
          "pending input must fail without waiting for its acknowledgement deadline",
        );
        const events = yield* Fiber.join(collector);
        const last = events.at(-1);
        assert.ok(last?._tag === "closed");
        assert.equal(last.closure._tag, "failed");
        assert.match(last.closure.detail, /Pi stdout|Pi protocol/);
        assert.equal((yield* session.state).closure?._tag, "failed");
        assert.equal(
          (yield* session.act({ _tag: "prompt", text: "later" }).pipe(Effect.flip)).reason,
          "exited",
        );
      }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
    );
  });
}

test("INV-03: a stdout reader defect fails readiness instead of stranding open", async () => {
  const brokenReader = Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return {
        ...spawner,
        spawn: Effect.fn("Test.spawn")(function* (...args: Parameters<typeof spawner.spawn>) {
          const handle = yield* spawner.spawn(...args);
          return { ...handle, stdout: Stream.die(new Error("reader defect sentinel")) };
        }),
      };
    }),
  ).pipe(Layer.provide(NodeServices.layer));
  await Effect.runPromise(
    Effect.gen(function* () {
      const error = yield* (yield* PiSessions)
        .open({ cwd: process.cwd(), sessionId: "reader-failure" })
        .pipe(Effect.flip);
      assert.notEqual(error.reason, "timeout");
      assert.match(error.detail, /Pi stdout reader failed/);
      assert.equal(
        error.detail.includes("reader defect sentinel"),
        false,
        "raw failure content is not exposed",
      );
    }).pipe(
      Effect.provide(PiSessionsLive.pipe(Layer.provide(brokenReader))),
      Effect.provideService(PiCli, fakeCli),
      Effect.timeout("5 seconds"),
      Effect.scoped,
    ),
  );
});

for (const mode of ["clean", "abnormal", "truncated", "stuck", "descendant"]) {
  test(`INV-03/05: process exit drains final stdout before closure: ${mode}`, async () => {
    const releaseOutput = Deferred.makeUnsafe<void>();
    const processExited = Deferred.makeUnsafe<void>();
    let holdOutput = false;
    // Keep the real process, pipes, transport and session projection. Control only
    // the OS-reader scheduling: final bytes cannot reach Piano until exit resolves.
    const delayedReader = Layer.effect(
      ChildProcessSpawner.ChildProcessSpawner,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        return {
          ...spawner,
          spawn: Effect.fn("Test.spawn")(function* (...args: Parameters<typeof spawner.spawn>) {
            const handle = yield* spawner.spawn(...args);
            return {
              ...handle,
              exitCode: handle.exitCode.pipe(
                Effect.tap(() => Deferred.succeed(processExited, undefined)),
              ),
              stdout: handle.stdout.pipe(
                Stream.mapEffect((chunk) =>
                  holdOutput
                    ? Deferred.await(releaseOutput).pipe(Effect.as(chunk))
                    : Effect.succeed(chunk),
                ),
                // An inherited stdout can remain open after its process exits.
                Stream.concat(mode === "stuck" ? Stream.never : Stream.empty),
              ),
            };
          }),
        };
      }),
    ).pipe(Layer.provide(NodeServices.layer));
    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: `exit-tail-${mode}`,
        });
        const collector = yield* collectUntil(session.events, (e) => e._tag === "closed").pipe(
          Effect.forkChild,
        );
        holdOutput = true;
        const prompt = yield* session
          .act({ _tag: "prompt", text: `exit tail ${mode}` })
          .pipe(Effect.result, Effect.forkChild);
        yield* Deferred.await(processExited);
        // Let the transport's exit observer run before releasing the held bytes.
        yield* Effect.yieldNow;
        const stoppedInput = yield* session.commands.pipe(
          Effect.flip,
          Effect.timeout("250 millis"),
        );
        assert.equal(
          stoppedInput.reason,
          "exited",
          "exit must stop new input without waiting for stdout",
        );
        yield* Deferred.succeed(releaseOutput, undefined);
        const result = yield* Fiber.join(prompt);
        const events = yield* Fiber.join(collector);
        assert.ok(
          events.some(
            (e) => e._tag === "message_end" && e.message.text === "Final reply before exit",
          ),
          "final assistant text must survive early process exit",
        );
        const last = events.at(-1);
        assert.ok(last?._tag === "closed");
        assert.equal(events.filter((e) => e._tag === "closed").length, 1);
        if (mode === "truncated" || mode === "descendant") {
          assert.equal(
            result._tag,
            "Failure",
            "missing or partial responses cannot acknowledge input",
          );
          assert.equal((yield* session.state).submission?.outcome, "uncertain");
          assert.equal(last.closure._tag, "failed");
          assert.match(
            last.closure.detail,
            mode === "truncated" ? /malformed JSON/ : /stdout.*drain.*timed out/i,
          );
        } else {
          assert.equal(
            result._tag,
            "Success",
            "the actual delayed acknowledgement must reach its caller",
          );
          assert.equal((yield* session.state).submission?.outcome, "started");
          assert.ok(
            events.some((e) => e._tag === "response_completed"),
            "agent_settled must be published before closure",
          );
          if (mode === "stuck") {
            assert.equal(last.closure._tag, "failed");
            assert.match(last.closure.detail, /stdout.*drain.*timed out/i);
          } else {
            assert.equal(last.closure._tag, "exited");
            assert.equal(
              last.closure._tag === "exited" && last.closure.code,
              mode === "abnormal" ? 3 : 0,
            );
          }
        }
      }).pipe(
        Effect.provide(PiSessionsLive.pipe(Layer.provide(delayedReader))),
        Effect.provideService(PiCli, fakeCli),
        Effect.timeout("5 seconds"),
        Effect.scoped,
      ),
    );
  });
}

test("unknown Pi event types remain forward compatible", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "future" });
      yield* session.act({ _tag: "prompt", text: "protocol future" });
      assert.equal((yield* session.state).closure, undefined);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

for (const sessionId of ["startup-overlap", "startup-overlap-identical", "startup-during-read"]) {
  test(`startup history reconciles before the first snapshot: ${sessionId}`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId });
        const frames = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
        assert.equal(frames[0]._tag, "snapshot");
        if (frames[0]._tag !== "snapshot") return;
        assert.deepEqual(
          frames[0].snapshot.messages.map((message) => [message.id, message.text]),
          sessionId.endsWith("identical")
            ? [
                ["m0", "STARTUP-NOTICE"],
                ["m1", "STARTUP-NOTICE"],
              ]
            : [["m0", "STARTUP-NOTICE"]],
        );
        assert.equal(frames[0].snapshot.state.projectionError, undefined);
      }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
    );
  });
}

test("opening reads Pi's context once", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "context-reads",
      });
      const frames = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      assert.equal(frames[0]._tag, "snapshot");
      if (frames[0]._tag !== "snapshot") return;
      assert.deepEqual(
        frames[0].snapshot.messages.map((message) => message.text),
        ["context reads: 1"],
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

for (const role of ["custom", "assistant"]) {
  test(`startup ${role} history visible before delayed message_end preserves dialogs and correlation`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: `startup-delayed-${role}`,
        });
        const initial = (yield* session.events.pipe(Stream.take(1), Stream.runCollect))[0];
        assert.equal(initial._tag, "snapshot");
        if (initial._tag !== "snapshot") return;
        const snapshot = initial.snapshot;
        assert.equal(
          snapshot.state.projectionError,
          undefined,
          "a running message defers the context without a warning",
        );
        assert.deepEqual(
          snapshot.messages,
          [],
          "unfinished history is not installed ahead of its end event",
        );
        assert.deepEqual(snapshot.state.extension?.statuses, [
          { key: "startup", text: "Waiting for startup answer" },
        ]);
        assert.equal(snapshot.tools?.[0].id, "startup-tool");
        if (role === "assistant") assert.equal(snapshot.pending?.text, "STARTUP-PARTIAL");
        assert.equal(snapshot.dialogs.length, 1);
        const dialog = snapshot.dialogs[0];
        const ready = yield* Deferred.make<void>();
        const collector = yield* collectUntil(
          session.events.pipe(
            Stream.tap((event) =>
              event._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
            ),
          ),
          (event) =>
            event._tag === "context" &&
            event.messages.some((message) => message.text === "STARTUP-FINAL"),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        yield* session.act({
          _tag: "answer",
          id: dialog.id,
          generation: dialog.generation,
          value: "continue",
        });
        const seen = yield* Fiber.join(collector);
        const ends = seen.flatMap((event) => (event._tag === "message_end" ? [event.message] : []));
        assert.deepEqual(
          ends.map((message) => [message.id, message.text]),
          [["m0", "STARTUP-FINAL"]],
        );
        if (role === "assistant") assert.equal(ends[0].id, snapshot.pending?.id);
        const final = (yield* session.events.pipe(Stream.take(1), Stream.runCollect))[0];
        assert.equal(final._tag, "snapshot");
        if (final._tag !== "snapshot") return;
        assert.equal(final.snapshot.state.projectionError, undefined);
        assert.deepEqual(
          final.snapshot.messages.map((message) => [message.id, message.text]),
          [["m0", "STARTUP-FINAL"]],
        );
        assert.equal(final.snapshot.dialogs.length, 0);
        assert.equal(final.snapshot.tools?.[0].id, "startup-tool");
        assert.equal(final.snapshot.tools?.[0].status, "success");
      }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
    );
  });
}

for (const sessionId of ["startup-read-failure", "startup-churn", "startup-read-exit"]) {
  test(`startup reconciliation has a bounded explicit outcome: ${sessionId}`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId });
        if (sessionId === "startup-read-exit") {
          yield* collectUntil(
            session.events,
            (event) =>
              event._tag === "closed" ||
              (event._tag === "snapshot" && !!event.snapshot.state.closure),
          );
          assert.ok((yield* session.state).closure);
          return;
        }
        assert.match(
          (yield* session.state).projectionError ?? "",
          sessionId === "startup-churn" ? /Pi context changed/ : /startup read failed/,
        );
        assert.ok((yield* session.commands).length, "recovery controls remain usable");
      }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
    );
  });
}

test("a submission names the caller's input, for a steer as for a prompt", async () => {
  await run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "input-ids" });
      yield* t.act({ _tag: "prompt", text: "handled queue", inputId: "prompted" });
      assert.equal((yield* t.state).submission?.inputId, "prompted");
      yield* t.act({ _tag: "steer", text: "handled queue", inputId: "steered" });
      const submission = (yield* t.state).submission;
      assert.equal(submission?.outcome, "handled");
      assert.equal(submission?.inputId, "steered");
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("a prompt Pi starts before its agent_start arrives shows no projection error", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "late-start" });
      yield* t.act({ _tag: "prompt", text: "late start" });
      assert.equal((yield* t.state).projectionError, undefined, "a busy Pi is not an error");
      const ends = yield* collectUntil(
        t.events,
        (e) => e._tag === "state" && e.state.isStreaming === false,
      );
      assert.ok(ends.length > 0);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("snapshot first, then a streamed turn", async () => {
  const seen = await run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s1", model: "fake/alpha" });
      step("opened");
      const ready = yield* Deferred.make<void>();
      const collector = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "state" && !e.state.isStreaming,
      ).pipe(Effect.forkChild);
      step("collector forked");
      yield* Deferred.await(ready);
      yield* t.act({ _tag: "prompt", text: "hello" });
      step("prompted");
      const events = yield* Fiber.join(collector);
      step("collected", events.length);
      assert.equal((yield* t.state).submission?.outcome, "started");
      assert.equal(
        (yield* t.state).isStreaming,
        false,
        "acceptance must not reactivate a completed run",
      );
      return events;
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
  step("scope closed");
  assert.equal(seen[0]._tag, "snapshot");
  assert.equal(
    (seen[0] as Extract<SessionEvent, { _tag: "snapshot" }>).snapshot.state.model,
    "fake/alpha",
  );
  const tags = seen.map((e) => e._tag);
  assert.ok(tags.includes("message_update"), "streams partials");
  const reply = seen.find((e) => e._tag === "message_end" && e.message.role === "assistant");
  assert.ok(reply && reply._tag === "message_end");
  assert.equal(reply.message.text, "echo: hello");
  // The browser keys a reply by its id: a partial that changed id on its end would remount it.
  assert.deepEqual(
    [...new Set(seen.flatMap((e) => (e._tag === "message_update" ? [e.message.id] : [])))],
    [reply.message.id],
    "a streaming reply keeps the id of the message it becomes",
  );
  const ids = seen.flatMap((e) => (e._tag === "message_end" ? [e.message.id] : []));
  assert.equal(new Set(ids).size, ids.length, "final messages have distinct ids");
});

test("the readback that settles a turn keeps the ids its live messages carried", async () => {
  const seen = await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "readback-ids" });
      const ready = yield* Deferred.make<void>();
      const collector = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "context" && e.messages.some((m) => m.text === "echo: second"),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      yield* t.act({ _tag: "prompt", text: "first" });
      yield* t.act({ _tag: "prompt", text: "second" });
      return yield* Fiber.join(collector);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
  // The browser keys transcript rows by id: a readback that renumbered the run's messages would
  // remount every row it showed live, closing its folds.
  const live = seen.flatMap((e) =>
    e._tag === "message_end" ? [[e.message.id, e.message.text] as const] : [],
  );
  const context = seen.findLast((e) => e._tag === "context");
  assert.ok(context && context._tag === "context");
  assert.deepEqual(
    live,
    context.messages.map((m) => [m.id, m.text] as const),
  );
});

for (const separator of [" ", "\n\n", "\r\n", "\t"]) {
  test(`a skill prompt with separator ${JSON.stringify(separator)} arrives with its skill file folded`, async () => {
    const seen = await run(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "skill" });
        const ready = yield* Deferred.make<void>();
        const collector = yield* collectUntil(
          t.events.pipe(
            Stream.tap((e) =>
              e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
            ),
          ),
          (e) => e._tag === "state" && !e.state.isStreaming,
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        yield* t.act({
          _tag: "prompt",
          text: `/skill:research${separator}the Effect 4 RC changelog`,
        });
        const events = yield* Fiber.join(collector);
        // A fresh subscriber reads the same split from Pi's retained history, not from the live event.
        const snapshot = yield* collectUntil(t.events, (e) => e._tag === "snapshot");
        return { events, snapshot };
      }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
    );
    const prompt = seen.events.find((e) => e._tag === "message_end" && e.message.role === "user");
    assert.ok(prompt && prompt._tag === "message_end");
    assert.deepEqual(
      { text: prompt.message.text, skill: prompt.message.skill },
      {
        text: "the Effect 4 RC changelog",
        skill: {
          name: "research",
          location: "/fake/skills/research/SKILL.md",
          body: "# research\n\nFake skill body for **research**.",
        },
      },
    );
    const replayed = (
      seen.snapshot[0] as Extract<SessionEvent, { _tag: "snapshot" }>
    ).snapshot.messages.find((m) => m.role === "user");
    assert.deepEqual(
      { text: replayed?.text, skill: replayed?.skill },
      { text: prompt.message.text, skill: prompt.message.skill },
    );
  });
}

const image: Attachment = {
  kind: "image",
  name: "pixel.png",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=",
};

test("image-only prompts reach Pi and survive authoritative refresh and late snapshots without embedding bytes", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "images" });
      // Pi acknowledges a prompt before it sends the user message, so wait for the run to settle.
      const ready = yield* Deferred.make<void>();
      const settled = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "state" && !e.state.isStreaming,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      yield* t.act({ _tag: "prompt", text: "", attachments: [image] });
      yield* Fiber.join(settled);
      // A late subscriber reads the image-only prompt from Pi's retained history.
      const events = yield* collectUntil(t.events, (e) => e._tag === "snapshot");
      const event = events[0];
      assert.ok(event._tag === "snapshot");
      const user = event.snapshot.messages.find((m) => m.role === "user");
      assert.equal(user?.text, "");
      assert.match(user?.attachments?.[0].url ?? "", /^\/api\/image-previews\/[a-f0-9]{64}$/);
      assert.equal(
        JSON.stringify(event).includes(image.data),
        false,
        "image history cannot exhaust WS snapshot limits",
      );
      const invalid = yield* t
        .act({
          _tag: "prompt",
          text: "bad image",
          attachments: [{ ...image, mimeType: "image/jpeg" }],
        })
        .pipe(Effect.flip);
      assert.equal(invalid.reason, "rejected");
      yield* t.act({ _tag: "prompt", text: "ask me" });
      yield* t.act({ _tag: "steer", text: "image", attachments: [image] });
      yield* t.act({ _tag: "prompt", text: "", attachments: [image] });
      assert.deepEqual(
        yield* t.act({ _tag: "restore_queue" }),
        {
          _tag: "queue_restored",
          messages: [
            { kind: "steering", text: "image" },
            { kind: "follow-up", text: "" },
          ],
        },
        "editing queued images restores only text, including an image-only message",
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("upload wire rejects unsupported kinds, oversized payloads and malformed base64", () => {
  const command = (attachments: unknown) =>
    JSON.stringify({
      _tag: "create_session",
      selectionId: "s",
      cwd: "/tmp",
      options: {},
      text: "",
      attachments,
    });
  assert.deepEqual(decodeClientMessage(command([image]))._tag, "create_session");
  for (const attachments of [
    [{ ...image, kind: "file" }],
    [{ ...image, mimeType: "image/svg+xml" }],
    [{ ...image, data: "not base64" }],
    [{ ...image, data: "" }],
    Array(5).fill(image),
    [{ ...image, data: "A".repeat(4 * Math.ceil((10 * 1024 * 1024) / 3) + 4) }],
  ])
    assert.throws(() => decodeClientMessage(command(attachments)));
});

test("upload limits accept 10 MiB per image and 20 MiB total, but not one byte more", () => {
  const sized = (bytes: number): Attachment => ({
    ...image,
    data: Buffer.alloc(bytes).toString("base64"),
  });
  const accepts = Schema.is(Attachments);
  const ten = sized(10 * 1024 * 1024);
  assert.equal(accepts([ten, ten]), true, "exact per-image and aggregate boundaries");
  assert.equal(
    accepts(Array(4).fill(sized(5 * 1024 * 1024))),
    true,
    "four images at the total boundary",
  );
  assert.equal(
    accepts([sized(10 * 1024 * 1024 + 1)]),
    false,
    "per-image overflow even when base64 length is unchanged",
  );
  assert.equal(
    accepts([ten, ten, sized(1)]),
    false,
    "aggregate overflow with individually valid images",
  );
  assert.equal(accepts(Array(5).fill(image)), false, "count policy stays at four");
});

test("handled input acknowledges consumption without starting work or inventing history", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "handled" });
      const ready = yield* Deferred.make<void>();
      const collector = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "submission" && e.submission.outcome === "handled",
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      yield* t.act({ _tag: "prompt", text: "/handled" });
      const events = yield* Fiber.join(collector);
      assert.equal(
        events.some((e) => e._tag === "message_end"),
        false,
      );
      const state = yield* t.state;
      assert.equal(state.submission?.outcome, "handled");
      assert.equal(state.isStreaming, false);
      assert.equal(state.model, "fake/beta", "reconcile extension-command state from Pi");
      assert.equal(state.thinkingLevel, "high");
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("a dispatched session's first live snapshot names its parent while usage is still unread", async () => {
  await run(
    Effect.gen(function* () {
      // Cached statistics: open does not wait for usage, which this Pi never answers.
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "held-usage-dispatched",
        dispatchedFrom: "the-parent",
        lastKnownStats: { cost: 0.5, statsUpdatedAt: 1 },
      });
      assert.equal((yield* session.state).dispatchedFrom, "the-parent");
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("a session whose entries Pi refuses still opens, without its parent", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "rejected-entries-dispatched",
        dispatchedFrom: "the-parent",
      });
      const state = yield* session.state;
      assert.equal(state.sessionId, "rejected-entries-dispatched");
      assert.equal(state.dispatchedFrom, undefined);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("canonical context updates after a response and compaction while still running", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "live" });
      assert.equal((yield* t.state).context?.tokens, 0, "initial authoritative stats");
      const ready = yield* Deferred.make<void>();
      let sawDialog = false,
        sawUsage = false;
      const collector = yield* t.events.pipe(
        Stream.tap((e) =>
          e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
        ),
        Stream.takeUntil((e) => {
          if (e._tag === "dialog" && e.dialog.id === "live1") sawDialog = true;
          if (e._tag === "state" && e.state.context?.tokens === 42000) sawUsage = true;
          return sawDialog && sawUsage;
        }),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(ready);
      yield* t.act({ _tag: "prompt", text: "live context" });
      const events = yield* Fiber.join(collector);
      assert.ok(
        events.some(
          (e) => e._tag === "state" && e.state.isStreaming && e.state.context?.tokens === 42000,
        ),
        "publishes latest canonical context before settlement",
      );
      assert.equal((yield* t.state).context?.percent, 21);
      const compactReady = yield* Deferred.make<void>();
      let sawCompactedDialog = false,
        sawCompactedUsage = false;
      const compacted = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(compactReady, undefined) : Effect.void,
          ),
        ),
        (e) => {
          if (e._tag === "dialog" && e.dialog.id === "live2") sawCompactedDialog = true;
          if (e._tag === "state" && e.state.context?.tokens === null) sawCompactedUsage = true;
          return sawCompactedDialog && sawCompactedUsage;
        },
      ).pipe(Effect.forkChild);
      yield* Deferred.await(compactReady);
      const dialog = events.find((e) => e._tag === "dialog");
      assert.ok(dialog?._tag === "dialog");
      yield* t.act({
        _tag: "answer",
        id: "live1",
        generation: dialog.dialog.generation,
        value: "continue",
      });
      yield* Fiber.join(compacted);
      const state = yield* t.state;
      assert.equal(state.isStreaming, true);
      assert.deepEqual(
        state.context,
        { tokens: null, contextWindow: 200000, percent: null },
        "does not retain pre-compaction usage or substitute an estimate",
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("model switch refreshes the authoritative context window", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "context-model" });
      assert.equal((yield* t.state).context?.contextWindow, 200000);
      yield* t.act({ _tag: "set_model", model: "fake/beta" });
      assert.equal((yield* t.state).context?.contextWindow, 400000);
    }).pipe(Effect.scoped),
  );
});

test("late subscriber sees transcript and a retained dialog; answering resolves it", async () => {
  const result = await run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s2" });
      const ready = yield* Deferred.make<void>();
      const first = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "dialog",
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      yield* t.act({ _tag: "prompt", text: "ask me" });
      yield* Fiber.join(first);
      // A second client attaches after the dialog was raised.
      const late = yield* collectUntil(t.events, (e) => e._tag === "snapshot").pipe(
        Effect.map((es) => es[0]),
      );
      const snap = (late as Extract<SessionEvent, { _tag: "snapshot" }>).snapshot;
      const answerReady = yield* Deferred.make<void>();
      const after = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(answerReady, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "state" && !e.state.isStreaming,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(answerReady);
      yield* t.act({
        _tag: "answer",
        id: snap.dialogs[0].id,
        generation: snap.dialogs[0].generation,
        value: "42",
      });
      const events = yield* Fiber.join(after);
      return { snap, events, state: yield* t.state };
    }).pipe(Effect.scoped),
  );
  assert.equal(result.snap.dialogs.length, 1);
  assert.equal(result.snap.dialogs[0].method, "input");
  assert.equal(result.snap.messages.length, 1, "user message already in transcript");
  assert.ok(result.events.some((e) => e._tag === "dialog_resolved"));
  assert.ok(result.events.some((e) => e._tag === "notice" && e.message.includes("42")));
  assert.equal(result.state.isStreaming, false);
});

test("naming a session goes through Pi and reads back in state", async () => {
  const result = await run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s-name" });
      const before = (yield* t.state).sessionName;
      yield* t.act({ _tag: "set_name", name: "  Renamed\nthrough piano  " });
      const after = (yield* t.state).sessionName;
      const empty = yield* t.act({ _tag: "set_name", name: "  " }).pipe(Effect.flip);
      return { before, after, empty };
    }).pipe(Effect.scoped),
  );
  assert.equal(result.before, "fake");
  assert.equal(result.after, "Renamed through piano");
  assert.equal(result.empty.reason, "rejected");
});

test("model switch and child crash", async () => {
  const result = await run(
    Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const t = yield* sessions.open({ cwd: process.cwd(), sessionId: "s3" });
      yield* t.act({ _tag: "set_model", model: "fake/beta" });
      yield* t.act({ _tag: "set_thinking_level", level: "high" });
      const { model, thinkingLevel } = yield* t.state;
      const closed = yield* collectUntil(t.events, (e) => e._tag === "closed").pipe(
        Effect.forkChild,
      );
      yield* t.act({ _tag: "prompt", text: "crash now" }).pipe(Effect.ignore);
      const events = yield* Fiber.join(closed);
      const failed = yield* t.act({ _tag: "abort" }).pipe(Effect.flip);
      return { model, thinkingLevel, events, failed };
    }).pipe(Effect.scoped),
  );
  assert.equal(result.model, "fake/beta");
  assert.equal(result.thinkingLevel, "high");
  const closed = result.events[result.events.length - 1] as Extract<
    SessionEvent,
    { _tag: "closed" }
  >;
  assert.equal(closed._tag, "closed");
  assert.equal(
    closed.closure._tag === "exited" && closed.closure.code,
    3,
    "a crash is an exit, not a release",
  );
  assert.match(closed.closure.detail, /code 3: boom/);
  assert.ok(
    result.events.some((e) => e._tag === "message_end" && e.message.text === "crash now"),
    "output already read before exit is not discarded",
  );
  assert.equal(result.failed.reason, "exited");
});

test("a write failing as Pi crashes closes with the exit, not a transport failure", async () => {
  const closure = await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "s-stdin" });
      const closed = yield* collectUntil(t.events, (e) => e._tag === "closed").pipe(
        Effect.forkChild,
      );
      yield* t.act({ _tag: "prompt", text: "close stdin then crash" });
      // Pi has closed its stdin; this write fails while the process is still exiting.
      yield* t.act({ _tag: "set_thinking_level", level: "high" }).pipe(Effect.ignore);
      const events = yield* Fiber.join(closed);
      return (events[events.length - 1] as Extract<SessionEvent, { _tag: "closed" }>).closure;
    }).pipe(Effect.scoped),
  );
  assert.equal(closure._tag === "exited" && closure.code, 3, JSON.stringify(closure));
  assert.match(closure.detail, /code 3: boom/);
});

test("Pi that keeps running with unusable stdin closes as a transport failure", async () => {
  const closure = await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "s-stdin-alive" });
      const closed = yield* collectUntil(t.events, (e) => e._tag === "closed").pipe(
        Effect.forkChild,
      );
      yield* t.act({ _tag: "prompt", text: "close stdin and keep running" });
      yield* t.act({ _tag: "set_thinking_level", level: "high" }).pipe(Effect.ignore);
      const events = yield* Fiber.join(closed);
      return (events[events.length - 1] as Extract<SessionEvent, { _tag: "closed" }>).closure;
    }).pipe(Effect.scoped),
  );
  assert.equal(closure._tag, "failed");
  assert.match(closure.detail, /Pi stdin failed/);
});

test("Pi's steering and follow-up queues remain paused after abort and can be restored without starting work", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "queue" });
      const ready = yield* Deferred.make<void>();
      const queued = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "queue_update" && e.messages.length === 4,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      yield* t.act({ _tag: "prompt", text: "ask queue" });
      yield* t.act({ _tag: "prompt", text: "expand queue" });
      yield* t.act({ _tag: "prompt", text: "duplicate" });
      yield* t.act({ _tag: "prompt", text: "duplicate" });
      yield* t.act({ _tag: "steer", text: "expand queue" });
      const observed = yield* Fiber.join(queued).pipe(Effect.timeoutOption("2 seconds"));
      assert.equal(observed._tag, "Some", "Pi's queue_update must reach session subscribers");
      const expected = [
        { kind: "steering", text: "expanded steering" },
        { kind: "follow-up", text: "expanded follow-up" },
        { kind: "follow-up", text: "duplicate" },
        { kind: "follow-up", text: "duplicate" },
      ];
      assert.deepEqual(
        (yield* t.state).queuedMessages,
        expected,
        "show Pi's expanded text, including duplicates, not a client-side guess",
      );
      const late = yield* t.events.pipe(Stream.take(1), Stream.runCollect);
      assert.equal(late[0]._tag, "snapshot");
      if (late[0]._tag === "snapshot")
        assert.deepEqual(late[0].snapshot.state.queuedMessages, expected);
      yield* t.act({ _tag: "steer", text: "handled queue" });
      assert.equal((yield* t.state).submission?.outcome, "handled");
      yield* t.act({ _tag: "steer", text: "reject queue" }).pipe(Effect.flip);
      assert.equal((yield* t.state).submission?.outcome, "rejected");
      assert.deepEqual(
        (yield* t.state).queuedMessages,
        expected,
        "handled/rejected input does not create phantom queue entries",
      );
      const drainReady = yield* Deferred.make<void>();
      const drained = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(drainReady, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "state" && !e.state.isStreaming,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(drainReady);
      yield* t.act({ _tag: "abort" });
      const events = yield* Fiber.join(drained);
      assert.deepEqual((yield* t.state).queuedMessages, expected, "abort leaves Pi's queue paused");
      assert.equal(
        events.filter(
          (e) =>
            e._tag === "message_end" && e.message.role === "user" && e.message.text === "duplicate",
        ).length,
        0,
        "abort must not automatically resend pending input",
      );
      const restoreReady = yield* Deferred.make<void>();
      const cleared = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(restoreReady, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "queue_update" && e.messages.length === 0,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(restoreReady);
      const result = yield* t.act({ _tag: "restore_queue" });
      assert.deepEqual(
        result,
        { _tag: "queue_restored", messages: expected },
        "return Pi's text to the requesting caller, including duplicates",
      );
      const restoreEvents = yield* Fiber.join(cleared);
      assert.deepEqual((yield* t.state).queuedMessages, []);
      assert.equal((yield* t.state).isStreaming, false);
      assert.equal(
        restoreEvents.some((e) => e._tag === "message_end"),
        false,
        "restoring does not create history or model work",
      );
      assert.deepEqual(
        yield* t.act({ _tag: "restore_queue" }),
        { _tag: "queue_restored", messages: [] },
        "an empty queue restores nothing",
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

for (const mode of ["success", "abort-failure", "abort-exit", "clear-failure", "concurrent"]) {
  test(`composer Stop takes the queue before abort: ${mode}`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* PiSessions).open({
          cwd: process.cwd(),
          sessionId: `stop-${mode}`,
        });
        yield* session.act({ _tag: "prompt", text: "ask queue" });
        yield* session.act({ _tag: "steer", text: "duplicate", attachments: [image] });
        yield* session.act({ _tag: "prompt", text: "duplicate", attachments: [image] });
        const expected = [
          { kind: "steering", text: "duplicate" },
          { kind: "follow-up", text: "duplicate" },
        ];
        const ready = yield* Deferred.make<void>();
        const cleared = yield* collectUntil(
          session.events.pipe(
            Stream.tap((e) =>
              e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
            ),
          ),
          (e) => e._tag === "queue_update" && e.messages.length === 0,
        ).pipe(Effect.forkChild);
        yield* Deferred.await(ready);
        if (mode === "clear-failure") {
          const error = yield* session.act({ _tag: "stop" }).pipe(Effect.flip);
          assert.match(error.detail, /fixture clear failed/);
          assert.deepEqual((yield* session.state).queuedMessages, expected);
          assert.equal((yield* session.state).isStreaming, true, "failed clear must not abort");
          assert.equal(
            (yield* session.state).isStopping,
            false,
            "failed clear releases the composer",
          );
          return;
        }
        const stop = yield* session.act({ _tag: "stop" }).pipe(Effect.forkChild);
        yield* Fiber.join(cleared);
        if (mode === "concurrent") {
          assert.equal(
            (yield* session.state).isStopping,
            true,
            "subscribers can disable sending while Stop is pending",
          );
          for (const action of [
            { _tag: "stop" },
            { _tag: "restore_queue" },
            { _tag: "abort" },
            { _tag: "steer", text: "racing input" },
            { _tag: "prompt", text: "racing input" },
          ] as const) {
            assert.equal((yield* session.act(action).pipe(Effect.flip)).reason, "rejected");
          }
          yield* session.commands; // release the held clear acknowledgement
        }
        const result = yield* Fiber.join(stop);
        assert.equal(result?._tag, "queue_restored");
        if (result?._tag !== "queue_restored") return;
        assert.deepEqual(result.messages, expected);
        assert.equal((yield* session.state).isStopping, false);
        assert.deepEqual((yield* session.state).queuedMessages, []);
        if (mode === "abort-failure" || mode === "abort-exit") {
          assert.match(
            result.stopError ?? "",
            /Stop failed:/,
            "partial failure must reach the caller even after the event stream closes",
          );
          if (mode === "abort-failure")
            assert.match(result.stopError ?? "", /fixture abort failed/);
        } else {
          assert.equal(result.stopError, undefined);
          assert.equal(
            (yield* session.state).dialogResolution?.reason,
            "aborted",
            "Stop retains native dialog cancellation",
          );
        }
      }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
    );
  });
}

test("busy input preserves extension commands and retry/compaction remain active after agent_end", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "activity" });
      // Each observation is installed before its action, including immediate transitions.
      const actUntil = (text: string, pred: (e: SessionEvent) => boolean) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>();
          const collector = yield* collectUntil(
            t.events.pipe(
              Stream.tap((e) =>
                e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
              ),
            ),
            pred,
          ).pipe(Effect.forkChild);
          yield* Deferred.await(ready);
          const result = yield* t.act({ _tag: "prompt", text }).pipe(Effect.result);
          const events = yield* Fiber.join(collector);
          return { result, events };
        });
      yield* actUntil("ask queue", (e) => e._tag === "dialog");
      yield* actUntil(
        "expand queue",
        (e) => e._tag === "submission" && e.submission.outcome === "queued",
      );
      assert.deepEqual((yield* t.state).queuedMessages, [
        { kind: "follow-up", text: "expanded follow-up" },
      ]);
      yield* actUntil(
        "/handled",
        (e) => e._tag === "submission" && e.submission.outcome === "handled",
      );
      assert.equal(
        (yield* t.state).model,
        "fake/beta",
        "busy commands go through prompt, not follow_up",
      );
      yield* actUntil("/retry", (e) => e._tag === "state" && !!e.state.isRetrying);
      assert.equal((yield* t.state).isStreaming, true, "agent_end is not settlement");
      yield* actUntil("/compact", (e) => e._tag === "state" && !!e.state.isCompacting);
      assert.equal((yield* t.state).isStreaming, true);
      assert.equal((yield* t.state).isRetrying, true, "independent facts may overlap");
      const rejected = yield* actUntil(
        "ordinary input during compaction",
        (e) => e._tag === "submission" && e.submission.outcome === "rejected",
      );
      assert.equal(rejected.result._tag, "Failure");
      assert.match((yield* t.state).submission?.detail ?? "", /compaction/);
      assert.equal(
        rejected.events.some((e) => e._tag === "message_end"),
        false,
        "no synthetic history on rejection",
      );
      yield* actUntil(
        "/summary-retry",
        (e) => e._tag === "notice" && e.message.includes("Retrying summary"),
      );
      yield* actUntil(
        "/recover",
        (e) =>
          e._tag === "state" &&
          !e.state.isStreaming &&
          !e.state.isCompacting &&
          !e.state.isRetrying,
      );
      const state = yield* t.state;
      assert.equal(state.isStreaming, false);
      assert.equal(state.isCompacting, false);
      assert.equal(state.isRetrying, false);
      assert.deepEqual(state.queuedMessages, []);
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("missing acknowledgement is delivery-uncertain, never retried; a late response cannot undo newer handling", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "uncertain" });
      const ready = yield* Deferred.make<void>();
      const collector = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "submission" && e.submission.outcome === "uncertain",
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      const error = yield* t
        .act({ _tag: "prompt", text: "withhold acknowledgement" })
        .pipe(Effect.flip);
      assert.equal(error.reason, "timeout");
      const events = yield* Fiber.join(collector);
      assert.equal(
        events.filter((e) => e._tag === "notice" && e.message.includes("without acknowledging"))
          .length,
        1,
        "write the input once",
      );
      const state = yield* t.state;
      assert.equal(state.submission?.outcome, "uncertain");
      assert.equal(state.isStreaming, true, "uncertain acceptance is not fictional settlement");
      yield* t.act({ _tag: "prompt", text: "/release-ack" });
      assert.equal((yield* t.state).submission?.outcome, "handled");
      assert.equal((yield* t.state).submission?.id, 2);
      assert.equal((yield* t.state).isStreaming, true);
      const snapshot = yield* t.events.pipe(Stream.take(1), Stream.runCollect);
      assert.equal(snapshot[0]._tag, "snapshot");
      if (snapshot[0]._tag === "snapshot")
        assert.equal(snapshot[0].snapshot.state.submission?.outcome, "handled");
    }).pipe(
      Effect.provideService(PiRequestTimeoutMs, 500),
      Effect.timeout("5 seconds"),
      Effect.scoped,
    ),
  );
});

test("a timed-out readback leaves no pending work; a timed-out command does", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "silent-commands",
      });
      const read = yield* t.commands.pipe(Effect.flip);
      assert.equal(read.reason, "timeout");
      // Quiescence also waits for projected output, so poll rather than read once.
      for (let n = 0; n < 200 && !(yield* t.state).isQuiescent; n++)
        yield* Effect.sleep("10 millis");
      assert.equal((yield* t.state).isQuiescent, true, "a query changes nothing in Pi");
      const changed = yield* t
        .act({ _tag: "set_name", name: "withhold acknowledgement" })
        .pipe(Effect.flip);
      assert.equal(changed.reason, "timeout");
      assert.equal(
        (yield* t.state).isQuiescent,
        false,
        "an unacknowledged command may still be running",
      );
    }).pipe(
      // Open's own readbacks share this deadline; leave a loaded machine room to answer them.
      Effect.provideService(PiRequestTimeoutMs, 1000),
      Effect.timeout("10 seconds"),
      Effect.scoped,
    ),
  );
});

test("submission acknowledgement outlives its disconnected caller", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({
        cwd: process.cwd(),
        sessionId: "disconnect-submit",
      });
      const ready = yield* Deferred.make<void>();
      const received = yield* Deferred.make<void>();
      const collector = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot"
              ? Deferred.succeed(ready, undefined)
              : e._tag === "notice" && e.message.includes("without acknowledging")
                ? Deferred.succeed(received, undefined)
                : Effect.void,
          ),
        ),
        (e) => e._tag === "submission" && e.submission.outcome === "uncertain",
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      const callerScope = yield* Scope.make();
      yield* t
        .act({ _tag: "prompt", text: "withhold acknowledgement" })
        .pipe(Effect.forkIn(callerScope));
      yield* Deferred.await(received);
      yield* Scope.close(callerScope, Exit.void);
      yield* Fiber.join(collector);
      assert.equal(
        (yield* t.state).submission?.outcome,
        "uncertain",
        "disconnect must not strand the acknowledgement as submitting forever",
      );
      assert.equal((yield* t.state).isStreaming, true, "caller disconnect does not abort work");
    }).pipe(
      Effect.provideService(PiRequestTimeoutMs, 500),
      Effect.timeout("5 seconds"),
      Effect.scoped,
    ),
  );
});

test("a delayed command state observation cannot revert a newer model change", async () => {
  await run(
    Effect.gen(function* () {
      const t = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "late-state" });
      const ready = yield* Deferred.make<void>();
      const captured = yield* collectUntil(
        t.events.pipe(
          Stream.tap((e) =>
            e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
        ),
        (e) => e._tag === "notice" && e.message.includes("old state response"),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      const oldCommand = yield* t
        .act({ _tag: "prompt", text: "/hold-state" })
        .pipe(Effect.forkChild);
      yield* Fiber.join(captured);
      yield* t.act({ _tag: "set_model", model: "fake/beta" });
      assert.equal((yield* t.state).model, "fake/beta");
      yield* t.act({ _tag: "prompt", text: "/release-state" });
      yield* Fiber.join(oldCommand);
      assert.equal((yield* t.state).model, "fake/beta");
      assert.equal(
        (yield* t.state).submission?.id,
        2,
        "older completion does not replace the latest submission",
      );
    }).pipe(Effect.timeout("5 seconds"), Effect.scoped),
  );
});

test("open and probe return a typed readiness timeout even while the child stays alive", async () => {
  for (const operation of ["open", "probe"] as const) {
    await run(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const error = yield* operation === "open"
          ? sessions.open({ cwd: process.cwd(), sessionId: "silent-startup" }).pipe(Effect.flip)
          : sessions.probe(process.cwd()).pipe(Effect.flip);
        assert.equal(
          error.reason,
          "timeout",
          `${operation} must not wait for child exit after its readiness deadline`,
        );
        // Probe also reads models, which the fake answers; on a loaded machine that reply can
        // miss the 200ms deadline first. Either is the readiness timeout this test is about.
        assert.match(
          error.detail,
          operation === "open" ? /get_state/ : /get_state|get_available_models/,
        );
      }).pipe(
        Effect.provideService(PiCli, { ...fakeCli, extraArgs: ["--silence-readiness"] }),
        Effect.provideService(PiRequestTimeoutMs, 200),
        Effect.timeout("2 seconds"),
        Effect.scoped,
      ),
    );
  }
});

test("probe reports models and default", async () => {
  const r = await run(
    Effect.gen(function* () {
      return yield* (yield* PiSessions).probe(process.cwd());
    }),
  );
  assert.equal(r.models.length, 2);
  assert.equal(r.defaultModel, "fake/alpha");
});

test("INV-02: releasing a session tells subscribers it closed, and whether that interrupted work", async () => {
  // A stop the person asked for (archive, delete) is told apart from one they did not, and a
  // settled session's stays a plain release either way.
  for (const [sessionId, prompt, requested, expected] of [
    ["s4", undefined, false, "released"],
    ["s4-working", "ask first", false, "released_during_work"],
    ["s4-asked", undefined, true, "released"],
    ["s4-asked-working", "ask first", true, "stopped"],
  ] as const) {
    const events = await run(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const scope = yield* Scope.make();
        const t = yield* sessions
          .open({ cwd: process.cwd(), sessionId })
          .pipe(Scope.provide(scope));
        const collector = yield* collectUntil(t.events, (e) => e._tag === "closed").pipe(
          Effect.forkChild,
        );
        if (prompt) {
          const waiting = yield* collectUntil(t.events, (e) => e._tag === "dialog").pipe(
            Effect.forkChild,
          );
          yield* t.act({ _tag: "prompt", text: prompt });
          yield* Fiber.join(waiting);
        } else yield* Effect.sleep("50 millis");
        if (requested) yield* t.prepareRelease("requested");
        yield* Scope.close(scope, Exit.succeed(undefined));
        return yield* Fiber.join(collector).pipe(Effect.timeoutOption("5 seconds"));
      }),
    );
    assert.equal(events._tag, "Some", "subscriber saw the stream end");
    const last = events.value[events.value.length - 1] as Extract<SessionEvent, { _tag: "closed" }>;
    assert.equal(last._tag, "closed");
    assert.equal(last.closure._tag, expected, sessionId);
  }
});
