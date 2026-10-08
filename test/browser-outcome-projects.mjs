// Step 1 outcome-project gate: scratch-only registry, Git and fake Pi; no model calls.
// node test/browser-outcome-projects.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-outcome-evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-outcome-browser-'));
const api = join(root, 'api'), web = join(root, 'web'), sessions = join(root, 'sessions'), config = join(root, 'registry.json'), audit = join(root, 'audit.jsonl');
for (const dir of [api, web, sessions, join(root, 'agent')]) mkdirSync(dir);
for (const dir of [api, web]) {
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  writeFileSync(join(dir, 'source.txt'), 'base\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base']);
  writeFileSync(join(dir, 'source.txt'), dir === api ? 'API CHANGE\n' : 'WEB CHANGE\n');
}
const timestamp = new Date().toISOString();
const references = [['one', api, 'API session'], ['two', web, 'Web session'], ['three', api, 'Accessibility session']].map(([sessionId, cwd, title]) => {
  writeFileSync(join(sessions, `${sessionId}.jsonl`), [
    { type: 'session', version: 3, id: sessionId, cwd, timestamp },
    { type: 'message', id: 'initial', parentId: null, timestamp, message: { role: 'user', content: `History ${sessionId}`, timestamp: Date.now() } },
  ].map(JSON.stringify).join('\n') + '\n');
  return { sessionId, cwd, title, createdAt: timestamp, updatedAt: timestamp, archived: false };
});
const original = JSON.stringify({ version: 1, projects: [api, web], worktrees: [], sessions: references, workspaces: [{ id: 'api-id', path: api, project: api }, { id: 'web-id', path: web, project: web }] });
writeFileSync(config, original);
const env = { ...process.env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: config, PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: `--audit ${audit}`, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions };
let processLog = '';
const capture = p => { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); return p; };
const startBackend = () => capture(spawn(process.execPath, ['server/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
let backend = startBackend();
const frontend = capture(spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] }));
const browser = `outcome-${process.pid}`, commands = [];
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
const registry = () => JSON.parse(readFileSync(config, 'utf8'));
const project = name => registry().outcomeProjects.find(p => p.name === name);
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Scratch startup deadline');
}
async function create(name) {
  await button('New project'); await ab('fill', '#project-name', name); await ab('fill', '#project-goal', `Goal for ${name}`); await button('Save project');
  await wait(`document.querySelector('main h1')?.textContent === ${JSON.stringify(name)}`);
}
async function open(name) { await button(name); await wait(`document.querySelector('main h1')?.textContent === ${JSON.stringify(name)}`); }
async function add(title, cwd) {
  await button('Add sessions'); await ab('fill', '#session-search', title);
  await button(`${title} · ${cwd}`); await button('Add session');
  await wait(`!document.querySelector('[role="dialog"]')`);
}
async function palette(command) {
  await ab('press', 'Control+k'); await ab('fill', '[aria-label="Search sessions and commands"]', command);
  await ab('click', `[cmdk-item][data-value="${command}"]`);
}
async function stop(p) { if (p.exitCode === null) { p.kill('SIGTERM'); await new Promise(resolveExit => p.once('exit', resolveExit)); } }
try {
  await ready(); await ab('open', 'http://127.0.0.1:7172/new'); await ab('set', 'viewport', '1440', '1000');
  await ab('wait', '--text', 'Directories');
  assert.deepEqual(registry().sessions, references);
  assert.equal(readFileSync(join(root, readdirSync(root).find(f => f.endsWith('.bak'))), 'utf8'), original);
  await create('Launch subscriptions'); await add('API session', api); await add('Web session', web);
  await ab('screenshot', join(evidence, 'cross-repository.png'));
  await create('Improve accessibility'); await add('Accessibility session', api);
  await create('Empty project'); await ab('wait', '--text', 'No sessions yet.');
  await ab('reload'); await ab('wait', '--text', 'No sessions yet.');
  assert.equal(registry().outcomeProjects.length, 3);
  await open('Launch subscriptions');
  for (const [title, cwd, id, marker, other] of [['API session', api, 'one', 'API CHANGE', 'WEB CHANGE'], ['Web session', web, 'two', 'WEB CHANGE', 'API CHANGE']]) {
    await ab('find', 'role', 'button', 'click', '--name', `${title} ${cwd}`, '--exact');
    await ab('wait', '--text', `History ${id}`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Working directory"]').title`), cwd);
    await palette('Changes'); await ab('wait', '--text', marker);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(other)})`), false);
    await ab('press', 'Escape'); await open('Launch subscriptions');
  }
  await button('Edit project'); await ab('fill', '#project-name', 'Subscriptions'); await button('Save project');
  await wait(`document.querySelector('main h1')?.textContent === 'Subscriptions'`);
  // New grouped sessions require an explicit directory, not the remembered last one.
  await button('New session in project');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Directory"]').title`), '');
  await ab('click', '[aria-label="Directory"]'); await ab('click', `[cmdk-item][data-value="${web}"]`);
  await ab('fill', '[aria-label="First message"]', '/hold');
  await wait(`!document.querySelector('[aria-label="Send"]').disabled`); await ab('click', '[aria-label="Send"]');
  await wait(`!!document.querySelector('[aria-label="Stop"]')`);
  const running = registry().sessions.find(s => !references.some(r => r.sessionId === s.sessionId));
  assert.equal(running.cwd, web); assert.equal(running.outcomeProjectId, project('Subscriptions').id);
  const runningUrl = await evaluate('location.href');
  const auditRecords = () => readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.sessionId === running.sessionId);
  assert.equal(auditRecords().filter(e => e.event === 'spawn').length, 1);
  await open('Subscriptions'); await button('Archive project');
  assert.equal(project('Subscriptions').archived, true);
  assert.equal(auditRecords().filter(e => e.event === 'exit').length, 0);
  await ab('open', runningUrl); await wait(`!!document.querySelector('[aria-label="Stop"]')`);
  await button('Archived projects'); await button('Subscriptions'); await button('Reopen project');
  assert.equal(project('Subscriptions').archived, false);
  // Move and unlink the running member without restarting or aborting it.
  await ab('click', '[aria-label="Project actions for /hold"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Move to project', '--exact');
  await button('Move to Improve accessibility');
  await open('Improve accessibility');
  await ab('click', '[aria-label="Project actions for /hold"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Remove from project', '--exact');
  assert.equal(registry().sessions.find(s => s.sessionId === running.sessionId).outcomeProjectId, undefined);
  assert.equal(auditRecords().filter(e => e.event === 'spawn').length, 1);
  assert.equal(auditRecords().filter(e => e.event === 'exit' || e.command === 'abort').length, 0);
  await ab('open', runningUrl); await wait(`!!document.querySelector('[aria-label="Stop"]')`);
  // Project commands mirror controls, without introducing global shortcuts.
  await palette('Move to project'); await button('Add to Subscriptions');
  await open('Subscriptions');
  await ab('press', 'Control+k'); await ab('fill', '[aria-label="Search sessions and commands"]', 'Edit project');
  assert.equal(await evaluate(`!!document.querySelector('[cmdk-item][data-value="Edit project"]')`), true);
  await ab('press', 'Escape');
  // Closing a directory leaves project references, histories and workspace identity intact.
  await ab('click', '[aria-label="Directory menu for api"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Close', '--exact'); await button('Close');
  assert.equal(registry().projects.includes(api), false);
  assert.equal(registry().sessions.find(s => s.sessionId === 'one').outcomeProjectId, project('Subscriptions').id);
  await button(`API session ${api}`); await ab('wait', '--text', 'History one');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Working directory"]').title`), api);
  await ab('reload'); await ab('wait', '--text', 'History one');
  // Explicit unavailable members, never silently removed or recreated.
  rmSync(join(sessions, 'two.jsonl'));
  rmSync(api, { recursive: true });
  await open('Subscriptions'); await ab('reload');
  await ab('wait', '--text', 'History unavailable.'); await ab('wait', '--text', 'Checkout unavailable.');
  await ab('snapshot'); await ab('screenshot', join(evidence, 'unavailable-members.png'));
  assert.equal(registry().sessions.some(s => s.sessionId === 'two'), true);
  await ab('find', 'role', 'button', 'click', '--name', `API session ${api} Checkout unavailable. History can be read; restore the directory to continue.`, '--exact');
  await ab('wait', '--text', 'History one');
  await open('Subscriptions');
  const saved = registry();
  await stop(backend); backend = startBackend(); await ready(); await ab('reload');
  await ab('wait', '--text', 'Subscriptions'); await ab('wait', '--text', 'History unavailable.');
  assert.deepEqual(registry(), saved);
  await ab('set', 'viewport', '390', '844'); await ab('screenshot', join(evidence, 'mobile-project.png'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.ok(await evaluate(`document.querySelector('main h1').getBoundingClientRect().height < 60`), 'mobile title is not crushed by actions');
  assert.ok(await evaluate(`[...document.querySelectorAll('main li')].every(row => { const [session, menu] = row.querySelectorAll('button'); return session.getBoundingClientRect().right <= menu.getBoundingClientRect().left; })`), 'session content and actions do not overlap');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'passed', registry: saved, original, node: process.version, audit: readFileSync(audit, 'utf8') }, null, 2));
  console.log('PASS: grouping, empty/ungrouped, workspace diffs, rename/move/unlink, running archive/reopen, closed directory, unavailable members, migration backup and restart');
} finally {
  try { await ab('snapshot'); await ab('screenshot', join(evidence, 'last-view.png')); } catch {}
  try { await ab('close'); } catch {}
  await stop(frontend); await stop(backend);
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
