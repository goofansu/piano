// Locked CLI discovery/UI compatibility without model calls or developer resources.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { PiCli } from '../server/PiCli.ts';
import { PiSessions, PiSessionsLive } from '../server/PiSessions.ts';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

test('real Pi loads project-only virtual models and retained supported UI from the selected cwd', async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel('disabled');
  const cwd = fixture.project('projection-models');
  writeFileSync(join(cwd, '.pi', 'extensions', 'projection.ts'), `export default function(pi) {
    pi.registerVirtualModel({ provider: 'phase3', id: 'auto', name: 'Project-only router', thinkingLevels: ['low','high'], contextWindow: 1000, maxTokens: 128,
      route() { throw new Error('This no-model fixture must not route a request'); }
    });
    pi.registerCommand('phase3-state', { handler: async (_args, ctx) => {
      await pi.setModel(ctx.modelRegistry.find('phase3', 'auto'));
      pi.setThinkingLevel('high');
      ctx.ui.setStatus('projection', 'real status');
      ctx.ui.setWidget('projection', ['real widget'], { placement: 'belowEditor' });
      ctx.ui.setTitle('real extension title');
      ctx.ui.setEditorText('real editor request');
      ctx.ui.notify('PHASE3_READY');
    } });
  }`);
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const sessions = yield* PiSessions;
      const global = yield* sessions.probe(fixture.root);
      const project = yield* sessions.probe(cwd);
      assert.equal(global.models.some(model => model.provider === 'phase3'), false);
      assert.equal(project.models.some(model => model.provider === 'phase3' && model.id === 'auto'), true);
      const session = yield* sessions.open({ cwd, sessionId: 'real-projection' });
      const ready = yield* Deferred.make<void>();
      const observed = yield* session.events.pipe(
        Stream.tap(event => event._tag === 'snapshot' ? Deferred.succeed(ready, undefined) : Effect.void),
        Stream.takeUntil(event => event._tag === 'notice' && event.message === 'PHASE3_READY'),
        Stream.runCollect, Effect.forkChild,
      );
      yield* Deferred.await(ready);
      yield* session.act({ _tag: 'prompt', text: '/phase3-state' });
      yield* Fiber.join(observed);
      const state = yield* session.state;
      assert.equal(state.model, 'phase3/auto'); assert.equal(state.thinkingLevel, 'high');
      assert.deepEqual(state.extension?.statuses, [{ key: 'projection', text: 'real status' }]);
      assert.deepEqual(state.extension?.widgets, [{ key: 'projection', lines: ['real widget'], placement: 'belowEditor' }]);
      assert.equal(state.extension?.title, 'real extension title');
      assert.equal(state.extension?.editorRequest?.text, 'real editor request');
      const snapshot = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      if (snapshot[0]._tag === 'snapshot') assert.deepEqual(snapshot[0].snapshot.state.extension, state.extension);
    }).pipe(
      Effect.timeout('20 seconds'), Effect.scoped,
      Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))), Effect.provideService(PiCli, fixture.cli()),
    ));
    assert.equal(fixture.observe().requests.length, 0);
  } finally { await fixture.close(); }
});
