import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Layer, type Scope, Stream } from 'effect';
import { makeDelivery } from '../server/BoundedDelivery.ts';
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
