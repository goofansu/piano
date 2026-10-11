import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Queue, type Scope } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { type Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { makeSessionViewer, StaleSelection, type ViewerMessage } from "../server/SessionViewer.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-viewer-")));
const cwd = join(root, "checkout");
mkdirSync(cwd); mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

let databases = 0;
const run = <A, E>(effect: Effect.Effect<A, E, SessionHosts | Registry | Scope.Scope>) => {
  const layer = SessionHostsLive({ idleMs: 0 }).pipe(Layer.provide(PiSessionsLive), Layer.provideMerge(RegistryLive), Layer.provide(NodeServices.layer));
  return Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer),
    Effect.provideService(PiCli, { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] }),
    Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)), Effect.timeout("10 seconds")));
};

/** A viewer whose deliveries are recorded in order and can be awaited. */
const viewer = Effect.gen(function* () {
  const delivered: ViewerMessage[] = [];
  const queue = yield* Queue.unbounded<ViewerMessage>();
  const view = yield* makeSessionViewer({
    deliver: m => Effect.sync(() => delivered.push(m)).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
    overflow: e => Effect.die(e),
  });
  const next = (pred: (m: ViewerMessage) => boolean) => Effect.gen(function* () {
    for (;;) { const m = yield* Queue.take(queue); if (pred(m)) return m; }
  });
  return { view, delivered, next };
});
const started = (id?: string) => Effect.gen(function* () {
  const hosts = yield* SessionHosts;
  return yield* hosts.open({ cwd, sessionId: id ?? crypto.randomUUID(), create: true });
});

test("INV-05: a lookup that finishes after a reselect shows nothing and keeps the newer attachment", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const a = (yield* started()).spec.sessionId, b = yield* started();
    yield* hosts.release(cwd, a);
    const { view, delivered, next } = yield* viewer;
    // Both selections are claimed in receive order; the older lookup finishes last.
    const showA = yield* view.select({ cwd, sessionId: a, selectionId: "A" });
    const showB = yield* view.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
    yield* showB;
    yield* showA;
    const selected = yield* next(m => m._tag === "selected");
    assert.ok(selected._tag === "selected");
    assert.deepEqual([selected.selectionId, selected.sessionId, selected.hosted], ["B", b.spec.sessionId, true]);
    // B stays attached: its live frames still arrive.
    yield* b.act({ _tag: "prompt", text: "for B" });
    yield* next(m => m._tag === "session" && m.event._tag === "message_end" && m.event.message.role === "assistant");
    assert.deepEqual(delivered.filter(m => m.selectionId === "A"), []);
  }));
});

test("acting for a selection that was replaced is rejected as stale", async () => {
  await run(Effect.gen(function* () {
    const a = yield* started(), b = yield* started();
    const { view } = yield* viewer;
    const showA = yield* view.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
    yield* showA;
    assert.equal((yield* view.act("A")).session, a);
    yield* yield* view.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
    const error = yield* Effect.flip(view.act("A", {}));
    assert.ok(error instanceof StaleSelection);
    assert.equal((yield* view.act("B")).session, b);
  }));
});

test("INV-02/05: starting from a stopped selection attaches before the first prompt, which is observed", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const id = (yield* started()).spec.sessionId;
    yield* hosts.release(cwd, id);
    const { view, delivered, next } = yield* viewer;
    yield* yield* view.select({ cwd, sessionId: id, selectionId: "S" });
    const peeked = yield* next(m => m._tag === "selected");
    assert.ok(peeked._tag === "selected" && !peeked.hosted, "a stopped session is shown read-only");
    const unstarted = yield* Effect.flip(view.act("S"));
    assert.match(unstarted.message, /not running/);
    const first = yield* view.act("S", {});
    assert.equal(first.started, true);
    assert.ok(delivered.some(m => m._tag === "selected" && m.selectionId === "S" && m.hosted), "the snapshot is delivered before act returns");
    const again = yield* view.act("S", {});
    assert.deepEqual([again.started, again.session], [false, first.session], "one child, no second start");
    yield* first.session.act({ _tag: "prompt", text: "first" });
    const seen = yield* next(m => m._tag === "session" && m.event._tag === "message_end" && m.event.message.role === "user");
    assert.ok(seen._tag === "session" && seen.selectionId === "S");
    assert.equal((yield* hosts.list).filter(h => h.sessionId === id).length, 1);
  }));
});

test("a new-session selection attaches what it opens only while it is still selected", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const { view, delivered, next } = yield* viewer;
    const attachOld = yield* view.create({ cwd, selectionId: "old" });
    const attachNew = yield* view.create({ cwd, selectionId: "new" });
    const open = () => hosts.open({ cwd, sessionId: crypto.randomUUID(), create: true });
    const stale = yield* attachOld(open());
    const fresh = yield* attachNew(open());
    const selected = yield* next(m => m._tag === "selected");
    assert.ok(selected._tag === "selected");
    assert.deepEqual([selected.selectionId, selected.sessionId], ["new", fresh.spec.sessionId]);
    assert.deepEqual(delivered.filter(m => m.selectionId === "old"), []);
    assert.ok(yield* hosts.get(cwd, stale.spec.sessionId), "the stale session still started; it is only not shown");
  }));
});

test("forgetting the selected session detaches before retiring it and clears the selection", async () => {
  await run(Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const a = yield* started();
    const { view, delivered, next } = yield* viewer;
    yield* yield* view.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
    yield* next(m => m._tag === "selected");
    yield* view.forget(cwd, a.spec.sessionId, hosts.archive(cwd, a.spec.sessionId));
    const cleared = yield* next(m => m._tag === "selected");
    assert.ok(cleared._tag === "selected");
    assert.deepEqual([cleared.selectionId, cleared.sessionId, cleared.hosted], ["A", null, false]);
    assert.ok((yield* Effect.flip(view.act("A", {}))) instanceof StaleSelection, "a retired session cannot be restarted from the old view");
    assert.deepEqual(yield* hosts.list, []);
    assert.deepEqual(delivered.filter(m => m._tag === "session").map(m => m._tag === "session" && m.event._tag), [], "detached before Pi stopped");
  }));
});
