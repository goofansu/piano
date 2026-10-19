import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Queue, type Scope, Stream } from "effect";
import { makeClientSessions } from "../server/ClientSessions.ts";
import type { Notifications } from "../server/Notifications.ts";
import { PiCli } from "../server/PiCli.ts";
import { type PiSession, PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import type { ServerMessage } from "../shared/wire.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-client-sessions-")));
const cwd = join(root, "checkout");
mkdirSync(cwd);
mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<A, E, SessionHosts | Registry | Notifications | Scope.Scope>,
  path = join(root, `registry-${++databases}.db`),
) => {
  const layer = SessionHostsLive({ idleMs: 0 }).pipe(
    Layer.provide(PiSessionsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide(NodeServices.layer),
  );
  return Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
      Effect.provideService(RegistryDatabasePath, path),
      Effect.timeout("10 seconds"),
    ),
  );
};

/** A client whose messages are recorded in order and can be awaited. */
const client = Effect.gen(function* () {
  const sent: ServerMessage[] = [];
  const queue = yield* Queue.unbounded<ServerMessage>();
  const sessions = yield* makeClientSessions({
    send: (m) =>
      Effect.sync(() => sent.push(m)).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
    overflow: (e) => Effect.die(e),
  });
  const next = (pred: (m: ServerMessage) => boolean) =>
    Effect.gen(function* () {
      for (;;) {
        const m = yield* Queue.take(queue);
        if (pred(m)) return m;
      }
    });
  return { sessions, sent, next };
});
const started = (id?: string) =>
  Effect.gen(function* () {
    const sessionId = id ?? crypto.randomUUID();
    yield* (yield* Registry).addSession(cwd, sessionId);
    return yield* (yield* SessionHosts).open({ cwd, sessionId });
  });
/** An action whose result (an empty restored queue) reaches only its requester. */
const restoreQueue = { _tag: "restore_queue" } as const;
const resultFor = (sent: ServerMessage[]) =>
  sent
    .filter((m) => m._tag === "action_result")
    .map((m) => m._tag === "action_result" && m.sessionId);

test("INV-01/02: selecting saved history spends one discovery read budget without starting Pi", async (t) => {
  const store = mkdtempSync(join(root, "selection-history-"));
  const id = "saved-selection";
  let discoveryBytes = 0;
  for (const sessionId of [id, ...Array.from({ length: 8 }, (_, i) => `neighbor-${i}`)]) {
    const contents =
      [
        {
          type: "session",
          version: 3,
          id: sessionId,
          cwd,
          timestamp: "2026-10-05T00:00:00Z",
          // Small files fit within a header read; their combined size defines a one-pass budget.
          padding: "x".repeat(2048),
        },
        {
          type: "message",
          id: "saved",
          parentId: null,
          timestamp: "2026-10-05T00:00:01Z",
          message: { role: "user", content: "Saved conversation", timestamp: 1 },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n";
    writeFileSync(join(store, `${sessionId}.jsonl`), contents);
    discoveryBytes += Buffer.byteLength(contents);
  }
  // Observe real filesystem bytes at the selection boundary, not calls between services.
  // Allow a little slack, but not a second directory discovery. Pi's saved-view read is sync.
  const read = fs.read;
  let bytes = 0;
  t.mock.method(fs, "read", (...args: unknown[]) => {
    const callback = args.pop() as (...result: unknown[]) => void;
    return Reflect.apply(read, fs, [
      ...args,
      (...result: unknown[]) => {
        bytes += Number(result[1] ?? 0);
        callback(...result);
      },
    ]);
  });
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = store;
  try {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        yield* (yield* Registry).addSession(cwd, id);
        const { sessions, next } = yield* client;
        yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "saved" });
        const selected = yield* next((m) => m._tag === "selected");
        assert.ok(selected._tag === "selected" && !selected.hosted);
        assert.deepEqual(
          selected.snapshot.messages.map((m) => m.text),
          ["Saved conversation"],
        );
        assert.deepEqual(yield* hosts.list, [], "selection must not start Pi");
        t.diagnostic(
          `selection discovery read ${bytes} bytes; one-pass fixture ${discoveryBytes} bytes`,
        );
        assert.ok(
          bytes > 0 && bytes <= discoveryBytes + 1024,
          `selection discovery read ${bytes} bytes; budget ${discoveryBytes + 1024}`,
        );
      }),
    );
  } finally {
    process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  }
});

test("INV-05: a lookup that finishes after a reselect shows nothing and keeps the newer attachment", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const a = (yield* started()).spec.sessionId,
        b = yield* started();
      yield* hosts.release(cwd, a);
      const { sessions, sent, next } = yield* client;
      // Both selections are claimed in receive order; the older lookup finishes last.
      const showA = yield* sessions.select({ cwd, sessionId: a, selectionId: "A" });
      const showB = yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
      yield* showB;
      yield* showA;
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected");
      assert.deepEqual(
        [selected.selectionId, selected.sessionId, selected.hosted],
        ["B", b.spec.sessionId, true],
      );
      // B stays attached: its live frames still arrive.
      yield* b.act({ _tag: "prompt", text: "for B" });
      yield* next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.deepEqual(
        sent.filter((m) => "selectionId" in m && m.selectionId === "A"),
        [],
      );
    }),
  );
});

test("acting for a selection that was replaced is refused as stale and reaches no session", async () => {
  await run(
    Effect.gen(function* () {
      const a = yield* started(),
        b = yield* started();
      const { sessions, sent } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
      yield* sessions.act("A", restoreQueue);
      assert.deepEqual(resultFor(sent), [a.spec.sessionId]);
      yield* yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
      const error = yield* Effect.flip(sessions.act("A", restoreQueue, {}));
      assert.deepEqual(
        [error._tag, error._tag === "ActRefused" && error.reason],
        ["ActRefused", "stale"],
      );
      assert.deepEqual(
        resultFor(sent),
        [a.spec.sessionId],
        "the stale action reached neither session",
      );
      yield* sessions.act("B", restoreQueue);
      assert.deepEqual(resultFor(sent), [a.spec.sessionId, b.spec.sessionId]);
    }),
  );
});

test("INV-05: act reuses the selection claim, not a fresh request id", async () => {
  await run(
    Effect.gen(function* () {
      const { sessions, sent, next } = yield* client;
      const missing = yield* Effect.flip(sessions.act("fresh-act", restoreQueue, {}));
      assert.ok(missing._tag === "ActRefused" && missing.reason === "stale");

      const session = yield* started();
      yield* yield* sessions.select({
        cwd,
        sessionId: session.spec.sessionId,
        selectionId: "selected-claim",
      });
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected" && selected.hosted);
      const mismatch = yield* Effect.flip(sessions.act("fresh-act", restoreQueue, {}));
      assert.ok(mismatch._tag === "ActRefused" && mismatch.reason === "stale");
      assert.match(mismatch.detail, /selected\.selectionId="selected-claim"/);
      assert.match(mismatch.detail, /act\.selectionId="fresh-act"/);
      assert.match(
        mismatch.detail,
        /Reuse the selectionId from the current select or create_session/,
      );
      assert.deepEqual(resultFor(sent), [], "the mismatched action never reached Pi");

      yield* sessions.act(selected.selectionId, restoreQueue);
      assert.deepEqual(resultFor(sent), [session.spec.sessionId]);
      assert.match(missing.detail, /selected\.selectionId=null/);
      assert.match(missing.detail, /act\.selectionId="fresh-act"/);
    }),
  );
});

test("INV-01/02: acting on a new-session selection is refused; only create makes a session", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const { sessions, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: null, selectionId: "new" });
      yield* next((m) => m._tag === "selected");
      const error = yield* Effect.flip(sessions.act("new", { _tag: "prompt", text: "hello" }, {}));
      assert.ok(error._tag === "ActRefused");
      assert.equal(error.reason, "no_session");
      assert.match(error.detail, /Create a session/);
      assert.deepEqual(yield* hosts.list, [], "no Pi child was started");
      const data = yield* registry.get;
      assert.deepEqual(
        [data.sessions.length, data.folders.length],
        [0, 0],
        "no reference or folder was written",
      );
    }),
  );
});

test("INV-02/05: starting from a stopped selection attaches before the first prompt, which is observed", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* started()).spec.sessionId;
      yield* hosts.release(cwd, id);
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "S" });
      const peeked = yield* next((m) => m._tag === "selected");
      assert.ok(
        peeked._tag === "selected" && !peeked.hosted,
        "a stopped session is shown read-only",
      );
      const unstarted = yield* Effect.flip(sessions.act("S", { _tag: "prompt", text: "first" }));
      assert.ok(unstarted._tag === "ActRefused" && unstarted.reason === "not_running");
      yield* sessions.act("S", { _tag: "prompt", text: "first" }, {});
      assert.ok(
        sent.some((m) => m._tag === "selected" && m.selectionId === "S" && m.hosted),
        "the snapshot is delivered before act returns",
      );
      const seen = yield* next(
        (m) =>
          m._tag === "session" && m.event._tag === "message_end" && m.event.message.role === "user",
      );
      assert.ok(seen._tag === "session" && seen.selectionId === "S");
      yield* sessions.act("S", restoreQueue, {});
      assert.deepEqual(resultFor(sent), [id]);
      assert.equal(
        (yield* hosts.list).filter((h) => h.sessionId === id).length,
        1,
        "one child, no second start",
      );
    }),
  );
});

test("INV-02/05: a reattached session applies offline draft choices before its next input", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* started();
      const { sessions, next } = yield* client;
      yield* yield* sessions.select({
        cwd,
        sessionId: session.spec.sessionId,
        selectionId: "back",
      });
      yield* sessions.act(
        "back",
        { _tag: "prompt", text: "offline draft" },
        {
          model: "fake/beta",
          thinkingLevel: "high",
        },
      );
      const reply = yield* next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.ok(reply._tag === "session" && reply.event._tag === "message_end");
      assert.equal(reply.event.message.model, "fake/beta");
      assert.equal((yield* session.state).thinkingLevel, "high");
    }),
  );
});

test("INV-02: a pick reaches a session another client started after this one showed it stopped", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* started()).spec.sessionId;
      yield* hosts.release(cwd, id);
      const { sessions, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "B" });
      // Another tab starts the session; this one still shows the saved snapshot.
      yield* hosts.open({ cwd, sessionId: id });
      yield* sessions.act(
        "B",
        { _tag: "prompt", text: "with my pick" },
        { model: "fake/beta", thinkingLevel: "high" },
      );
      const reply = yield* next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.ok(reply._tag === "session" && reply.event._tag === "message_end");
      assert.equal(reply.event.message.model, "fake/beta");
      assert.equal((yield* (yield* hosts.get(cwd, id))!.state).thinkingLevel, "high");
    }),
  );
});

test("a new-session selection shows what it creates only while it is still selected", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const { sessions, sent, next } = yield* client;
      const createOld = yield* sessions.create({ selectionId: "old", cwd, options: {} });
      const createNew = yield* sessions.create({ selectionId: "new", cwd, options: {} });
      yield* createOld;
      yield* createNew;
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected" && selected.sessionId);
      assert.equal(selected.selectionId, "new");
      assert.deepEqual(
        sent.filter((m) => "selectionId" in m && m.selectionId === "old"),
        [],
      );
      const references = (yield* registry.get).sessions.map((s) => s.sessionId);
      assert.equal(
        references.length,
        2,
        "the stale session was still created and registered; it is only not shown",
      );
      assert.equal((yield* hosts.list).length, 2);
      // The shown session is the new selection's own.
      yield* sessions.act("new", restoreQueue);
      assert.deepEqual(resultFor(sent), [selected.sessionId]);
    }),
  );
});

test("INV-02: retiring the selected session detaches before Pi stops, clears the selection and cannot be undone by acting", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const a = yield* started(),
        b = yield* started();
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
      yield* next((m) => m._tag === "selected");
      yield* sessions.retire(cwd, a.spec.sessionId, "archive");
      const cleared = yield* next((m) => m._tag === "selected");
      assert.ok(cleared._tag === "selected");
      assert.deepEqual(
        [cleared.selectionId, cleared.sessionId, cleared.hosted],
        ["A", null, false],
      );
      const error = yield* Effect.flip(sessions.act("A", { _tag: "prompt", text: "again" }, {}));
      assert.ok(
        error._tag === "ActRefused" && error.reason === "stale",
        "a retired session cannot be restarted from the old view",
      );
      assert.deepEqual(
        (yield* hosts.list).map((h) => h.sessionId),
        [b.spec.sessionId],
      );
      assert.deepEqual(
        sent.filter((m) => m._tag === "session"),
        [],
        "detached before Pi stopped",
      );
      assert.deepEqual(
        sent.filter((m) => m._tag === "toast"),
        [],
        "archiving is shown by the sidebar, not a toast",
      );
      yield* sessions.retire(cwd, b.spec.sessionId, "delete");
      assert.deepEqual(yield* hosts.list, []);
      assert.deepEqual(
        (yield* (yield* Registry).get).sessions.map((s) => [s.sessionId, s.archived]),
        [[a.spec.sessionId, true]],
        "archive keeps the reference; delete forgets it",
      );
      assert.deepEqual(
        sent.filter((m) => m._tag === "toast").map((m) => m._tag === "toast" && m.message),
        ["Session deleted"],
      );
      // A stale link cannot show a retired conversation, even when archive kept its history.
      const shown = sent.filter((m) => m._tag === "selected").length;
      for (const [sessionId, detail] of [
        [a.spec.sessionId, /archived/],
        [b.spec.sessionId, /no longer registered/],
      ] as const) {
        const show = yield* sessions.select({ cwd, sessionId, selectionId: "retired" });
        const result = yield* Effect.result(show);
        assert.ok(result._tag === "Failure", "a retired selection must be refused");
        assert.match(result.failure.detail, detail);
      }
      assert.equal(sent.filter((m) => m._tag === "selected").length, shown);
    }),
  );
});

const firstSnapshot = (session: PiSession) =>
  session.events.pipe(
    Stream.filter((e) => e._tag === "snapshot"),
    Stream.take(1),
    Stream.runCollect,
    Effect.map((c) => {
      const e = [...c][0]!;
      assert.ok(e._tag === "snapshot");
      return e.snapshot;
    }),
  );
const prompted = (session: PiSession) =>
  firstSnapshot(session).pipe(Effect.map((s) => s.messages.some((m) => m.role === "user")));

test("INV-01/02: creating registers the folder, reference and project, attaches, then records the first prompt before Pi sees it", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const log: string[] = [];
      yield* registry.onChange((before, after) =>
        Effect.gen(function* () {
          for (const s of after.sessions) {
            const was = before.sessions.find((b) => b.sessionId === s.sessionId);
            if (!was)
              log.push(`registered project=${s.projectId} folder=${after.folders.includes(cwd)}`);
            else if (was.updatedAt !== s.updatedAt)
              log.push(
                `activity prompted=${yield* prompted((yield* hosts.get(s.cwd, s.sessionId))!)}`,
              );
          }
        }).pipe(Effect.orDie),
      );
      const queue = yield* Queue.unbounded<ServerMessage>();
      const sessions = yield* makeClientSessions({
        send: (m) =>
          Effect.sync(() => {
            if (m._tag === "selected" && m.sessionId) log.push("attached");
          }).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
        overflow: (e) => Effect.die(e),
      });
      yield* yield* sessions.create({
        selectionId: "new",
        cwd,
        projectId: "launch",
        options: {},
        text: "  hello  ",
      });
      assert.deepEqual(log, [
        "registered project=launch folder=true",
        "attached",
        "activity prompted=false",
      ]);
      // The trimmed prompt reaches Pi and this client observes it.
      for (;;) {
        const m = yield* Queue.take(queue);
        if (
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "user"
        ) {
          assert.equal(m.event.message.text, "hello");
          const session = (yield* hosts.get(m.cursor.cwd, m.cursor.sessionId))!;
          const submission = (yield* session.state).submission;
          assert.equal(submission?.inputId, "new", "creation proof belongs to its request");
          assert.ok(submission?.inputFingerprint);
          assert.equal(submission.inputFingerprint, m.event.message.inputFingerprint);
          break;
        }
      }
      const [entry] = (yield* registry.get).sessions;
      assert.equal(entry.cwd, cwd);
      assert.equal((yield* hosts.list).filter((h) => h.sessionId === entry.sessionId).length, 1);
    }),
  );
});

test("INV-01/02/07: an interrupted creation keeps its project membership and sends no prompt", async () => {
  const path = join(root, "interrupted-creation.db");
  const id = await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const published: Array<string | undefined> = [];
      yield* registry.onChange((before, after) =>
        Effect.sync(() => {
          for (const s of after.sessions)
            if (!before.sessions.some((b) => b.sessionId === s.sessionId))
              published.push(s.projectId);
        }),
      );
      // The browser has opened Pi but disconnects before its snapshot is delivered.
      const opened = yield* Deferred.make<string>();
      const sessions = yield* makeClientSessions({
        send: (m) =>
          m._tag === "selected" && m.sessionId
            ? Deferred.succeed(opened, m.sessionId).pipe(Effect.andThen(Effect.never))
            : Effect.void,
        overflow: (e) => Effect.die(e),
      });
      const creating = yield* (yield* sessions.create({
        selectionId: "new",
        cwd,
        projectId: "launch",
        options: {},
        text: "must not reach Pi",
      })).pipe(Effect.forkChild);
      const id = yield* Deferred.await(opened);
      yield* Fiber.interrupt(creating);
      const session = (yield* hosts.get(cwd, id))!;
      assert.ok(session, "the server-owned child survives its requester");
      assert.equal(yield* prompted(session), false, "no prompt without a completed attachment");
      assert.deepEqual(
        (yield* registry.get).sessions.map((s) => [s.cwd, s.sessionId, s.projectId]),
        [[cwd, id, "launch"]],
      );
      assert.deepEqual(published, ["launch"], "the first published reference has its project");
      return id;
    }),
    path,
  );
  const reopened = await Effect.runPromise(
    Effect.flatMap(Registry, (r) => r.get).pipe(
      Effect.provide(RegistryLive),
      Effect.provideService(RegistryDatabasePath, path),
    ),
  );
  assert.deepEqual(
    reopened.sessions.map((s) => [s.cwd, s.sessionId, s.projectId]),
    [[cwd, id, "launch"]],
    "membership survives reopening SQLite",
  );
});
