import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Queue, type Scope } from "effect";
import { makeClientSessions } from "../server/ClientSessions.ts";
import { DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { SidebarViewLive } from "../server/SidebarView.ts";
import { type WorkspaceCommands, WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";
import type { ServerMessage } from "../shared/wire.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-client-sessions-")));
const cwd = join(root, "checkout");
mkdirSync(cwd); mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

let databases = 0;
const run = <A, E>(effect: Effect.Effect<A, E, WorkspaceCommands | SessionHosts | Registry | Scope.Scope>) => {
  const layer = WorkspaceCommandsLive.pipe(
    Layer.provide(SidebarViewLive()), Layer.provide(DirectoryFactsLive),
    Layer.provideMerge(SessionHostsLive({ idleMs: 0 })),
    Layer.provide(PiSessionsLive), Layer.provideMerge(RegistryLive), Layer.provide(NodeServices.layer));
  return Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer),
    Effect.provideService(PiCli, { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] }),
    Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)), Effect.timeout("10 seconds")));
};

/** A client whose messages are recorded in order and can be awaited. */
const client = Effect.gen(function* () {
  const sent: ServerMessage[] = [];
  const queue = yield* Queue.unbounded<ServerMessage>();
  const sessions = yield* makeClientSessions({
    send: m => Effect.sync(() => sent.push(m)).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
    overflow: e => Effect.die(e),
  });
  const next = (pred: (m: ServerMessage) => boolean) => Effect.gen(function* () {
    for (;;) { const m = yield* Queue.take(queue); if (pred(m)) return m; }
  });
  return { sessions, sent, next };
});
const started = (id?: string) => Effect.gen(function* () {
  const hosts = yield* SessionHosts;
  return yield* hosts.open({ cwd, sessionId: id ?? crypto.randomUUID(), create: true });
});
const commands = { _tag: "commands" } as const;
const resultFor = (sent: ServerMessage[]) => sent.filter(m => m._tag === "action_result").map(m => m._tag === "action_result" && m.sessionId);

test("INV-05: a lookup that finishes after a reselect shows nothing and keeps the newer attachment", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const a = (yield* started()).spec.sessionId, b = yield* started();
    yield* hosts.release(cwd, a);
    const { sessions, sent, next } = yield* client;
    // Both selections are claimed in receive order; the older lookup finishes last.
    const showA = yield* sessions.select({ cwd, sessionId: a, selectionId: "A" });
    const showB = yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
    yield* showB;
    yield* showA;
    const selected = yield* next(m => m._tag === "selected");
    assert.ok(selected._tag === "selected");
    assert.deepEqual([selected.selectionId, selected.sessionId, selected.hosted], ["B", b.spec.sessionId, true]);
    // B stays attached: its live frames still arrive.
    yield* b.act({ _tag: "prompt", text: "for B" });
    yield* next(m => m._tag === "session" && m.event._tag === "message_end" && m.event.message.role === "assistant");
    assert.deepEqual(sent.filter(m => "selectionId" in m && m.selectionId === "A"), []);
  }));
});

test("acting for a selection that was replaced is refused as stale and reaches no session", async () => {
  await run(Effect.gen(function* () {
    const a = yield* started(), b = yield* started();
    const { sessions, sent } = yield* client;
    yield* yield* sessions.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
    yield* sessions.act("A", commands);
    assert.deepEqual(resultFor(sent), [a.spec.sessionId]);
    yield* yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
    const error = yield* Effect.flip(sessions.act("A", commands, {}));
    assert.deepEqual([error._tag, error._tag === "ActRefused" && error.reason], ["ActRefused", "stale"]);
    assert.deepEqual(resultFor(sent), [a.spec.sessionId], "the stale action reached neither session");
    yield* sessions.act("B", commands);
    assert.deepEqual(resultFor(sent), [a.spec.sessionId, b.spec.sessionId]);
  }));
});

test("INV-01/02: acting on a new-session selection is refused; only create makes a session", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts, registry = yield* Registry;
    const { sessions, next } = yield* client;
    yield* yield* sessions.select({ cwd, sessionId: null, selectionId: "new" });
    yield* next(m => m._tag === "selected");
    const error = yield* Effect.flip(sessions.act("new", { _tag: "prompt", text: "hello" }, {}));
    assert.ok(error._tag === "ActRefused");
    assert.equal(error.reason, "no_session");
    assert.match(error.detail, /Create a session/);
    assert.deepEqual(yield* hosts.list, [], "no Pi child was started");
    const data = yield* registry.get;
    assert.deepEqual([data.sessions.length, data.folders.length], [0, 0], "no reference or folder was written");
  }));
});

test("INV-02/05: starting from a stopped selection attaches before the first prompt, which is observed", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const id = (yield* started()).spec.sessionId;
    yield* hosts.release(cwd, id);
    const { sessions, sent, next } = yield* client;
    yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "S" });
    const peeked = yield* next(m => m._tag === "selected");
    assert.ok(peeked._tag === "selected" && !peeked.hosted, "a stopped session is shown read-only");
    const unstarted = yield* Effect.flip(sessions.act("S", { _tag: "prompt", text: "first" }));
    assert.ok(unstarted._tag === "ActRefused" && unstarted.reason === "not_running");
    yield* sessions.act("S", { _tag: "prompt", text: "first" }, {});
    assert.ok(sent.some(m => m._tag === "selected" && m.selectionId === "S" && m.hosted), "the snapshot is delivered before act returns");
    const seen = yield* next(m => m._tag === "session" && m.event._tag === "message_end" && m.event.message.role === "user");
    assert.ok(seen._tag === "session" && seen.selectionId === "S");
    yield* sessions.act("S", commands, {});
    assert.deepEqual(resultFor(sent), [id]);
    assert.equal((yield* hosts.list).filter(h => h.sessionId === id).length, 1, "one child, no second start");
  }));
});

test("a new-session selection shows what it creates only while it is still selected", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts, registry = yield* Registry;
    const { sessions, sent, next } = yield* client;
    const createOld = yield* sessions.create({ selectionId: "old", cwd, options: {} });
    const createNew = yield* sessions.create({ selectionId: "new", cwd, options: {} });
    yield* createOld;
    yield* createNew;
    const selected = yield* next(m => m._tag === "selected");
    assert.ok(selected._tag === "selected" && selected.sessionId);
    assert.equal(selected.selectionId, "new");
    assert.deepEqual(sent.filter(m => "selectionId" in m && m.selectionId === "old"), []);
    const references = (yield* registry.get).sessions.map(s => s.sessionId);
    assert.equal(references.length, 2, "the stale session was still created and registered; it is only not shown");
    assert.equal((yield* hosts.list).length, 2);
    // The shown session is the new selection's own.
    yield* sessions.act("new", commands);
    assert.deepEqual(resultFor(sent), [selected.sessionId]);
  }));
});

test("INV-02: retiring the selected session detaches before Pi stops, clears the selection and cannot be undone by acting", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const a = yield* started(), b = yield* started();
    const { sessions, sent, next } = yield* client;
    yield* yield* sessions.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
    yield* next(m => m._tag === "selected");
    yield* sessions.retire(cwd, a.spec.sessionId, "archive");
    const cleared = yield* next(m => m._tag === "selected");
    assert.ok(cleared._tag === "selected");
    assert.deepEqual([cleared.selectionId, cleared.sessionId, cleared.hosted], ["A", null, false]);
    const error = yield* Effect.flip(sessions.act("A", { _tag: "prompt", text: "again" }, {}));
    assert.ok(error._tag === "ActRefused" && error.reason === "stale", "a retired session cannot be restarted from the old view");
    assert.deepEqual((yield* hosts.list).map(h => h.sessionId), [b.spec.sessionId]);
    assert.deepEqual(sent.filter(m => m._tag === "session"), [], "detached before Pi stopped");
    assert.deepEqual(sent.filter(m => m._tag === "toast"), [], "archiving is shown by the sidebar, not a toast");
    yield* sessions.retire(cwd, b.spec.sessionId, "delete");
    assert.deepEqual(yield* hosts.list, []);
    assert.deepEqual(sent.filter(m => m._tag === "toast").map(m => m._tag === "toast" && m.message), ["Session deleted"]);
  }));
});
