import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer, type Scope, Stream } from 'effect';
import { PiCli } from '../server/PiCli.ts';
import { PiSessions, PiSessionsLive } from '../server/PiSessions.ts';
import { readConversation } from '../server/SessionFiles.ts';
import type { HistoryPosition } from '../shared/wire.ts';
import { seedConversation } from './fixtures/ConversationHistory.ts';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

test('bookmarks persist globally in Pi, advance only the leaf, reject stale operations and survive reopen', { timeout: 30000 }, async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel('disabled');
  const cwd = fixture.project('bookmarks');
  const seed = seedConversation(cwd, fixture.sessionDir);
  const run = <A, E>(effect: Effect.Effect<A, E, PiSessions | Scope.Scope>) => Effect.runPromise(effect.pipe(Effect.scoped,
    Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))), Effect.provideService(PiCli, fixture.cli())));
  let previous: HistoryPosition;
  try {
    await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd, sessionId: seed.sessionId, sessionFile: seed.file });
      const tree = yield* session.act({ _tag: 'conversation_tree' });
      assert.equal(tree?._tag, 'conversation_tree');
      if (tree?._tag !== 'conversation_tree') return;
      assert.equal(tree.tree.bookmarkUnavailable, undefined);
      const before = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      const action = { _tag: 'bookmark', requestId: 'one', entryId: seed.abandoned, label: 'Useful decision', expected: tree.tree.position } as const;
      const changed = yield* session.act(action);
      assert.equal(changed?._tag, 'bookmark');
      if (changed?._tag !== 'bookmark') return;
      assert.equal(changed.outcome, 'success', changed.detail);
      assert.equal(changed.requestId, 'one');
      assert.equal(changed.tree?.entries.find(e => e.id === seed.abandoned)?.label, 'Useful decision');
      assert.equal(changed.tree?.entries.find(e => e.id === changed.tree?.leafId)?.parentId, seed.leaf);
      const after = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      if (before[0]._tag === 'snapshot' && after[0]._tag === 'snapshot') assert.deepEqual(after[0].snapshot.messages, before[0].snapshot.messages);
      const stale = yield* session.act({ ...action, requestId: 'stale', label: 'Lost update' }).pipe(Effect.flip);
      assert.match(stale.detail, /session changed/);
      assert.equal(readFileSync(seed.file, 'utf8').includes('Lost update'), false);
      assert.equal((yield* session.state).historyOperation?.outcome, 'success');
      assert.ok(changed.tree);
      previous = changed.tree.position;
    }));
    await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd, sessionId: seed.sessionId, sessionFile: seed.file });
      const tree = yield* session.act({ _tag: 'conversation_tree' });
      if (tree?._tag !== 'conversation_tree') throw new Error('tree unavailable');
      assert.equal(tree.tree.entries.find(e => e.id === seed.abandoned)?.label, 'Useful decision');
      const stale = yield* session.act({ _tag: 'bookmark', requestId: 'old-process', entryId: seed.abandoned, label: 'Stale generation', expected: previous }).pipe(Effect.flip);
      assert.match(stale.detail, /session changed/);
      const action = { _tag: 'bookmark', requestId: 'rename', entryId: seed.abandoned, label: 'Renamed decision', expected: tree.tree.position } as const;
      const results = yield* Effect.all([session.act(action).pipe(Effect.result), session.act({ ...action, requestId: 'racer', label: 'Race' }).pipe(Effect.result)], { concurrency: 'unbounded' });
      assert.equal(results.filter(r => r._tag === 'Success').length, 1, 'one tab wins admission');
      const current = yield* session.act({ _tag: 'conversation_tree' });
      if (current?._tag !== 'conversation_tree') throw new Error('tree unavailable');
      const removed = yield* session.act({ ...action, requestId: 'remove', label: '', expected: current.tree.position });
      assert.equal(removed?._tag, 'bookmark');
      if (removed?._tag === 'bookmark') assert.equal(removed.tree?.entries.find(e => e.id === seed.abandoned)?.label, undefined);
    }));
    const saved = await Effect.runPromise(readConversation(seed.file, seed.sessionId));
    if (saved._tag === 'conversation_tree') assert.equal(saved.tree.entries.find(e => e.id === seed.abandoned)?.label, undefined);
    // A successful append must not become uncertain just because its target
    // falls off the browser's 2,000-row window during readback.
    const bounded = SessionManager.open(seed.file);
    while (bounded.getEntries().length < 2000) bounded.appendCustomEntry('limit-fixture', {});
    const oldest = bounded.getEntries()[0].id;
    await run(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd, sessionId: seed.sessionId, sessionFile: seed.file });
      const tree = yield* session.act({ _tag: 'conversation_tree' });
      if (tree?._tag !== 'conversation_tree') throw new Error('tree unavailable');
      assert.ok(tree.tree.entries.some(e => e.id === oldest));
      const result = yield* session.act({ _tag: 'bookmark', requestId: 'window-edge', entryId: oldest, label: 'Outside window', expected: tree.tree.position });
      assert.equal(result?._tag, 'bookmark');
      if (result?._tag === 'bookmark') {
        assert.equal(result.outcome, 'success', result.detail);
        assert.equal(result.tree?.entries.some(e => e.id === oldest), false);
      }
    }));
    assert.equal(SessionManager.open(seed.file).getLabel(oldest), 'Outside window');
    assert.equal(fixture.observe().requests.length, 0, 'bridge never becomes model input');
  } finally { await fixture.close(); }
});
