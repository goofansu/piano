// Scratch-only pinned ownership journey; no model calls.
// node test/browser-pinned-selection.mjs .scratch/pinned-selection
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { seedRegistry } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '.scratch/pinned-selection');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-pinned-browser-'));
const repo = join(root, 'repo'), sessions = join(root, 'sessions'), agent = join(root, 'agent');
for (const dir of [repo, sessions, agent]) mkdirSync(dir);
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
writeFileSync(join(repo, 'source.txt'), 'base\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base']);
const timestamp = new Date().toISOString();
const references = [['one', 'Pinned one', true], ['two', 'Pinned two', true], ['three', 'Unpinned', false]].map(([sessionId, title, pinned]) => {
  writeFileSync(join(sessions, `${sessionId}.jsonl`), [
    { type: 'session', version: 3, id: sessionId, cwd: repo, timestamp },
    { type: 'message', id: 'initial', parentId: null, timestamp, message: { role: 'user', content: `History ${sessionId}`, timestamp: Date.now() } },
  ].map(JSON.stringify).join('\n') + '\n');
  return { sessionId, title, pinned, cwd: repo, projectId: 'launch', createdAt: timestamp, updatedAt: timestamp, archived: false };
});
const database = join(root, 'piano.db');
seedRegistry(database, { folders: [repo], sessions: references, projects: [{ id: 'launch', name: 'Launch', archived: false }], workspaces: [{ id: 'repo-id', path: repo, folder: repo }] });
const env = { ...process.env, HOME: join(root, 'home'), HOST: '127.0.0.1', PORT: '7171', PIANO_DB_PATH: database,
  PIANO_ALLOWED_ORIGINS: 'http://127.0.0.1:7172,http://localhost:7172', PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'),
  PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: sessions };
let processLog = '';
const capture = p => { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); return p; };
const backend = capture(spawn(process.execPath, ['server/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
const frontend = capture(spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] }));
const browser = `pinned-selection-${process.pid}`, commands = [], observations = [];
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
const button = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
const wait = code => ab('wait', '--fn', code);
const expanded = name => `[...document.querySelectorAll('nav button[aria-expanded]')].find(b => b.textContent.trim() === ${JSON.stringify(name)})?.getAttribute('aria-expanded')`;
async function groupBy(name) {
  await button('View options');
  await ab('find', 'role', 'menuitem', 'hover', '--name', 'Group by');
  await ab('find', 'role', 'menuitemradio', 'click', '--name', name, '--exact');
  await wait(`!document.querySelector('[role="menu"]')`);
}
async function collapse(name) {
  if (await evaluate(expanded(name)) === 'true') {
    const index = await evaluate(`[...document.querySelectorAll('nav button[aria-expanded]:not([aria-haspopup])')].findIndex(b => b.textContent.trim() === ${JSON.stringify(name)})`);
    await ab('find', 'nth', String(index), 'nav button[aria-expanded]:not([aria-haspopup])', 'click');
  }
  await wait(`${expanded(name)} === 'false'`);
}
async function select(title, id) {
  await button(title);
  await ab('wait', '--text', `History ${id}`);
}
async function record(label, name, expected) {
  const actual = await evaluate(expanded(name));
  observations.push({ label, group: name, expanded: actual });
  assert.equal(actual, expected, label);
}
async function stop(p) { if (p.exitCode === null) { p.kill('SIGTERM'); await new Promise(r => p.once('exit', r)); } }
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/folders')).ok && (await fetch('http://127.0.0.1:7172')).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, 'scratch servers ready');
  await ab('open', 'http://127.0.0.1:7172/new');
  await ab('set', 'viewport', '1440', '1000');
  await ab('wait', '--text', 'Pinned one');
  for (const [grouping, name] of [['Folder', 'repo'], ['Project', 'Launch']]) {
    await groupBy(grouping); await collapse(name);
    for (const [title, id] of [['Pinned one', 'one'], ['Pinned two', 'two'], ['Pinned one', 'one']]) {
      await select(title, id); await record(`${grouping}: select ${title}`, name, 'false');
    }
    // Changing grouping with a pinned selection must not reopen the related group either.
    await groupBy('None'); await groupBy(grouping);
    await record(`${grouping}: switch grouping with pinned selection`, name, 'false');
    await ab('screenshot', join(evidence, `${grouping.toLowerCase()}-pinned.png`));
    // Select an unpinned session from an ungrouped view: reveal remains intact.
    await groupBy('None'); await select('Unpinned', 'three'); await groupBy(grouping);
    await record(`${grouping}: unpinned reveal`, name, 'true');
    await collapse(name);
    await select('Pinned two', 'two'); await record(`${grouping}: return to pinned`, name, 'false');
  }
  // Pinning the selected session takes it out of its related group's autoexpand ownership.
  await groupBy('None'); await select('Unpinned', 'three');
  await ab('click', '[aria-label="Session menu for Unpinned"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Pin', '--exact');
  await wait(`document.querySelector('[aria-label="Pinned"]')?.textContent.includes('Unpinned')`);
  await groupBy('Project'); await record('pin selected: project stays closed', 'Launch', 'false');
  await groupBy('Folder'); await record('pin selected: folder stays closed', 'repo', 'false');
  await button('Pinned'); await wait(`${expanded('Pinned')} === 'false'`);
  await ab('reload'); await wait(`${expanded('Pinned')} === 'false'`);
  await record('reload pinned selection: folder stays closed', 'repo', 'false');
  await ab('screenshot', join(evidence, 'collapsed-pinned-reload.png'));
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'passed', node: process.version, origins: env.PIANO_ALLOWED_ORIGINS, observations }, null, 2));
  console.log('PASS: pinned selections/grouping changes/pinning do not open related groups; unpinned reveal and collapsed Pinned reload preserved');
} finally {
  try { await ab('snapshot'); await ab('screenshot', join(evidence, 'last-view.png')); } catch {}
  try { await ab('close'); } catch {}
  await stop(frontend); await stop(backend);
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
