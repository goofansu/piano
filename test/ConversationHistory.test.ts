import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer, Stream } from 'effect';
import { PiCli } from '../server/PiCli.ts';
import { PiSessions, PiSessionsLive } from '../server/PiSessions.ts';
import { readConversation } from '../server/SessionFiles.ts';
import { seedConversation } from './fixtures/ConversationHistory.ts';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

test('inactive tree retains IDs, hidden ancestors, forests and global labels without rewriting history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'piano-tree-'));
  try {
    const seed = seedConversation(root, root);
    const before = readFileSync(seed.file, 'utf8');
    const result = await Effect.runPromise(readConversation(seed.file, seed.sessionId));
    assert.equal(result._tag, 'conversation_tree');
    if (result._tag !== 'conversation_tree') return;
    const tree = result.tree;
    assert.equal(tree.leafId, seed.leaf);
    assert.equal(tree.entries.find(e => e.id === seed.first)?.parentId, seed.model);
    assert.equal(tree.entries.find(e => e.id === seed.model)?.technical, true);
    assert.equal(tree.entries.find(e => e.id === seed.otherRoot)?.parentId, null);
    assert.equal(tree.entries.find(e => e.id === seed.abandoned)?.label, 'Return point');
    assert.equal(tree.entries.find(e => e.id === seed.abandoned)?.onCurrentPath, false);
    assert.equal(tree.entries.find(e => e.id === seed.active)?.onCurrentPath, true);
    const detail = await Effect.runPromise(readConversation(seed.file, seed.sessionId, seed.active));
    assert.equal(detail._tag, 'conversation_detail');
    if (detail._tag !== 'conversation_detail') return;
    assert.equal(detail.detail.text.length, 32000);
    assert.equal(detail.detail.truncated, true);
    assert.equal(detail.detail.omittedImages, 1);
    assert.match(detail.detail.text, /\[REDACTED\]/);
    assert.ok(!JSON.stringify([tree, detail]).includes('BASE64_CANARY'));
    assert.ok(!JSON.stringify([tree, detail]).includes('CUSTOM_CANARY'));
    assert.ok(!JSON.stringify([tree, detail]).includes('sk-tree-canary'));
    assert.equal(readFileSync(seed.file, 'utf8'), before);
    await assert.rejects(Effect.runPromise(readConversation(seed.file, 'wrong-id')));
    await assert.rejects(Effect.runPromise(readConversation(seed.file, seed.sessionId, 'not-an-entry')));
    await assert.rejects(Effect.runPromise(readConversation(join(root, 'missing'), seed.sessionId)));
    // Labels outside the bounded window still resolve, and a very old selected
    // position is retained even when most of the history cannot be returned.
    for (let n = 0; n < 2100; n++) seed.manager.appendCustomEntry('bounded', {});
    seed.manager.appendLabelChange(seed.first, 'old bookmark');
    const bounded = await Effect.runPromise(readConversation(seed.file, seed.sessionId));
    assert.equal(bounded._tag, 'conversation_tree');
    if (bounded._tag === 'conversation_tree') {
      assert.equal(bounded.tree.entries.length, 2000); assert.equal(bounded.tree.truncated, true);
      assert.ok(JSON.stringify(bounded).length < 1_000_000);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('locked Pi live tree and on-demand previews leave Pi context, position and saved bytes unchanged', { timeout: 30000 }, async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel('disabled');
  const cwd = fixture.project('history');
  const seed = seedConversation(cwd, fixture.sessionDir);
  writeFileSync(join(cwd, '.pi', 'extensions', 'tree-fixture.ts'), `export default function(pi) {
    pi.registerCommand('fixture-position', { handler: async (id, ctx) => { await ctx.navigateTree(id, { summarize: false }); } });
  }`);
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const session = yield* (yield* PiSessions).open({ cwd, sessionId: seed.sessionId, sessionFile: seed.file });
      const before = readFileSync(seed.file, 'utf8');
      const snapshot = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      const tree = yield* session.act({ _tag: 'conversation_tree' });
      assert.equal(tree?._tag, 'conversation_tree');
      if (tree?._tag !== 'conversation_tree') return;
      assert.equal(tree.tree.leafId, seed.leaf);
      assert.equal(tree.tree.entries.find(e => e.id === seed.abandoned)?.label, 'Return point');
      for (const entryId of [seed.first, seed.abandoned, seed.compact, seed.active]) {
        const result = yield* session.act({ _tag: 'conversation_detail', entryId });
        assert.equal(result?._tag, 'conversation_detail');
      }
      assert.deepEqual(yield* session.act({ _tag: 'conversation_tree' }), tree);
      const after = yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      assert.equal(after[0]._tag, 'snapshot'); assert.equal(snapshot[0]._tag, 'snapshot');
      if (after[0]._tag === 'snapshot' && snapshot[0]._tag === 'snapshot') assert.deepEqual(after[0].snapshot.messages, snapshot[0].snapshot.messages);
      assert.equal(readFileSync(seed.file, 'utf8'), before);
      // Native navigation changes only the live leaf. Reading its file instead
      // would report the wrong position, even though no entries were appended.
      yield* session.act({ _tag: 'prompt', text: `/fixture-position ${seed.answer}` });
      const moved = yield* session.act({ _tag: 'conversation_tree' });
      assert.equal(moved?._tag, 'conversation_tree');
      if (moved?._tag === 'conversation_tree') assert.equal(moved.tree.leafId, seed.answer);
      const persisted = yield* readConversation(seed.file, seed.sessionId);
      if (persisted._tag === 'conversation_tree') assert.equal(persisted.tree.leafId, seed.leaf);
      yield* session.act({ _tag: 'prompt', text: `/fixture-position ${seed.first}` });
      const root = yield* session.act({ _tag: 'conversation_tree' });
      if (root?._tag === 'conversation_tree') assert.equal(root.tree.leafId, seed.model, 'selecting a user entry moves before it');
    }).pipe(Effect.scoped, Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer))), Effect.provideService(PiCli, fixture.cli())));
    assert.equal(fixture.observe().requests.length, 0);
  } finally { await fixture.close(); }
});
