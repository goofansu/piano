import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Layer, Queue, type Scope, Stream } from 'effect';
import { makeDelivery, makeSocketDelivery, socketLimits } from '../server/BoundedDelivery.ts';
import { PiCli } from '../server/PiCli.ts';
import { type PiSession, PiSessions, PiSessionsLive } from '../server/PiSessions.ts';
import type { SessionFrame } from '../shared/wire.ts';

test('delivery byte budgets fail oversized frames and retained backlogs without blocking the producer', async () => {
  for (const [values, oversized] of [[['x'.repeat(65)], true], [['x'.repeat(40), 'y'.repeat(40)], false]] as const) {
    await Effect.runPromise(Effect.gen(function* () {
      const delivery = yield* makeDelivery<string>({ messages: 256, bytes: 64 });
      for (const value of values) yield* delivery.offer(value);
      const error = yield* delivery.failure.pipe(Effect.flip);
      assert.equal(error._tag, 'DeliveryOverflow'); assert.equal(error.oversized, oversized);
      const result = yield* delivery.stream.pipe(Stream.runCollect, Effect.result);
      assert.equal(result._tag, 'Failure', 'overflow cannot silently drain as a healthy completed delivery');
    }).pipe(Effect.timeout('1 second')));
  }
});

// A fake socket: `written` holds each frame the delivery wrote, as "<deliveryId>:<value>".
const socket = (limits: Partial<typeof socketLimits> = {}) => Effect.gen(function* () {
  const writes = yield* Queue.unbounded<string>();
  const written: string[] = [];
  const delivery = yield* makeSocketDelivery((text: string) => Queue.offer(writes, text).pipe(Effect.asVoid),
    (value: string, id) => `${id}:${value}`, { ...socketLimits, ackTimeout: '1 second', ...limits });
  // Drain what the writer could write now; anything still blocked waits for credit.
  const settle = Effect.sleep('20 millis').pipe(Effect.andThen(Queue.clear(writes)), Effect.map(texts => { written.push(...texts); return written.map(t => t.split(':')[0]).join(','); }));
  return { delivery, settle };
});

const scoped = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(work.pipe(Effect.scoped, Effect.timeout('5 seconds')));

test('INV-05: the socket window holds unacknowledged frames and cumulative acks release them in order', () => scoped(Effect.gen(function* () {
  const { delivery, settle } = yield* socket({ window: { frames: 2, bytes: 1024 } });
  for (const value of ['a', 'b', 'c', 'd', 'e', 'f']) yield* delivery.offer(value);
  assert.equal(yield* settle, '1,2', 'a saturated window stops writing');
  yield* delivery.ack(99); // never written: no credit
  assert.equal(yield* settle, '1,2');
  yield* delivery.ack(2); // out of order and cumulative: acknowledges 1 and 2
  assert.equal(yield* settle, '1,2,3,4');
  yield* delivery.ack(1); yield* delivery.ack(2); // stale: no extra credit
  assert.equal(yield* settle, '1,2,3,4');
  yield* delivery.ack(3);
  assert.equal(yield* settle, '1,2,3,4,5');
  yield* delivery.ack(5);
  assert.equal(yield* settle, '1,2,3,4,5,6');
  assert.equal(yield* delivery.closed.pipe(Effect.timeoutOption('20 millis'), Effect.map(o => o._tag)), 'None', 'acknowledged delivery stays open');
})));

test('INV-05: the socket window also bounds unacknowledged bytes', () => scoped(Effect.gen(function* () {
  const { delivery, settle } = yield* socket({ window: { frames: 32, bytes: 12 } });
  for (const value of ['xxxx', 'yyyy', 'zzzz']) yield* delivery.offer(value); // 6 bytes per frame
  assert.equal(yield* settle, '1,2');
  yield* delivery.ack(1);
  assert.equal(yield* settle, '1,2,3');
})));

test('INV-05: a missing acknowledgement closes the socket to retry later, even below the window', () => scoped(Effect.gen(function* () {
  const { delivery } = yield* socket({ ackTimeout: '50 millis' });
  yield* delivery.offer('a');
  const closed = yield* delivery.closed;
  assert.equal(closed.code, 1013); assert.match(closed.reason, /acknowledgement timed out/);
})));

test('INV-05: an oversized frame closes as too large and a lagging consumer closes to retry later', () => scoped(Effect.gen(function* () {
  const big = yield* socket({ frameBytes: 8, queue: { messages: 256, bytes: 1024 } });
  yield* big.delivery.offer('123456789');
  const tooLarge = yield* big.delivery.closed;
  assert.equal(tooLarge.code, 1009); assert.match(tooLarge.reason, /delivery limit/);
  assert.equal(yield* big.settle, '', 'an oversized frame is never written');
  const lagging = yield* socket({ window: { frames: 1, bytes: 1024 }, queue: { messages: 2, bytes: 1024 } });
  for (const value of ['a', 'b', 'c', 'd', 'e']) yield* lagging.delivery.offer(value);
  const behind = yield* lagging.delivery.closed;
  assert.equal(behind.code, 1013); assert.match(behind.reason, /reconnect for a current snapshot/);
  // The first close reason wins.
  yield* lagging.delivery.close('later', 1000);
  assert.equal((yield* lagging.delivery.closed).code, 1013);
})));

test('INV-05: writer failure closes delivery without exposing transport contents or retrying', () => scoped(Effect.gen(function* () {
  let attempts = 0;
  const delivery = yield* makeSocketDelivery(() => Effect.sync(() => { attempts++; }).pipe(Effect.andThen(Effect.die('private transport content'))), (value: string) => value);
  yield* delivery.offer('first');
  yield* delivery.offer('second');
  const closed = yield* delivery.closed;
  assert.equal(closed.code, 1013);
  assert.match(closed.reason, /reconnect/);
  assert.equal(closed.reason.includes('private transport content'), false);
  assert.equal(attempts, 1);
})));

const run = <A, E>(work: Effect.Effect<A, E, PiSessions | Scope.Scope>) => Effect.runPromise(work.pipe(
  Effect.scoped, Effect.timeout('10 seconds'),
  Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
  Effect.provideService(PiCli, { node: process.execPath, cli: new URL('./fake-host-pi.mjs', import.meta.url).pathname, extraArgs: [] }),
));
const snapshot = (session: PiSession) => session.events.pipe(Stream.take(1), Stream.runCollect, Effect.map(frames => {
  assert.equal(frames[0]._tag, 'snapshot'); return frames[0] as Extract<SessionFrame, { _tag: 'snapshot' }>;
}));
const prompt = (session: PiSession, text: string) => Effect.gen(function* () {
  const ready = yield* Deferred.make<void>();
  const watch = yield* session.events.pipe(
    Stream.tap(e => e._tag === 'snapshot' ? Deferred.succeed(ready, undefined) : Effect.void),
    Stream.takeUntil(e => e._tag === 'notice' && e.message === `barrier ${text}`), Stream.runCollect, Effect.forkChild,
  );
  yield* Deferred.await(ready);
  yield* session.act({ _tag: 'prompt', text });
  return yield* Fiber.join(watch);
});

test('INV-05/11: atomic attach identifies partial/tools/dialog/state and all subsequent redacted frames in order', async () => {
  const canary = 'sk-sequence-canary-123456789';
  process.env.PIANO_TEST_SECRET = canary;
  try {
    const cursor = await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: 'ordered' });
      const frames = yield* prompt(session, '/partial');
      for (let n = 1; n < frames.length; n++) {
        assert.equal(frames[n].cursor.sequence, frames[n - 1].cursor.sequence + 1);
        assert.equal(frames[n].cursor.generation, frames[0].cursor.generation);
        assert.equal(frames[n].cursor.cwd, process.cwd()); assert.equal(frames[n].cursor.sessionId, 'ordered');
      }
      yield* prompt(session, '/dialog');
      const attached = yield* snapshot(session);
      assert.match(attached.snapshot.pending!.text, /Partial ordered \[REDACTED\]/);
      assert.equal(attached.snapshot.tools?.[0].status, 'running');
      assert.equal(attached.snapshot.dialogs[0].generation, attached.cursor.generation);
      assert.equal(attached.snapshot.state.extension?.statuses[0].text, 'Status ordered');
      assert.ok(attached.cursor.sequence >= frames.at(-1)!.cursor.sequence);
      assert.ok(!JSON.stringify([frames, attached]).includes(canary));
      // Attach and mutate concurrently. A fact is either in the snapshot or strictly
      // after its cursor, never an unsequenced partial assembled outside the lock.
      const [observed] = yield* Effect.all([session.events.pipe(Stream.takeUntil(e => e._tag === 'notice' && e.message === 'barrier /partial'), Stream.runCollect),
        session.act({ _tag: 'prompt', text: '/partial' })], { concurrency: 'unbounded' });
      for (let i = 1; i < observed.length; i++) assert.equal(observed[i].cursor.sequence, observed[i - 1].cursor.sequence + 1);
      return attached.cursor;
    }));
    const replacement = await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: 'ordered' });
      return (yield* snapshot(session)).cursor;
    }));
    assert.notEqual(cursor.generation, replacement.generation);
    assert.ok(replacement.sequence < cursor.sequence, 'a replacement starts a fresh sequence, independently of the previous incarnation');
  } finally { delete process.env.PIANO_TEST_SECRET; }
});

test('INV-05: a held consumer fails bounded delivery while Pi and a fast subscriber continue; reconnect snapshots current state', async () => {
  await run(Effect.gen(function* () {
    const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: 'bounded' });
    const ready = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
    const slow = yield* session.events.pipe(Stream.runForEach(e => e._tag === 'snapshot'
      ? Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void), Effect.result, Effect.forkChild);
    yield* Deferred.await(ready);
    const fastReady = yield* Deferred.make<void>();
    const fast = yield* session.events.pipe(
      Stream.tap(e => e._tag === 'snapshot' ? Deferred.succeed(fastReady, undefined) : Effect.void),
      Stream.takeUntil(e => e._tag === 'notice' && e.message === 'burst complete'), Stream.runCollect, Effect.forkChild,
    );
    yield* Deferred.await(fastReady);
    yield* session.act({ _tag: 'prompt', text: '/burst' });
    const frames = yield* Fiber.join(fast);
    assert.ok(frames.length > 600);
    for (let n = 1; n < frames.length; n++) assert.equal(frames[n].cursor.sequence, frames[n - 1].cursor.sequence + 1);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(slow);
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') assert.equal(result.failure._tag, 'DeliveryOverflow');
    const latest = yield* snapshot(session);
    assert.ok(latest.cursor.sequence >= frames.at(-1)!.cursor.sequence);
    assert.equal(latest.snapshot.state.extension?.statuses.find(s => s.key === 'burst')?.text, 'burst 600');
    yield* prompt(session, '/after-overflow'); // stdout/commands remain responsive
  }));
});
