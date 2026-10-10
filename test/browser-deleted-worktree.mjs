// INV-01/02/06: removed worktree history, read-only UI, retention and restoration.
// node test/browser-deleted-worktree.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readRegistry, registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-missing-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-deleted-'));
const repo = join(root, 'repo'), worktree = join(root, 'feature'), sessions = join(root, 'sessions');
for (const path of [repo, sessions, join(root, 'agent')]) mkdirSync(path);
const git = (...args) => execFileSync('git', ['-C', repo, ...args]);
git('init', '-q', '-b', 'main');
writeFileSync(join(repo, 'README.md'), 'Scratch\n');
git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Initial');
git('worktree', 'add', '-qb', 'feature', worktree);
const timestamp = new Date().toISOString();
const ids = ['kept', 'archived', 'deleted'];
for (const id of ids) writeFileSync(join(sessions, `${id}.jsonl`), [
  { type: 'session', version: 3, id, cwd: worktree, timestamp },
  { type: 'message', id: 'm1', parentId: null, timestamp, message: { role: 'user', content: `Saved conversation ${id}`, timestamp: 1 } },
].map(JSON.stringify).join('\n') + '\n');
const original = readFileSync(join(sessions, 'kept.jsonl'), 'utf8');
const registry = join(root, 'registry.json');
writeFileSync(registry, JSON.stringify({ folders: [repo], worktrees: [{ folder: repo, path: worktree, branch: 'feature' }], sessions: ids.map(sessionId => ({ cwd: worktree, sessionId, title: sessionId, createdAt: timestamp, updatedAt: timestamp, archived: false })) }));
execFileSync('wt', ['-C', repo, 'remove', '--foreground', '--no-hooks', '--no-delete-branch', worktree]);
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '7171', ...registryEnv(registry), PIANO_PI_CLI: resolve('test/fake-pi.mjs'), PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const browser = `deleted-${process.pid}`, commands = [];
async function ab(...args) {
  const result = await new Promise((res, rej) => {
    const p = spawn('npx', ['agent-browser', '--session', browser, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => p.kill('SIGTERM'), 45000);
    p.on('error', rej); p.on('exit', status => { clearTimeout(timer); res({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async code => JSON.parse(await ab('eval', code));
// Rename, Archive and Delete live in the sidebar row's session menu.
const menu = id => ab('click', `[aria-label="Session menu for ${id}"]`);
const item = name => ab('find', 'role', 'menuitem', 'click', '--name', name, '--exact');
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/folders')).ok && (await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (n === 100) throw new Error('Startup deadline');
    await delay(100);
  }
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await ab('set', 'viewport', String(width), String(height));
    await ab('open', 'http://127.0.0.1:7172/s/kept');
    await ab('wait', '--text', 'Saved conversation kept');
    await ab('wait', '--text', 'Checkout removed · Read-only session');
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="Message"]')`), false);
    assert.equal(await evaluate(`document.querySelector('main [aria-label="New session here"]').disabled`), true);
    assert.equal(await evaluate(`document.querySelectorAll('[data-sonner-toast]').length`), 0);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    // The sidebar, and with it the session menu, is off-canvas on mobile.
    if (width > 768) {
      await menu('kept');
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(e => e.textContent.trim() === 'Rename').getAttribute('aria-disabled')`), 'true');
      for (const name of ['Archive', 'Delete']) assert.notEqual(await evaluate(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(e => e.textContent.trim() === '${name}').getAttribute('aria-disabled')`), 'true');
      await ab('press', 'Escape');
    }
    await ab('snapshot');
    await ab('screenshot', join(evidence, `readonly-${width}.png`));
    await ab('reload');
    await ab('wait', '--text', 'Saved conversation kept');
  }
  await ab('set', 'viewport', '1280', '900');
  await ab('press', process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await ab('fill', '[aria-label="Search sessions and commands"]', 'Rename');
  assert.equal(await evaluate(`document.querySelector('[role="option"][data-value="Rename"]').getAttribute('aria-disabled')`), 'true');
  await ab('press', 'Escape');
  await ab('open', 'http://127.0.0.1:7172/s/archived');
  await ab('wait', '--text', 'Saved conversation archived');
  await menu('archived'); await item('Archive');
  await ab('wait', '--fn', `!location.pathname.endsWith('/archived')`);
  assert.equal(readRegistry(registry).sessions.find(s => s.sessionId === 'archived').archived, true);
  assert.ok(existsSync(join(sessions, 'archived.jsonl')));
  await ab('open', 'http://127.0.0.1:7172/s/deleted');
  await ab('wait', '--text', 'Saved conversation deleted');
  await menu('deleted'); await item('Delete');
  await ab('wait', '--text', 'Delete this session?');
  await ab('find', 'role', 'button', 'click', '--name', 'Delete', '--exact');
  await ab('wait', '--text', 'Session deleted');
  assert.equal(existsSync(join(sessions, 'deleted.jsonl')), false);
  assert.equal(readRegistry(registry).sessions.some(s => s.sessionId === 'deleted'), false);
  assert.equal(readFileSync(join(sessions, 'kept.jsonl'), 'utf8'), original);
  git('worktree', 'add', '-q', worktree, 'feature');
  await ab('open', 'http://127.0.0.1:7172/s/kept');
  await ab('wait', '--text', 'Saved conversation kept');
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Message"]') && !document.querySelector('[aria-label="Message"]').disabled`);
  assert.equal(await evaluate(`document.body.textContent.includes('Checkout removed · Read-only session')`), false);
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'passed', revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: true, node: process.version, worktrunk: execFileSync('wt', ['--version'], { encoding: 'utf8' }).trim(), cli: 'test/fake-pi.mjs', modelCalls: 0, checks: ['desktop/mobile history and reload', 'no ENOENT toast or stuck composer', 'read-only controls and palette', 'archive preserves history', 'delete removes history', 'restore enables composer without modifying history'] }, null, 2));
  console.log('PASS: removed worktree history, read-only controls, archive/delete, restore');
} finally {
  await ab('close').catch(() => {});
  backend.kill('SIGTERM'); frontend.kill('SIGTERM');
  await Promise.all([backend, frontend].map(p => p.exitCode !== null ? Promise.resolve() : new Promise(r => p.once('exit', r))));
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  if (existsSync(worktree)) git('worktree', 'remove', '--force', worktree);
  git('branch', '-D', 'feature');
  rmSync(root, { recursive: true, force: true });
}
