// Real locked CLI check for --session reopening of an old alias-based reference.
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect, Layer, Stream } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { PiCli } from '../server/PiCli.ts';
import { PiSessionsLive } from '../server/PiSessions.ts';
import { Registry, RegistryLive, RegistryPath } from '../server/Registry.ts';
import { SessionHosts, SessionHostsLive } from '../server/SessionHosts.ts';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

test('real Pi reopens the exact legacy alias file without moving history or invoking a model', async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel('disabled');
  const cwd = fixture.project('ownership'), alias = join(fixture.root, 'old-alias');
  symlinkSync(cwd, alias);
  const oldEnv = [process.env.PI_CODING_AGENT_DIR, process.env.PI_CODING_AGENT_SESSION_DIR];
  process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
  process.env.PI_CODING_AGENT_SESSION_DIR = fixture.sessionDir;
  const file = join(fixture.sessionDir, 'legacy.jsonl');
  writeFileSync(file, [
    { type: 'session', version: 3, id: 'real-alias', cwd: alias, timestamp: '2026-10-05T00:00:00Z' },
    { type: 'message', id: 'saved', parentId: null, timestamp: '2026-10-05T00:00:01Z', message: { role: 'user', content: 'LEGACY_ALIAS_HISTORY', timestamp: 1 } },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const hosts = yield* SessionHosts, registry = yield* Registry;
      yield* registry.addSession(alias, 'real-alias');
      const s = yield* hosts.open({ cwd, sessionId: 'real-alias' });
      assert.equal((yield* s.state).sessionFile, file);
      const [snapshot] = yield* s.events.pipe(Stream.take(1), Stream.runCollect);
      assert.ok(snapshot._tag === 'snapshot');
      assert.equal(snapshot.snapshot.messages[0].text, 'LEGACY_ALIAS_HISTORY');
      assert.equal(yield* hosts.get(alias, 'real-alias'), s);
      yield* hosts.release(cwd, 'real-alias');
      const view = yield* hosts.peek(alias, 'real-alias');
      assert.equal(view.snapshot.state.sessionFile, file);
      assert.equal(view.snapshot.messages[0].text, 'LEGACY_ALIAS_HISTORY');
      assert.match(readFileSync(file, 'utf8'), /LEGACY_ALIAS_HISTORY/);
      assert.equal((yield* registry.get).sessions[0].cwd, alias);
    }).pipe(Effect.timeout('15 seconds'), Effect.scoped,
      Effect.provide(SessionHostsLive({ idleMs: 0 }).pipe(Layer.provide(PiSessionsLive), Layer.provideMerge(RegistryLive), Layer.provide(NodeServices.layer))),
      Effect.provideService(RegistryPath, join(fixture.root, 'registry.json')), Effect.provideService(PiCli, fixture.cli()),
    ));
    assert.equal(fixture.observe().requests.length, 0);
  } finally {
    for (const [i, key] of ['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR'].entries()) {
      if (oldEnv[i] === undefined) delete process.env[key]; else process.env[key] = oldEnv[i];
    }
    await fixture.close();
  }
});
