// Session identity/actions (INV-01, INV-07): scratch Git + Pi history, no paid calls.
// node test/browser-session-header.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-header-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-header-'));
const repo = join(root, 'long-working-directory-for-session-header-verification');
const sessions = join(root, 'sessions');
for (const path of [repo, sessions, join(root, 'agent')]) mkdirSync(path);
execFileSync('git', ['init', '-q', '-b', 'header-test', repo]);
writeFileSync(join(repo, 'README.md'), 'Scratch\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Initial']);
const timestamp = new Date().toISOString();
const sessionFile = join(sessions, 'header.jsonl');
const entries = [{ type: 'session', version: 3, id: 'header', cwd: repo, timestamp }];
for (let n = 0; n < 40; n++) entries.push({ type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null, timestamp, message: { role: 'user', content: `Message ${n}\n\nTranscript scrolling check.`, timestamp: n } });
writeFileSync(sessionFile, entries.map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [{ cwd: repo, sessionId: 'header', title: 'Header verification with a long session title to truncate on mobile', createdAt: timestamp, updatedAt: timestamp, archived: false }] }));
// The generic fake only understands --session-id; this fixture also resumes this saved file.
const fake = join(root, 'fake.mjs');
writeFileSync(fake, readFileSync('test/fake-pi.mjs', 'utf8').replace('const sessionId = args[args.indexOf("--session-id") + 1] || "nosession";', 'const sessionId = args.includes("--session") ? "header" : args[args.indexOf("--session-id") + 1] || "nosession";'));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: join(root, 'registry.json'), PIANO_PI_CLI: fake, PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const browser = `header-${process.pid}`, commands = [];
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
const menu = async () => {
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast]')`);
  await ab('click', '[aria-label="Session information and actions"]');
};
const item = name => ab('find', 'role', 'menuitem', 'click', '--name', name, '--exact');
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (n === 100) throw new Error('Startup deadline');
    await delay(100);
  }
  await ab('open', 'http://127.0.0.1:7172/s/header');
  await ab('wait', '--text', 'Message 39');
  // Observe clipboard arguments while allowing the actual browser write to run.
  await evaluate(`window.copies = []; window.nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async value => { window.copies.push(value); await window.nativeWrite(value); }; true`);
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await ab('set', 'viewport', String(width), String(height));
    assert.equal(await evaluate(`document.querySelector('[aria-label="Working directory"]').tagName`), 'P');
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Working directory"]').length`), 1);
    const top = await evaluate(`document.querySelector('main header').getBoundingClientRect().top`);
    await ab('scroll', 'up', '2000', '--selector', '[data-slot="transcript"]');
    assert.equal(await evaluate(`document.querySelector('main header').getBoundingClientRect().top`), top);
    await menu();
    await ab('snapshot');
    assert.equal(await evaluate(`document.querySelector('[role="menu"]').textContent.includes(${JSON.stringify(sessionFile)})`), false);
    assert.equal(await evaluate(`document.querySelector('[role="menu"]').textContent.includes('Session ID')`), false);
    const bounds = await evaluate(`(() => { const r = document.querySelector('[role="menu"]').getBoundingClientRect(); return {left:r.left,right:r.right,width:innerWidth}; })()`);
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width);
    await ab('screenshot', join(evidence, `menu-${width}.png`));
    await item('Copy working directory');
    await ab('wait', '--text', 'Working directory copied');
    await menu(); await item('Copy git branch');
    await menu(); await item('Copy session file path');
    assert.deepEqual(await evaluate('window.copies.slice(-3)'), [repo, 'header-test', sessionFile]);
    await menu(); await item('Rename');
    await ab('wait', '--text', 'Rename session');
    await ab('fill', '[aria-label="Session name"]', 'Do not save');
    await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
    await menu(); await item('Delete');
    await ab('wait', '--text', 'Delete this session?');
    await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
    await ab('focus', '[aria-label="Session information and actions"]');
    await ab('press', 'Enter');
    await ab('wait', '--fn', `document.activeElement?.getAttribute('role') === 'menuitem'`);
    await ab('press', 'Escape');
    assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Session information and actions');
  }
  await evaluate(`navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; true`);
  await menu(); await item('Copy working directory');
  await ab('wait', '--text', 'Couldn’t copy working directory.');
  await evaluate(`navigator.clipboard.writeText = window.nativeWrite; true`);
  await ab('press', 'Control+k');
  await ab('fill', '[placeholder="Search sessions, projects, branches…"]', 'Rename');
  await ab('find', 'role', 'option', 'click', '--name', 'Rename', '--exact');
  await ab('wait', '--text', 'Rename session');
  await ab('fill', '[aria-label="Session name"]', 'Renamed from palette');
  await ab('find', 'role', 'button', 'click', '--name', 'Rename', '--exact');
  await ab('wait', '--fn', `document.querySelector('main h1')?.textContent === 'Renamed from palette'`);
  await ab('set', 'viewport', '1280', '900');
  await ab('click', '[aria-label="Session menu for Renamed from palette"]');
  await item('Rename');
  await ab('wait', '--text', 'Rename session');
  await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
  await menu(); await item('Archive');
  await ab('wait', '--fn', `!document.querySelector('[aria-label="Session menu for Renamed from palette"]')`);
  console.log('PASS: desktop/mobile sticky identity, copy values/failure, shared confirmations, keyboard/palette rename, sidebar actions and archive');
} catch (error) {
  await ab('snapshot').catch(() => {});
  await ab('screenshot', join(evidence, 'failure.png')).catch(() => {});
  throw error;
} finally {
  await ab('close').catch(() => {});
  backend.kill('SIGTERM'); frontend.kill('SIGTERM');
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  writeFileSync(join(evidence, 'revision.txt'), execFileSync('git', ['rev-parse', 'HEAD']).toString().trim() + ' + working tree\n');
  rmSync(root, { recursive: true, force: true });
}
