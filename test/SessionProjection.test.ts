import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { DirectoryFacts, DirectoryFactsLive } from '../server/DirectoryFacts.ts';
import { PiCli } from '../server/PiCli.ts';
import { type PiSession, PiSessions, PiSessionsLive } from '../server/PiSessions.ts';
import type { SessionEvent } from '../shared/wire.ts';

const cli = { node: process.execPath, cli: new URL('./fake-projection-pi.mjs', import.meta.url).pathname, extraArgs: [] };
const delegationCli = { node: process.execPath, cli: new URL('./fake-delegation-pi.mjs', import.meta.url).pathname, extraArgs: [] };
const run = <A, E>(effect: Effect.Effect<A, E, PiSessions>, selectedCli = cli) => Effect.runPromise(effect.pipe(
  Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))), Effect.provideService(PiCli, selectedCli),
));
const snapshot = (session: PiSession) => session.events.pipe(Stream.take(1), Stream.runCollect, Effect.map(es => {
  assert.equal(es[0]._tag, 'snapshot'); return (es[0] as Extract<SessionEvent, { _tag: 'snapshot' }>).snapshot;
}));
const observe = (session: PiSession, text: string, projected?: (e: SessionEvent) => boolean) => Effect.gen(function* () {
  const ready = yield* Deferred.make<void>();
  let sawBarrier = false, sawProjection = !projected;
  const observed = yield* session.events.pipe(
    Stream.tap(e => e._tag === 'snapshot' ? Deferred.succeed(ready, undefined) : Effect.void),
    Stream.takeUntil(e => {
      if (e._tag === 'notice' && e.message === 'barrier ' + text) sawBarrier = true;
      if (projected?.(e)) sawProjection = true;
      return sawBarrier && sawProjection;
    }),
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
      // Readback no longer blocks protocol consumption: a subsequent Pi notify
      // is not a barrier for the host's asynchronous authoritative projection.
      yield* observe(session, '/compact', e => e._tag === 'context' && e.messages[0]?.text === 'Authoritative compacted context [REDACTED]');
      const compacted = yield* snapshot(session);
      assert.deepEqual(compacted.messages.map(m => m.text), ['Authoritative compacted context [REDACTED]']);
      yield* observe(session, '/edit-context', e => e._tag === 'context' && e.messages[0]?.text === 'Authoritative context edit');
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

test('subagent details project through PiSessions with correlation, lifecycle limits and safe fallback', async () => {
  const secret = 'sk-delegation-test-secret-123456789';
  process.env.PIANO_TEST_SECRET = secret;
  try {
    await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: 'delegation-projection' });
      const initial = yield* snapshot(session);
      assert.ok(!JSON.stringify(initial).includes(secret), 'projected labels, prompts and results use display redaction');

      const cards = initial.messages.flatMap(message => message.subagent ? [message.subagent] : []);
      const admitted = cards.filter((card): card is Extract<typeof card, { kind: 'delegation' }> => card.kind === 'delegation' && card.admitted);
      assert.deepEqual(admitted.map(card => [card.action, card.label, card.profile, card.status, card.runId]), [
        ['start', 'Same label', 'reviewer', 'Completed', 'run-done'],
        ['resume', 'Same label', 'reviewer', 'Failed', 'run-failed'],
        ['start', 'Same label', 'reviewer', 'Cancelled', 'run-cancelled'],
        ['start', 'Same label', 'reviewer', 'Started', 'run-open'],
      ]);
      assert.match(admitted[0].prompt ?? '', /\[REDACTED\]/);
      const notice = cards.find((card): card is Extract<typeof card, { kind: 'result' }> => card.kind === 'result' && card.source === 'notification');
      assert.equal(notice?.terminalStatus, 'completed');
      const waited = cards.find((card): card is Extract<typeof card, { kind: 'collection' }> => card.kind === 'collection')!;
      assert.equal(waited.label, 'Same label');
      assert.deepEqual(waited.runs.map(run => [run.runId, run.status, run.subagentId]), [['run-failed', 'failed', 'subagent-stable']]);
      assert.equal(waited.stillRunning, 0, 'collections carry counts, not inferred active identities');
      const mixed = initial.messages.find(message => message.toolCallId === 'wait-mixed')?.subagent;
      assert.equal(mixed?.kind, 'collection');
      if (mixed?.kind === 'collection') {
        assert.equal(mixed.runId, undefined, 'a partial collection is not the one completed Run');
        assert.equal(mixed.terminalStatus, undefined);
        assert.equal(mixed.status, 'Delivered 1 result · 1 still running when checked');
        assert.deepEqual(mixed.runs.map(run => [run.runId, run.status]), [['run-done', 'completed']]);
      }
      const cancellation = cards.find((card): card is Extract<typeof card, { kind: 'cancellation' }> => card.kind === 'cancellation' && card.outcomes.some(outcome => outcome.kind === 'requested'))!;
      assert.equal(cancellation.status, 'Cancellation requested: 1');
      assert.equal(admitted.find(card => card.runId === 'run-cancelled')?.terminalStatus, 'cancelled');
      const steering = cards.find((card): card is Extract<typeof card, { kind: 'control' }> => card.kind === 'control')!;
      assert.equal(steering.message, 'Use the exact full guidance.');
      assert.equal(initial.messages.find(message => message.toolCallId === 'steer-open')?.text, 'Guidance entered the local mailbox; delivery is not confirmed.');
      const refusal = cards.find((card): card is Extract<typeof card, { kind: 'delegation' }> => card.kind === 'delegation' && !card.admitted)!;
      assert.equal(refusal.status, 'Start refused · unknown Agent');
      assert.equal(initial.messages.find(message => message.toolCallId === 'refused-start')?.text, 'The requested profile does not exist. No Run was started.');
      const checkedOpen = cards.find((card): card is Extract<typeof card, { kind: 'result' }> => card.kind === 'result' && card.runId === 'run-open');
      assert.equal(checkedOpen?.status, 'Still running when checked');
      assert.equal(checkedOpen?.terminalStatus, undefined, 'a query or cancellation request does not settle a Run');
      assert.equal(admitted.find(card => card.runId === 'run-open')?.status, 'Started', 'a query and cancellation request do not manufacture a terminal state');
      assert.equal(initial.messages.find(message => message.toolCallId === 'bad-start')?.subagent, undefined);
      assert.equal(initial.messages.find(message => message.toolCallId === 'bad-start')?.text, 'Readable malformed fallback');

      yield* observe(session, '/delegation-live');
      const live = yield* snapshot(session);
      const liveCards = live.messages.flatMap(message => message.subagent ? [message.subagent] : []).filter(card => card.kind !== 'cancellation');
      const liveDelegation = liveCards.find((card): card is Extract<typeof card, { kind: 'delegation' }> => card.kind === 'delegation' && card.runId === 'run-live');
      assert.deepEqual([liveDelegation?.action, liveDelegation?.label, liveDelegation?.profile, liveDelegation?.subagentId], ['resume', 'Live delegation', 'reviewer', 'subagent-stable'], 'live records retain historical Subagent correlation');
      assert.equal(liveCards.some(card => card.kind === 'result' && card.runId === 'run-live' && card.terminalStatus === 'cancelled'), true);
    }).pipe(Effect.timeout('5 seconds'), Effect.scoped), delegationCli);
  } finally { delete process.env.PIANO_TEST_SECRET; }
});

test('delegation fixture continues and persists an existing Pi JSONL session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'piano-delegation-history-'));
  const file = join(root, 'history.jsonl');
  const historical = [
    { type: 'session', version: 3, id: 'persisted-delegation', cwd: root, timestamp: new Date().toISOString() },
    { type: 'message', id: 'a1', parentId: null, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'persisted-start', name: 'agent_start', arguments: { agent: 'historian', description: 'Historical task', prompt: 'Inspect history' } }] } },
    { type: 'message', id: 'r1', parentId: 'a1', timestamp: new Date().toISOString(), message: { role: 'toolResult', toolCallId: 'persisted-start', toolName: 'agent_start', content: [{ type: 'text', text: 'Started persisted run' }], details: { kind: 'start', rowPhrase: 'Started', tone: 'toolTitle', agent: 'historian', runId: 'persisted-run', subagentId: 'persisted-subagent' } } },
  ];
  writeFileSync(file, historical.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  try {
    await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: root, sessionId: 'persisted-delegation', sessionFile: file });
      yield* observe(session, '/delegation-live');
      const snap = yield* snapshot(session);
      const resumed = snap.messages.find(message => message.subagent?.kind === 'delegation' && message.subagent.runId === 'run-live')?.subagent;
      assert.equal(resumed?.kind, 'delegation');
      if (resumed?.kind === 'delegation') assert.deepEqual([resumed.profile, resumed.subagentId], ['historian', 'persisted-subagent']);
      const persisted = readFileSync(file, 'utf8');
      assert.match(persisted, /"runId":"run-live"/);
      assert.match(persisted, /"customType":"subagent-notification"/);
    }).pipe(Effect.timeout('5 seconds'), Effect.scoped), delegationCli);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('catalog observations and caches belong to the requested cwd', async () => {
  const tmp = realpathSync(tmpdir()), root = mkdtempSync(join(tmp, 'piano-catalog-'));
  try {
    await run(Effect.gen(function* () {
      const facts = yield* DirectoryFacts;
      const home = yield* facts.catalog(tmp);
      const project = yield* facts.catalog(root);
      assert.equal(project.cwd, root); assert.equal(project.models[0].name, root);
      assert.equal(home.cwd, tmp); assert.equal(home.models[0].name, tmp);
      assert.equal((yield* facts.catalog(root)).models[0].name, root);
    }).pipe(Effect.provide(DirectoryFactsLive), Effect.scoped));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
