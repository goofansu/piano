import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { PiCli } from '../server/PiCli.ts';
import { PiRequestTimeoutMs, PiSessions, PiSessionsLive } from '../server/PiSessions.ts';

for (const mode of ['missing', 'version', 'wrong-source', 'rejected', 'lost', 'wrong-result']) {
  test(`history bridge ${mode}: correlated outcome, no fallback or blind retry`, async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd: process.cwd(), sessionId: mode });
      const tree = yield* session.act({ _tag: 'conversation_tree' });
      if (tree?._tag !== 'conversation_tree') throw new Error('tree unavailable');
      const action = { _tag: 'bookmark', requestId: 'client-operation', entryId: 'first', label: 'Bookmark', expected: tree.tree.position } as const;
      if (mode === 'missing' || mode === 'version' || mode === 'wrong-source') {
        const error = yield* session.act(action).pipe(Effect.flip);
        assert.match(error.detail, /extension.*(unavailable|incompatible)/);
        assert.equal((yield* session.state).sessionName, 'prompts:0');
        assert.equal((yield* session.state).isQuiescent, true);
      } else if (mode === 'rejected') {
        const error = yield* session.act(action).pipe(Effect.flip);
        assert.equal(error.detail, 'fixture veto');
        assert.deepEqual(yield* session.act({ _tag: 'conversation_tree' }), tree);
        assert.equal((yield* session.state).isQuiescent, true);
      } else {
        const result = yield* session.act(action);
        assert.equal(result?._tag, 'bookmark');
        if (result?._tag === 'bookmark') {
          assert.equal(result.requestId, 'client-operation'); assert.equal(result.outcome, 'uncertain');
        }
        assert.equal((yield* session.state).isQuiescent, false, 'uncertain writes pin the host');
        assert.equal((yield* session.state).historyOperation?.outcome, 'uncertain');
        const after = yield* session.act({ _tag: 'conversation_tree' });
        if (after?._tag === 'conversation_tree') assert.equal(after.tree.entries.find(e => e.id === 'first')?.label, 'Bookmark');
        assert.match((yield* session.act(action).pipe(Effect.flip)).detail, /uncertain/);
        assert.match((yield* session.act({ _tag: 'prompt', text: 'new input' }).pipe(Effect.flip)).detail, /uncertain/);
        yield* session.act({ _tag: 'abort' });
      }
    }).pipe(Effect.timeout('5 seconds'), Effect.scoped,
      Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(PiRequestTimeoutMs, 100),
      Effect.provideService(PiCli, { node: process.execPath, cli: new URL('./fake-history-pi.mjs', import.meta.url).pathname, extraArgs: ['--history-fixture', mode] })));
  });
}
