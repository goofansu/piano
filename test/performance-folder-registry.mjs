// Measurement, not a timing-sensitive CI test. Uses only a temporary registry and fake Pi.
// node test/performance-folder-registry.mjs [output.json]
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Layer, ManagedRuntime } from 'effect';
import WebSocket from 'ws';
import { Registry, RegistryDatabasePath, RegistryLive } from '../server/Registry.ts';
import { openRegistryDatabase } from '../server/RegistryDatabase.ts';
import { seedRegistry } from './fixtures/registry.ts';

const output = resolve(process.argv[2] ?? '/tmp/piano-performance.json');
const root = mkdtempSync(join(tmpdir(), 'piano-performance-'));
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
  environment: { node: process.version, kernel: release(), cpu: cpus()[0].model, cpus: availableParallelism(),
    filesystem: execFileSync('df', ['-T', root], { encoding: 'utf8' }).trim() },
  startedAt: new Date().toISOString(), scenarios: [],
};
const summary = values => {
  assert.ok(values.length);
  values.sort((a, b) => a - b);
  return Object.fromEntries([['count', values.length], ...[50, 95, 99, 100].map(p =>
    [p === 100 ? 'max' : `p${p}`, values[Math.ceil(values.length * p / 100) - 1]])]);
};
async function socket(url, origin) {
  const ws = new WebSocket(url, { origin });
  const waiters = new Set();
  ws.on('message', data => {
    const message = JSON.parse(data);
    if (message.deliveryId !== undefined) ws.send(JSON.stringify({ _tag: 'ack', deliveryId: message.deliveryId }));
    for (const waiter of waiters) waiter(message);
  });
  await once(ws, 'open');
  return {
    ws,
    request(message, matches) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(receive); reject(new Error(`Timed out: ${message._tag}`)); }, 15000);
        const receive = reply => {
          if (reply._tag !== 'error' && !matches(reply)) return;
          clearTimeout(timer); waiters.delete(receive);
          if (reply._tag === 'error') reject(new Error(reply.message)); else resolve(reply);
        };
        waiters.add(receive); ws.send(JSON.stringify(message));
      });
    },
  };
}
try {
  for (const [folders, sessions, entries, slow = false] of (process.env.PIANO_BENCH_SLOW_ONLY ? [[10, 100, 100, true]] : [[10, 100, 100], [20, 1000, 1000], [100, 5000, 10000], [10, 100, 100, true]])) {
    const scratch = join(root, `${sessions}-${slow}`), repo = join(scratch, 'repo'), listing = join(scratch, 'listing');
    for (const path of [repo, listing, ...['home', 'agent', 'sessions', 'config'].map(p => join(scratch, p))]) mkdirSync(path, { recursive: true });
    const env = { ...process.env, HOME: join(scratch, 'home'), XDG_CONFIG_HOME: join(scratch, 'config'),
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
    // Real directories, rather than mocked fs: includes stat and absent-.git costs.
    for (let i = 0; i < entries; i++) mkdirSync(join(listing, `folder-${i}`));
    const paths = Array.from({ length: folders }, (_, i) => join(repo, `workspace-${i}`));
    for (const path of paths) mkdirSync(path);
    const dbPath = join(scratch, 'piano.db'), now = new Date().toISOString();
    seedRegistry(dbPath, { folders: paths, projects: [{ id: 'bench', name: 'Initial', archived: false }],
      sessions: Array.from({ length: sessions }, (_, i) => ({ cwd: paths[i % folders], sessionId: `saved-${i}`,
        title: `Previous task ${i}`, createdAt: now, updatedAt: now, archived: i % 10 !== 0 })) });
    const backend = fork(resolve('server/main.ts'), [], { execArgv: ['--import', resolve('test/performance-monitor.mjs')],
      env: { ...env, HOST: '127.0.0.1', PORT: '0', PIANO_ALLOWED_ORIGINS: 'http://127.0.0.1:7172', PIANO_DB_PATH: dbPath,
        PIANO_PI_CLI: resolve('test/fake-pi.mjs'), PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(scratch, 'agent'),
        PIANO_BENCH_SLOW_PATH: slow ? listing : '',
        PI_CODING_AGENT_SESSION_DIR: join(scratch, 'sessions') }, silent: true });
    // main logs its configured port, so discover the ephemeral listener without altering production.
    let logs = ''; backend.stdout.on('data', d => logs += d); backend.stderr.on('data', d => logs += d);
    let writer, observer;
    try {
      let port;
      for (let attempt = 0; attempt < 150; attempt++) {
        assert.equal(backend.exitCode, null, logs);
        const listeners = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
        port = listeners.split('\n').find(line => line.includes(`pid=${backend.pid},`))?.match(/127\.0\.0\.1:(\d+)/)?.[1];
        if (port) break;
        await delay(100);
      }
      assert.ok(port, logs);
      const base = `http://127.0.0.1:${port}`, origin = 'http://127.0.0.1:7172';
      const request = async (path, body) => {
        const response = await fetch(`${base}${path}`, { ...(body ? { method: 'POST', body: JSON.stringify(body),
          headers: { origin, 'content-type': 'application/json' } } : {}), signal: AbortSignal.timeout(15000) });
        assert.equal(response.status, 200, await response.clone().text());
        return response.json();
      };
      writer = await socket(`${base.replace('http', 'ws')}/ws`, origin);
      observer = await socket(`${base.replace('http', 'ws')}/ws`, origin);
      const selected = await writer.request({ _tag: 'create_session', selectionId: 'bench', cwd: paths[0], options: {}, text: 'hello' },
        m => m._tag === 'selected' && m.selectionId === 'bench');
      const registry = await writer.request({ _tag: 'registry' }, m => m._tag === 'registry');
      const workspace = registry.workspaces.find(w => w.path === paths[0]);
      const commandPath = `/api/session/commands?workspaceId=${workspace.id}&sessionId=${selected.sessionId}`;
      await request(commandPath);
      await request('/api/ls', { path: listing });
      let nonce = 0;
      // Let startup/session-settlement discovery finish before the idle window.
      await request('/api/folders'); await delay(500);
      const scenario = { folders, sessions, archivedFraction: 0.9, entries, slowMetadataMs: slow ? 1 : 0, phases: [] };
      for (const phase of ['idle', 'listing', 'registry-write']) {
        const ipc = async message => { const reply = once(backend, 'message'); backend.send(message); return (await reply)[0]; };
        await delay(50); await ipc('reset');
        const ping = [], commands = [], operations = [];
        let active = true;
        const probe = async (values, action) => {
          while (active) { const start = performance.now(); await action(); values.push(performance.now() - start); await delay(5); }
        };
        const probes = Promise.all([
          probe(ping, () => { const id = String(++nonce); return observer.request({ _tag: 'ping', nonce: id }, m => m._tag === 'pong' && m.nonce === id); }),
          probe(commands, () => request(commandPath)),
        ]);
        try {
          for (let i = 0; i < 40; i++) {
            const start = performance.now();
            if (phase === 'listing') assert.equal((await request('/api/ls', { path: listing })).entries.length, entries);
            if (phase === 'registry-write') {
              const name = `Rename ${i}`;
              await writer.request({ _tag: 'save_project', project: { id: 'bench', name } },
                m => m._tag === 'registry' && m.projects?.some(p => p.id === 'bench' && p.name === name));
            }
            operations.push(performance.now() - start); await delay(20);
          }
        } finally { active = false; await probes; }
        const measured = { phase, operationMs: summary(operations), pingMs: summary(ping), sessionCommandsMs: summary(commands), ...(await ipc('measure')) };
        scenario.phases.push(measured); console.log(JSON.stringify({ folders, sessions, entries, ...measured }));
      }
      report.scenarios.push(scenario);
    } finally {
      writer?.ws.terminate(); observer?.ws.terminate();
      if (backend.exitCode === null && backend.signalCode === null) {
        const exited = once(backend, 'exit'); backend.kill('SIGTERM');
        const timer = setTimeout(() => backend.kill('SIGKILL'), 5000);
        await exited; clearTimeout(timer);
      }
      writeFileSync(`${output}.${sessions}-${slow}.log`, logs);
    }
    const saved = openRegistryDatabase(dbPath);
    try {
      assert.equal(saved.data.projects[0].name, 'Rename 39');
      assert.equal(saved.data.sessions.length, sessions + 1);
    } finally { saved.close(); }
    // Separate persistence/update work from SidebarView listeners and browser delivery.
    // Backend is stopped: never open a competing live writer.
    const runtime = ManagedRuntime.make(RegistryLive.pipe(Layer.provide(Layer.succeed(RegistryDatabasePath, dbPath))));
    const eventLoop = monitorEventLoopDelay({ resolution: 1 });
    try {
      const registry = await runtime.runPromise(Registry);
      const operations = [];
      eventLoop.enable(); await delay(20); eventLoop.reset();
      for (let i = 0; i < 40; i++) {
        const start = performance.now();
        await runtime.runPromise(registry.saveProject({ id: 'bench', name: `Direct ${i}` }));
        operations.push(performance.now() - start); await delay(20);
      }
      const directRegistry = { operationMs: summary(operations), eventLoopMs: {
        p95: eventLoop.percentile(95) / 1e6, max: eventLoop.max / 1e6,
      } };
      report.scenarios.at(-1).directRegistry = directRegistry;
      console.log(JSON.stringify({ folders, sessions, directRegistry }));
    } finally { eventLoop.disable(); await runtime.dispose(); }
    const reopened = openRegistryDatabase(dbPath);
    try {
      assert.equal(reopened.data.projects[0].name, 'Direct 39');
      assert.equal(reopened.data.sessions.length, sessions + 1);
    } finally { reopened.close(); }
  }
} finally {
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  rmSync(root, { recursive: true, force: true });
}
