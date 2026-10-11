import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { applySessionEvent } from "../shared/sessionProjection.ts";
import type { Dialog, SessionFrame, Snapshot } from "../shared/wire.ts";

const dialog = (id: string, generation: string): Dialog => ({
  id, generation, receivedAt: 0, deadlineAt: 1, deadlineKind: "host-recovery", method: "input", title: id,
});
const base: Snapshot = { state: { sessionId: "s", isStreaming: true }, messages: [], dialogs: [] };

test("a late submission outcome cannot replace the explanation for newer input", () => {
  const queued = applySessionEvent(base, { _tag: "submission", submission: { id: 2, outcome: "queued" } });
  const late = applySessionEvent(queued, { _tag: "submission", submission: { id: 1, outcome: "handled" } });
  assert.equal(late.state.submission?.outcome, "queued");
  assert.equal(late.state.isStreaming, true, "handling input never settles current activity");
  assert.deepEqual(late.messages, [], "handling input never invents a user message");
  assert.equal(applySessionEvent(late, { _tag: "submission", submission: { id: 2, outcome: "rejected" } }).state.submission?.outcome, "rejected");
});

test("INV-02: closure ends activity, queue, partial reply and dialogs, and keeps history", () => {
  let s = applySessionEvent(base, { _tag: "message_end", message: { id: "u", role: "user", text: "hello" } });
  s = applySessionEvent(s, { _tag: "message_update", message: { id: "pending", role: "assistant", text: "par" } });
  s = applySessionEvent(s, { _tag: "queue_update", messages: [{ kind: "follow-up", text: "later" }] });
  s = applySessionEvent(s, { _tag: "dialog", dialog: dialog("d1", "g1") });
  s = applySessionEvent(s, { _tag: "state", state: { ...s.state, isCompacting: true, isRetrying: true, isStopping: true, contextIsLastKnown: false } });
  const closure = { _tag: "exited", code: 1, detail: "Pi exited with code 1" } as const;
  const closed = applySessionEvent(s, { _tag: "closed", closure });
  assert.deepEqual(closed.state, { sessionId: "s", isStreaming: false, isCompacting: false, isRetrying: false, isStopping: false,
    queuedMessages: [], contextIsLastKnown: true, closure });
  assert.equal(closed.pending, undefined);
  assert.deepEqual(closed.dialogs, []);
  assert.deepEqual(closed.messages.map(m => m.text), ["hello"]);
});

test("INV-05: dialogs resolve per child generation, and a duplicate dialog is shown once", () => {
  let s = applySessionEvent(base, { _tag: "dialog", dialog: dialog("d1", "old") });
  s = applySessionEvent(s, { _tag: "dialog", dialog: dialog("d1", "new") });
  assert.equal(applySessionEvent(s, { _tag: "dialog", dialog: dialog("d1", "new") }), s);
  s = applySessionEvent(s, { _tag: "dialog_resolved", resolution: { id: "d1", generation: "old", reason: "exited", delivery: "not-sent", detail: "" } });
  assert.deepEqual(s.dialogs.map(d => d.generation), ["new"]);
});

test("a partial reply lasts until its message ends or its run does; tool updates replace in place", () => {
  const running = { id: "t1", name: "bash", args: "", text: "a", status: "running", outputKind: "latest-update" } as const;
  let s = applySessionEvent(base, { _tag: "tool_update", tool: running });
  s = applySessionEvent(s, { _tag: "tool_update", tool: { ...running, id: "t2" } });
  s = applySessionEvent(s, { _tag: "tool_update", tool: { ...running, text: "ab", status: "success", outputKind: "final" } });
  assert.deepEqual(s.tools?.map(t => [t.id, t.status]), [["t1", "success"], ["t2", "running"]]);
  s = applySessionEvent(s, { _tag: "message_update", message: { id: "pending", role: "assistant", text: "partial" } });
  s = applySessionEvent(s, { _tag: "message_end", message: { id: "r", role: "tool_result", text: "out" } });
  assert.equal(s.pending?.text, "partial", "a tool result is not the reply");
  assert.equal(applySessionEvent(s, { _tag: "message_end", message: { id: "a", role: "assistant", text: "final" } }).pending, undefined);
  assert.equal(applySessionEvent(s, { _tag: "state", state: { ...s.state, isStreaming: false } }).pending, undefined);
});

const fakeCli = { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] };
/** Wire form: what a browser decodes. */
const wire = (snapshot: Snapshot) => {
  const json = JSON.parse(JSON.stringify(snapshot));
  delete json.state.isQuiescent; // A host observation sent with snapshots only, never folded.
  return json;
};

test("INV-05: a snapshot folded forward with its events equals the snapshot a later subscriber receives", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: "fold-agreement" });
    const seen: SessionFrame[] = [];
    yield* session.events.pipe(Stream.runForEach(frame => Effect.sync(() => { seen.push(frame); })), Effect.forkScoped);
    // Streamed text, a user message, state and submission changes, a notice and an open dialog.
    yield* session.act({ _tag: "prompt", text: "hello" });
    yield* session.act({ _tag: "prompt", text: "ask now" });
    while (!seen.some(f => f._tag === "dialog")) yield* Effect.sleep("10 millis");
    const later = yield* session.events.pipe(Stream.take(1), Stream.runCollect, Effect.map(frames => [...frames][0]));
    assert.equal(later._tag, "snapshot");
    if (later._tag !== "snapshot") return;
    while (seen.at(-1)!.cursor.sequence < later.cursor.sequence) yield* Effect.sleep("10 millis");
    const [first, ...events] = seen.filter(f => f.cursor.sequence <= later.cursor.sequence);
    assert.equal(first._tag, "snapshot");
    if (first._tag !== "snapshot") return;
    const folded = events.reduce((snapshot, frame) => applySessionEvent(snapshot, frame), first.snapshot);
    assert.deepEqual(wire(folded), wire(later.snapshot));
    assert.equal(later.snapshot.dialogs.length, 1, "the comparison covers an open dialog");
    assert.ok(later.snapshot.messages.some(m => m.text === "echo: hello"));
  }).pipe(
    Effect.scoped, Effect.timeout("10 seconds"),
    Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))), Effect.provideService(PiCli, fakeCli),
  ));
});
