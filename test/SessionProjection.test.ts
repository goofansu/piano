import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { peekSession } from '../server/SessionFiles.ts';
import { Catalog, CatalogLive } from '../server/Catalog.ts';
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { PiCli } from '../server/PiCli.ts';
import { PiSessions, PiSessionsLive, type PiSession } from '../server/PiSessions.ts';
import type { SessionEvent } from '../shared/wire.ts';

const cli = { node: process.execPath, cli: new URL('./fake-projection-pi.mjs', import.meta.url).pathname, extraArgs: [] };
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>) => Effect.runPromise(effect.pipe(
  Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))), Effect.provideService(PiCli, cli),
));
const snapshot = (session: PiSession) => session.events.pipe(Stream.take(1), Stream.runCollect, Effect.map(es => {
  assert.equal(es[0]._tag, 'snapshot'); return (es[0] as Extract<SessionEvent, { _tag: 'snapshot' }>).snapshot;
}));
const observe = (session: PiSession, text: string) => Effect.gen(function* () {
  const ready = yield* Deferred.make<void>();
  const observed = yield* session.events.pipe(
    Stream.tap(e => e._tag === 'snapshot' ? Deferred.succeed(ready, undefined) : Effect.void),
    Stream.takeUntil(e => e._tag === 'notice' && e.message === 'barrier ' + text),
    Stream.runCollect, Effect.forkChild,
  );
  yield* Deferred.await(ready);
  yield* session.act({ _tag: 'prompt', text });
  return yield* Fiber.join(observed);
});

test('content-indexed endings replace drafts and cumulative usage is not added', async () => {
  await run(Effect.gen(function* () {
    const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: 'projection' });
    const events = yield* observe(session, '/partial');
    const updates = events.filter(e => e._tag === 'message_update');
    const last = updates.at(-1)!;
    assert.equal(last.message.text, 'first corrected second corrected');
    assert.deepEqual(last.message.toolCalls?.map(c => [c.id, c.args]), [['parent', '{\n  "code": "correct"\n}'], ['other', '']]);
    assert.equal(last.message.usage?.totalTokens, 13);
    assert.equal((yield* snapshot(session)).pending?.text, last.message.text);
    yield* session.act({ _tag: 'set_thinking_level', level: 'max' });
    assert.equal((yield* session.state).thinkingLevel, 'low', 'read back a clamp even without an event');
  }).pipe(Effect.timeout('5 seconds'), Effect.scoped));
});

test('safe live/reload output retains tools and extension state without inventing transcript or usage', async () => {
  const secret = 'P3SecretCanary-123456789';
  process.env.PIANO_TEST_SECRET = secret;
  try {
    await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: 'safe-projection' });
      yield* observe(session, '/partial');
      const partial = yield* observe(session, '/secret');
      assert.ok(!JSON.stringify(partial).includes(secret.slice(0, 12)), 'hold a known-secret prefix across chunks');
      assert.ok(!JSON.stringify(yield* snapshot(session)).includes(secret.slice(0, 12)), 'partial reload uses the same protection');
      const events = yield* observe(session, '/finish');
      assert.ok(!JSON.stringify(events).includes(secret));
      const snap = yield* snapshot(session);
      assert.ok(!JSON.stringify(snap).includes(secret));
      assert.equal(snap.state.model, 'router/auto');
      const reply = snap.messages.find(m => m.role === 'assistant')!;
      assert.equal(reply.model, 'physical/answer'); assert.equal(reply.thinkingLevel, 'high');
      assert.match(reply.text, /^FINAL corrected \[REDACTED\]/);
      assert.equal(reply.usage?.totalTokens, 15);
      assert.equal(snap.messages.filter(m => m.role === 'tool_result').length, 1, 'nested execution is not another transcript result');
      assert.equal(snap.messages.find(m => m.role === 'tool_result')?.usage?.totalTokens, 18);
      assert.equal(snap.state.tokens?.total, 150, 'Pi full-session totals are independent of context messages and previews');
      assert.equal(snap.state.cost, 1.23);
      const nested = events.filter(e => e._tag === 'tool_update').filter(e => e.tool.id === 'parent/1');
      assert.equal(nested.at(-2)?.tool.text, 'latest preview', 'partialResult is latest update, not unconditional append');
      assert.equal(nested.at(-1)?.tool.text, 'nested final [REDACTED]');
      assert.equal(nested.at(-1)?.tool.parentId, 'parent');
      assert.equal(snap.messages.find(m => m.role === 'tool_result')?.nestedCalls?.[0].status, 'success', 'Pi persists ok, not success');
      assert.match(snap.state.extension?.statuses[0].text ?? '', /Projection ready/);
      assert.match(snap.state.extension?.widgets[0].lines[0] ?? '', /<script>/, 'markup remains inert data for the renderer');
      assert.match(snap.state.extension?.editorRequest?.text ?? '', /Suggested follow-up/);
      yield* observe(session, '/clear');
      assert.deepEqual((yield* snapshot(session)).state.extension?.statuses, []);
      assert.deepEqual((yield* snapshot(session)).state.extension?.widgets, []);
      yield* observe(session, '/compact');
      const compacted = yield* snapshot(session);
      assert.deepEqual(compacted.messages.map(m => m.text), ['Authoritative compacted context [REDACTED]']);
      yield* observe(session, '/edit-context');
      assert.deepEqual((yield* snapshot(session)).messages.map(m => m.text), ['Authoritative context edit']);
      yield* observe(session, '/select-secret');
      const dialog = (yield* snapshot(session)).dialogs[0];
      assert.deepEqual(dialog.options, ['[REDACTED]']);
      const optionReady = yield* Deferred.make<void>();
      const optionReceived = yield* session.events.pipe(Stream.tap(e => e._tag === 'snapshot' ? Deferred.succeed(optionReady, undefined) : Effect.void),
        Stream.takeUntil(e => e._tag === 'notice' && e.message === 'original option received'), Stream.runCollect, Effect.forkChild);
      yield* Deferred.await(optionReady);
      yield* session.act({ _tag: 'answer', id: dialog.id, generation: dialog.generation, value: '[REDACTED]' });
      yield* Fiber.join(optionReceived);
      const error = yield* session.act({ _tag: 'prompt', text: '/error' }).pipe(Effect.flip);
      assert.equal(error.detail, 'Rejected [REDACTED]');
      const ready = yield* Deferred.make<void>();
      const closed = yield* session.events.pipe(Stream.tap(e => e._tag === 'snapshot' ? Deferred.succeed(ready, undefined) : Effect.void), Stream.runCollect, Effect.forkChild);
      yield* Deferred.await(ready);
      yield* session.act({ _tag: 'prompt', text: '/crash' }).pipe(Effect.ignore);
      assert.ok(!JSON.stringify(yield* Fiber.join(closed)).includes(secret), 'exit and stderr are projected too');
    }).pipe(Effect.timeout('5 seconds'), Effect.scoped));
  } finally { delete process.env.PIANO_TEST_SECRET; }
});

test('reopening uses Pi context edits, compaction and active branch without replacing virtual selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'piano-projection-file-'));
  const secret = 'sk-file-canary-123456789';
  try {
    const manager = SessionManager.create(root, root);
    manager.appendModelChange('router', 'auto'); manager.appendThinkingLevelChange('low');
    const first = manager.appendMessage({ role: 'user', content: 'old prompt', timestamp: 1 });
    const reply = manager.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'physical', model: 'answer', content: [{ type: 'text', text: `original ${secret}` }], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2 });
    manager.appendMessage({ role: 'user', content: 'abandoned branch', timestamp: 3 });
    manager.branch(reply);
    manager.appendContextEdit(reply, { content: `edited ${secret}` });
    manager.appendCompaction('summary', reply, 30);
    const file = manager.getSessionFile()!;
    const original = readFileSync(file, 'utf8');
    const snap = await Effect.runPromise(peekSession(file, manager.getSessionId()));
    assert.equal(snap.state.model, 'router/auto'); assert.equal(snap.state.thinkingLevel, 'low');
    assert.deepEqual(snap.messages.map(m => m.text), ['summary', 'edited [REDACTED]']);
    assert.equal(snap.messages[1].model, 'physical/answer');
    assert.equal(snap.messages.some(m => m.id === first), false);
    assert.equal(snap.state.cost, undefined, 'a file peek must not invent full-session accounting from context');
    assert.equal(readFileSync(file, 'utf8'), original, 'redaction never rewrites Pi history');
    assert.ok(original.includes(secret));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('catalog observations and caches belong to the requested cwd', async () => {
  const root = mkdtempSync(join(tmpdir(), 'piano-catalog-'));
  try {
    await run(Effect.gen(function* () {
      const catalog = yield* Catalog;
      const home = yield* catalog.get(tmpdir());
      const project = yield* catalog.get(root);
      assert.equal(project.cwd, root); assert.equal(project.models[0].name, root);
      assert.equal(home.cwd, tmpdir()); assert.equal(home.models[0].name, tmpdir());
      assert.equal((yield* catalog.get(root)).models[0].name, root);
    }).pipe(Effect.provide(CatalogLive), Effect.scoped));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
