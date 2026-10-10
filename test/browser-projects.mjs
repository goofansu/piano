// Project grouping gate: scratch-only registry, Git and fake Pi; no model calls.
// node test/browser-projects.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readRegistry, seedRegistry } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-projects-evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-projects-browser-'));
const api = join(root, 'api'), web = join(root, 'web'), sessions = join(root, 'sessions'), audit = join(root, 'audit.jsonl');
const database = join(root, 'data', 'piano', 'piano.db');
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
seedRegistry(database, { folders: [api, web], sessions: references, workspaces: [{ id: 'api-id', path: api, folder: api }, { id: 'web-id', path: web, folder: web }] });
// The backend finds the seeded default database with no DB override.
const env = { ...process.env, HOME: join(root, 'home'), XDG_DATA_HOME: join(root, 'data'), PIANO_DB_PATH: undefined, HOST: '127.0.0.1', PORT: '7171', PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: `--audit ${audit}`, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions };
let processLog = '';
const capture = p => { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); return p; };
const startBackend = () => capture(spawn(process.execPath, ['server/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
let backend = startBackend();
const frontend = capture(spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] }));
const browser = `projects-${process.pid}`, commands = [];
async function ab(...args) {
  const started = Date.now();
  const result = await new Promise((res, rej) => {
    const p = spawn('npx', ['agent-browser', '--session', browser, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => p.kill('SIGTERM'), 45000);
    p.on('error', rej); p.on('exit', status => { clearTimeout(timer); res({ status, stdout, stderr }); });
  });
  commands.push({ args, ms: Date.now() - started, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async code => JSON.parse(await ab('eval', code));
const button = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
const menuitem = name => ab('find', 'role', 'menuitem', 'click', '--name', name, '--exact');
const wait = code => ab('wait', '--fn', code);
const settle = () => ab('wait', '300');
const registry = () => readRegistry(join(root, 'registry.json'), database);
const project = name => registry().projects.find(p => p.name === name);
const member = sessionId => registry().sessions.find(s => s.sessionId === sessionId);
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/folders')).ok && (await fetch('http://127.0.0.1:7172')).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Scratch startup deadline');
}
async function palette(text) {
  await button('Search sessions'); await wait(`!!document.querySelector('[cmdk-list]')`);
  await ab('fill', '[aria-label="Search sessions and commands"]', text); await settle();
}
/** A project is created from the New page's project chip, or from a session's menu, which also files that session in it. */
async function create(name) {
  await ab('click', '[aria-label="Project"]'); await wait(`!!document.querySelector('[role="dialog"][aria-label="Choose a project"]')`);
  // The first project is offered by the picker's empty state; later ones by the button beside its search.
  await button('New project');
  await ab('fill', '#project-name', name); await ab('fill', '#project-goal', `Goal for ${name}`); await button('Create project');
  await wait(`document.querySelector('main h1')?.textContent === ${JSON.stringify(name)}`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Project"]').textContent.trim()`), name);
}
async function createWithSession(name, sessionMenu) {
  await ab('find', 'first', `[aria-label=${JSON.stringify(`Session menu for ${sessionMenu}`)}]`, 'click');
  await wait(`!!document.querySelector('[role="menuitem"][aria-haspopup="menu"]')`);
  await ab('hover', '[role="menuitem"][aria-haspopup="menu"]');
  await wait(`[...document.querySelectorAll('[role="menuitem"]')].some(i => i.textContent.trim() === 'New project…')`); await settle();
  await menuitem('New project…');
  await ab('fill', '#project-name', name); await ab('fill', '#project-goal', `Goal for ${name}`); await button('Create and add session');
  await wait(`!document.querySelector('[role="dialog"]')`); await settle();
}
/** Membership is the Project submenu of a session's own menu. `None` leaves the project. */
async function file(sessionMenu, projectName) {
  await ab('find', 'first', `[aria-label=${JSON.stringify(`Session menu for ${sessionMenu}`)}]`, 'click');
  await wait(`!!document.querySelector('[role="menuitem"][aria-haspopup="menu"]')`);
  await ab('hover', '[role="menuitem"][aria-haspopup="menu"]');
  await wait(`[...document.querySelectorAll('[role="menuitemradio"]')].some(i => i.textContent === ${JSON.stringify(projectName)})`); await settle();
  await ab('find', 'role', 'menuitemradio', 'click', '--name', projectName, '--exact');
  await wait(`!document.querySelector('[role="menu"]')`); await settle();
}
/** The sidebar's view menu: Group by Folder, Project or None. */
async function groupBy(option) {
  await ab('find', 'role', 'button', 'click', '--name', 'View options', '--exact'); await wait(`!!document.querySelector('[role="menuitem"][aria-haspopup="menu"]')`);
  await ab('find', 'role', 'menuitem', 'hover', '--name', 'Group by');
  await wait(`[...document.querySelectorAll('[role="menuitemradio"]')].some(i => i.textContent.trim() === ${JSON.stringify(option)})`); await settle();
  await ab('find', 'role', 'menuitemradio', 'click', '--name', option, '--exact');
  await wait(`!document.querySelector('[role="menu"]')`); await settle();
}
async function openGroup(name) {
  const expanded = await evaluate(`[...document.querySelectorAll('nav button[aria-expanded]')].some(b => b.textContent === ${JSON.stringify(name)} && b.getAttribute('aria-expanded') === 'true')`);
  if (!expanded) await button(name);
  await settle();
}
/** Escape closes the top dialog; a sheet that is still animating in may need a second one. */
async function closeDialogs() {
  for (let i = 0; i < 3 && await evaluate(`!!document.querySelector('[role="dialog"]')`); i++) { await ab('press', 'Escape'); await ab('wait', '400'); }
  await wait(`!document.querySelector('[role="dialog"]')`);
}
async function stop(p) { if (p.exitCode === null) { p.kill('SIGTERM'); await new Promise(resolveExit => p.once('exit', resolveExit)); } }
try {
  await ready(); await ab('open', 'http://127.0.0.1:7172/new'); await ab('set', 'viewport', '1440', '1000');
  await ab('wait', '--text', 'api');
  assert.deepEqual(registry().sessions, references);
  // Grouped by folder, the sidebar shows no project rows; the chip on the New page creates the first project.
  await create('Launch subscriptions');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Project menu for Launch subscriptions"]')`), false);
  await groupBy('Folder');
  await openGroup('api'); await openGroup('web');
  await file('API session', 'Launch subscriptions'); await file('Web session', 'Launch subscriptions');
  assert.equal(member('one').projectId, project('Launch subscriptions').id);
  assert.equal(member('two').projectId, project('Launch subscriptions').id);
  // A session row is its title alone in every grouping; project and location live in the header and the groups.
  for (const grouping of ['Date', 'None', 'Folder']) {
    await groupBy(grouping);
    if (grouping === 'Folder') { await openGroup('api'); await openGroup('web'); }
    await wait(`!!document.querySelector('nav li:has([aria-label="Session menu for API session"])')`);
    const row = await evaluate(`(() => { const row = document.querySelector('nav li:has([aria-label="Session menu for API session"])'); return { text: row.querySelector('button').innerText.trim(), height: row.getBoundingClientRect().height }; })()`);
    assert.deepEqual(row, { text: 'API session', height: 36 });
    await ab('screenshot', join(evidence, `session-project-${grouping.toLowerCase()}.png`));
  }
  await ab('screenshot', join(evidence, 'cross-repository.png'));
  await createWithSession('Improve accessibility', 'Accessibility session');
  assert.equal(member('three').projectId, project('Improve accessibility').id);
  // An empty project is usable; its route survives reload.
  await create('Empty project'); await ab('reload');
  await wait(`document.querySelector('main h1')?.textContent === 'Empty project'`);
  assert.equal(registry().projects.length, 3);
  // Group by project lists every project plus a No project group; the grouping is remembered across reload.
  await groupBy('Project'); await ab('wait', '--text', 'No project');
  await openGroup('Empty project'); await ab('wait', '--text', 'No sessions yet');
  await openGroup('Launch subscriptions');
  assert.equal(await evaluate(`!!document.querySelector('nav li:has([aria-label="Session menu for API session"]) .text-brand')`), false, 'project grouping does not repeat the group name in each row');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('nav button[aria-expanded]:not([aria-haspopup])')].map(b => b.textContent)`), ['Improve accessibility', 'Launch subscriptions', 'Empty project', 'No project'], 'by last activity: equal timestamps fall back to name, an empty project last');
  await ab('reload'); await ab('wait', '--text', 'No project');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="New session in Empty project"]')`), true);
  // Opening a member from its project group shows that session's own directory and changes only.
  for (const [title, cwd, id, marker, other] of [['API session', api, 'one', 'API CHANGE', 'WEB CHANGE'], ['Web session', web, 'two', 'WEB CHANGE', 'API CHANGE']]) {
    await button(title);
    await ab('wait', '--text', `History ${id}`);
    assert.equal(await evaluate(`[...document.querySelectorAll('header p[title]')].find(p => p.textContent.startsWith('Working directory'))?.title`), cwd);
    assert.equal(await evaluate(`document.querySelector('header button.text-brand')?.textContent`), 'Launch subscriptions');
    await palette('Changes'); await ab('click', '[cmdk-item][data-value="Changes"]'); await ab('wait', '--text', marker);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(other)})`), false);
    await closeDialogs();
  }
  await ab('click', '[aria-label="Project menu for Launch subscriptions"]'); await menuitem('Edit project');
  await ab('fill', '#project-name', 'Subscriptions'); await button('Save');
  await wait(`[...document.querySelectorAll('nav button[aria-expanded]')].some(b => b.textContent === 'Subscriptions')`);
  // New grouped sessions require an explicit directory, not the remembered last one; the route survives reload.
  await ab('click', '[aria-label="New session in Subscriptions"]');
  await wait(`document.querySelector('main h1')?.textContent === 'Subscriptions'`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Directory"]').title`), '');
  assert.equal(await evaluate('location.pathname'), `/projects/${project('Subscriptions').id}`);
  await ab('reload'); await wait(`document.querySelector('main h1')?.textContent === 'Subscriptions'`);
  await ab('click', '[aria-label="Directory"]'); await ab('click', `[cmdk-item][data-value="${web}"]`);
  await ab('fill', '[aria-label="First message"]', '/hold');
  await wait(`!document.querySelector('[aria-label="Send"]').disabled`); await ab('click', '[aria-label="Send"]');
  await wait(`!!document.querySelector('[aria-label="Stop"]')`);
  const running = registry().sessions.find(s => !references.some(r => r.sessionId === s.sessionId));
  assert.equal(running.cwd, web); assert.equal(running.projectId, project('Subscriptions').id);
  const runningUrl = await evaluate('location.href');
  const auditRecords = () => readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.sessionId === running.sessionId);
  assert.equal(auditRecords().filter(e => e.event === 'spawn').length, 1);
  // Archive removes the group from the sidebar; running work continues and the session stays reachable,
  // and its header still leads to the project, whose page offers Unarchive.
  await ab('click', '[aria-label="Project menu for Subscriptions"]'); await menuitem('Archive project'); await settle();
  assert.equal(project('Subscriptions').archived, true);
  assert.equal(auditRecords().filter(e => e.event === 'exit').length, 0);
  assert.equal(await evaluate(`[...document.querySelectorAll('nav button[aria-expanded]')].some(b => b.textContent === 'Subscriptions')`), false);
  await ab('open', runningUrl); await wait(`!!document.querySelector('[aria-label="Stop"]')`);
  await ab('click', 'header button.text-brand'); await wait(`document.querySelector('main h1')?.textContent === 'Subscriptions'`);
  await ab('wait', '--text', 'This project is archived.'); await button('Unarchive project');
  await wait(`[...document.querySelectorAll('nav button[aria-expanded]')].some(b => b.textContent === 'Subscriptions')`);
  assert.equal(project('Subscriptions').archived, false);
  // Move and leave with the running member, without restarting or aborting it.
  await file('/hold', 'Improve accessibility');
  assert.equal(member(running.sessionId).projectId, project('Improve accessibility').id);
  await file('/hold', 'None');
  assert.equal(member(running.sessionId).projectId, undefined);
  assert.equal(auditRecords().filter(e => e.event === 'spawn').length, 1);
  assert.equal(auditRecords().filter(e => e.event === 'exit' || e.command === 'abort').length, 0);
  await ab('open', runningUrl); await wait(`!!document.querySelector('[aria-label="Stop"]')`);
  // Membership lives in the sidebar menu; the simplified header no longer duplicates that action.
  // The palette finds sessions by project name but offers no project commands.
  await file('/hold', 'Subscriptions');
  assert.equal(member(running.sessionId).projectId, project('Subscriptions').id);
  await palette('Subscriptions');
  const items = await evaluate(`[...document.querySelectorAll('[cmdk-item]')].filter(i => i.getBoundingClientRect().height > 0).map(i => i.textContent.trim())`);
  assert.ok(items.includes('/holdweb') && items.includes('API sessionapi'), `sessions found by project name: ${items}`);
  assert.ok(items.every(i => !/project/i.test(i)), `no project commands in the palette: ${items}`);
  await closeDialogs();
  // Closing a folder leaves project references, histories and workspace identity intact.
  await groupBy('Folder'); await wait(`!!document.querySelector('[aria-label="Folder menu for api"]')`);
  await ab('click', '[aria-label="Folder menu for api"]'); await menuitem('Close'); await button('Close'); await settle();
  assert.equal(registry().folders.includes(api), false);
  assert.equal(member('one').projectId, project('Subscriptions').id);
  await groupBy('Project'); await ab('wait', '--text', 'No project');
  await button('API session'); await ab('wait', '--text', 'History one');
  assert.equal(await evaluate(`[...document.querySelectorAll('header p[title]')].find(p => p.textContent.startsWith('Working directory'))?.title`), api);
  await ab('reload'); await ab('wait', '--text', 'History one');
  // Explicit unavailable members, never silently removed or recreated.
  rmSync(join(sessions, 'two.jsonl'));
  rmSync(api, { recursive: true });
  await ab('reload');
  await wait(`document.querySelector('nav [title^="History unavailable"]')?.disabled === true`);
  await wait(`!!document.querySelector('nav [title^="Folder missing"]')`);
  await ab('screenshot', join(evidence, 'unavailable-members.png'));
  assert.equal(registry().sessions.some(s => s.sessionId === 'two'), true);
  await ab('click', 'nav [title^="Folder missing"]'); await ab('wait', '--text', 'History one');
  const saved = registry();
  await stop(backend); backend = startBackend(); await ready(); await ab('reload');
  await wait(`document.querySelector('nav [title^="History unavailable"]')?.disabled === true`);
  assert.deepEqual(registry(), saved);
  await ab('open', `http://127.0.0.1:7172/projects/${project('Subscriptions').id}`);
  await wait(`document.querySelector('main h1')?.textContent === 'Subscriptions'`);
  await ab('set', 'viewport', '390', '844'); await ab('screenshot', join(evidence, 'mobile-project.png'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await button('Show sidebar'); await settle(); await ab('screenshot', join(evidence, 'mobile-sidebar.png'));
  assert.ok(await evaluate(`[...document.querySelectorAll('nav li')].every(row => { const [session, menu] = row.querySelectorAll('button'); return session.getBoundingClientRect().right <= menu.getBoundingClientRect().left; })`), 'session content and actions do not overlap');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'passed', registry: saved, node: process.version, audit: readFileSync(audit, 'utf8') }, null, 2));
  console.log('PASS: grouping, empty/ungrouped, workspace diffs, rename/move/leave, running archive/unarchive, closed directory, unavailable members and restart');
} finally {
  try { await ab('snapshot'); await ab('screenshot', join(evidence, 'last-view.png')); } catch {}
  try { await ab('close'); } catch {}
  await stop(frontend); await stop(backend);
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
