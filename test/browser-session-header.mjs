// Session identity/actions (INV-01, INV-07): scratch Git + Pi history, no paid calls.
// node test/browser-session-header.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { registryEnv } from './fixtures/registry.ts';

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

const evidence = resolve(process.argv[2] ?? '/tmp/piano-header-evidence/browser');
mkdirSync(evidence, { recursive: true });
// Keep registry and Pi cwd identity stable on macOS, where /var aliases /private/var.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'piano-header-')));
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
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [{ cwd: repo, sessionId: 'header', title: 'Header verification: copy all details with a long session title to truncate on mobile', createdAt: timestamp, updatedAt: timestamp, archived: false }] }));
// The generic fake only understands --session-id; this fixture also resumes this saved file.
const fake = join(root, 'fake.mjs');
writeFileSync(fake, readFileSync('test/fake-pi.mjs', 'utf8').replace('const sessionId = args[args.indexOf("--session-id") + 1] || "nosession";', 'const sessionId = args.includes("--session") ? "header" : args[args.indexOf("--session-id") + 1] || "nosession";'));
const backendPort = await freePort();
const frontendPort = await freePort();
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(backendPort), ...registryEnv(join(root, 'registry.json')), PIANO_PI_CLI: fake, PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await ab('wait', '--fn', `!document.querySelector('[data-slot="dialog-overlay"]')`);
  await ab('click', '[aria-label="Session information and actions"]');
  await ab('wait', '--fn', `!!document.querySelector('[role="menu"][data-state="open"]')`);
};
const item = name => ab('find', 'role', 'menuitem', 'click', '--name', name, '--exact');
const menuIsOpen = () => evaluate(`!!document.querySelector('[role="menu"][data-state="open"]')`);
const waitForCopies = count => ab('wait', '--fn', `window.copies.length === ${count}`);
async function assertToastCentered(text, label) {
  await ab('wait', '--text', text);
  const bounds = await evaluate(`(() => {
    const main = document.querySelector('main').getBoundingClientRect();
    const toast = [...document.querySelectorAll('[data-sonner-toast]')].filter(node => node.textContent.includes(${JSON.stringify(text)})).at(-1)?.getBoundingClientRect();
    return toast && { mainLeft: main.left, mainRight: main.right, mainCenter: main.left + main.width / 2, toastLeft: toast.left, toastRight: toast.right, toastCenter: toast.left + toast.width / 2 };
  })()`);
  assert.ok(bounds, `${label}: toast is visible`);
  assert.ok(Math.abs(bounds.toastCenter - bounds.mainCenter) <= 2, `${label}: toast center ${bounds.toastCenter} matches main center ${bounds.mainCenter}`);
  assert.ok(bounds.toastLeft >= bounds.mainLeft && bounds.toastRight <= bounds.mainRight, `${label}: toast stays within main`);
  await ab('screenshot', join(evidence, `toast-${label}.png`));
}
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/projects`)).ok && (await fetch(`http://127.0.0.1:${frontendPort}`)).ok) break; } catch {}
    if (n === 100) throw new Error('Startup deadline');
    await delay(100);
  }
  await ab('open', `http://127.0.0.1:${frontendPort}/s/header`);
  await ab('wait', '--text', 'Message 39');
  // Observe clipboard arguments while allowing the actual browser write to run.
  await evaluate(`window.copies = []; window.nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async value => { window.copies.push(value); await window.nativeWrite(value); }; true`);
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await ab('set', 'viewport', String(width), String(height));
    assert.equal(await evaluate(`document.querySelector('main header p[title]').textContent.startsWith('Working directory: ')`), true);
    assert.equal(await evaluate(`document.querySelectorAll('main header p[title]').length`), 1);
    assert.ok(await evaluate(`(() => {
      const create = document.querySelector('main header [aria-label="New session here"]').getBoundingClientRect();
      const menu = document.querySelector('[aria-label="Session information and actions"]').getBoundingClientRect();
      return create.width > 0 && create.right <= menu.left && menu.right <= innerWidth;
    })()`), 'Quick action is visible to the left of the session menu');
    await ab('screenshot', join(evidence, `quick-action-${width}.png`));
    await ab('click', 'main header [aria-label="New session here"]');
    await ab('wait', '--fn', `location.pathname === '/new' && !!document.querySelector('[aria-label="First message"]')`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Directory"]').title`), repo);
    if (width === 1280) {
      await ab('click', '[aria-label="Search sessions"]');
      await ab('wait', '--fn', `!!document.querySelector('[role="dialog"]')`);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('[cmdk-group-heading]')].map(node => node.textContent)`), ['Recent sessions', 'Global commands']);
      assert.equal(await evaluate(`!!document.querySelector('[cmdk-item][data-value="Copy all"]')`), false);
      await ab('screenshot', join(evidence, 'palette-global.png'));
      await ab('press', 'Escape');
      await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
    }
    await ab('back');
    await ab('wait', '--text', 'Message 39');
    const top = await evaluate(`document.querySelector('main header').getBoundingClientRect().top`);
    await ab('scroll', 'up', '2000', '--selector', '[data-slot="transcript"]');
    assert.equal(await evaluate(`document.querySelector('main header').getBoundingClientRect().top`), top);
    await menu();
    await ab('snapshot');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[role="menu"] > [role="group"]')].map(group => ({ label: group.querySelector('[data-slot="dropdown-menu-label"]')?.textContent ?? null, items: [...group.querySelectorAll('[role="menuitem"]')].map(item => item.getAttribute('aria-label') ?? item.textContent.trim()) }))`), [
      { label: 'Details', items: ['Copy working directory', 'Copy git branch', 'Copy session ID', 'Copy all'] },
      { label: 'Git', items: ['Changes', 'Pull request'] },
      { label: 'Session', items: ['Project', 'Rename', 'Archive'] },
      { label: null, items: ['Delete'] },
    ], 'visible categories group related actions and keep Delete separate');
    assert.equal(await evaluate(`document.querySelector('[role="menu"]').textContent.includes(${JSON.stringify(sessionFile)})`), false);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Copy session ID"]').textContent`), 'Session IDheader');
    assert.equal(await evaluate(`document.querySelector('[role="menu"]').textContent.includes('Copy session file path')`), false);
    assert.equal(await evaluate(`document.querySelector('[role="menu"]').textContent.includes('New session here')`), false);
    const bounds = await evaluate(`(() => { const r = document.querySelector('[role="menu"]').getBoundingClientRect(); return {left:r.left,right:r.right,width:innerWidth}; })()`);
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width);
    await ab('screenshot', join(evidence, `menu-${width}.png`));
    await ab('press', 'Escape');
    assert.equal(await menuIsOpen(), false);
    await menu(); await item('Rename');
    await ab('wait', '--text', 'Rename session');
    await ab('fill', '[aria-label="Session name"]', 'Do not save');
    await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
    await menu(); await item('Delete');
    await ab('wait', '--text', 'Delete this session?');
    await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
  }

  // Resize the desktop sidebar before exercising notices: centering is relative to main, not the viewport.
  await ab('set', 'viewport', '1280', '900');
  await evaluate(`(() => {
    const handle = document.querySelector('[aria-label="Resize sidebar"]');
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: handle.getBoundingClientRect().left }));
    dispatchEvent(new PointerEvent('pointermove', { clientX: 420 }));
    dispatchEvent(new PointerEvent('pointerup', { clientX: 420 }));
    return true;
  })()`);
  await ab('wait', '--fn', `document.querySelector('[aria-label="Resize sidebar"]')?.getAttribute('aria-valuenow') === '420'`);

  // Pointer copies are deliberately sequential in one open menu.
  await menu();
  await item('Copy working directory');
  await waitForCopies(1);
  assert.equal(await menuIsOpen(), true, 'first pointer copy keeps the menu open');
  await assertToastCentered('Working directory copied', 'desktop-resized');
  await item('Copy git branch');
  await waitForCopies(2);
  assert.equal(await menuIsOpen(), true, 'second pointer copy keeps the menu open');
  await item('Copy session ID');
  await waitForCopies(3);
  assert.equal(await menuIsOpen(), true, 'third pointer copy keeps the menu open');
  assert.deepEqual(await evaluate('window.copies'), [repo, 'header-test', 'header']);

  // Moving focus and clicking outside both dismiss the non-modal menu, and its trigger reopens it.
  await ab('focus', 'main header [aria-label="New session here"]');
  await ab('wait', '--fn', `!document.querySelector('[role="menu"][data-state="open"]')`);
  await menu();
  await ab('click', '[data-slot="transcript"]');
  await ab('wait', '--fn', `!document.querySelector('[role="menu"][data-state="open"]')`);
  await menu();
  assert.equal(await menuIsOpen(), true, 'trigger works after outside dismissal');
  await ab('click', '[aria-label="Session information and actions"]');
  await ab('wait', '--fn', `!document.querySelector('[role="menu"][data-state="open"]')`);

  // Collapsing the sidebar changes main's center; the notice follows it.
  await ab('click', '[aria-label="Hide sidebar"]');
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Show sidebar"]') && !document.querySelector('[aria-label="Resize sidebar"]')`);
  await menu(); await item('Copy git branch');
  await waitForCopies(4);
  assert.equal(await menuIsOpen(), true);
  await assertToastCentered('Git branch copied', 'desktop-collapsed');
  await ab('press', 'Escape');
  await ab('click', '[aria-label="Show sidebar"]');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Resize sidebar"]')?.getAttribute('aria-valuenow') === '420'`);

  // Keyboard activation copies without closing; Escape remains available to dismiss it.
  await ab('focus', '[aria-label="Session information and actions"]');
  await ab('press', 'Enter');
  await ab('wait', '--fn', `document.activeElement?.getAttribute('role') === 'menuitem'`);
  await ab('press', 'Enter');
  await waitForCopies(5);
  assert.equal(await menuIsOpen(), true, 'keyboard copy keeps the menu open');
  await ab('press', 'Escape');
  await ab('wait', '--fn', `!document.querySelector('[role="menu"][data-state="open"]')`);
  await ab('wait', '--fn', `document.activeElement?.getAttribute('aria-label') === 'Session information and actions'`);
  assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Session information and actions');

  // A rejected clipboard write reports the error without taking away the still-useful menu.
  await evaluate(`navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; true`);
  await menu(); await item('Copy working directory');
  await ab('wait', '--text', 'Couldn’t copy working directory.');
  assert.equal(await menuIsOpen(), true, 'failed copy keeps the menu open');
  await assertToastCentered('Couldn’t copy working directory.', 'desktop-error');
  await ab('press', 'Escape');
  await evaluate(`navigator.clipboard.writeText = async value => { window.copies.push(value); await window.nativeWrite(value); }; true`);

  // Mobile notices use the same main-relative horizontal center.
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast]')`);
  await ab('set', 'viewport', '390', '844');
  await menu(); await item('Copy session ID');
  await waitForCopies(6);
  assert.equal(await menuIsOpen(), true);
  await assertToastCentered('Session ID copied', 'mobile');
  const allDetails = `Working directory: ${repo}\nGit branch: header-test\nSession ID: header`;
  await item('Copy all');
  await waitForCopies(7);
  assert.equal(await evaluate('window.copies.at(-1)'), allDetails);
  assert.equal(await menuIsOpen(), false, 'Copy all dismisses the mobile menu');
  await ab('wait', '--fn', `!document.querySelector('[role="menu"][data-state="open"]')`);
  await ab('set', 'viewport', '1280', '900');
  await menu(); await item('Copy all');
  await waitForCopies(8);
  assert.equal(await evaluate('window.copies.at(-1)'), allDetails);
  assert.equal(await menuIsOpen(), false, 'Copy all dismisses the desktop menu');
  await ab('wait', '--fn', `!document.querySelector('[role="menu"][data-state="open"]')`);
  await ab('click', '[aria-label="Search sessions"]');
  await ab('wait', '--fn', `!!document.querySelector('[role="dialog"]')`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[cmdk-group-heading]')].map(node => node.textContent)`), ['Recent sessions', 'Global commands', 'Session commands']);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[cmdk-group]')].slice(1).map(group => ({ heading: group.querySelector('[cmdk-group-heading]')?.textContent, items: [...group.querySelectorAll('[cmdk-item]')].map(item => item.getAttribute('data-value')) }))`), [
    { heading: 'Global commands', items: ['new session', 'toggle sidebar', 'appearance light', 'appearance dark', 'appearance system', 'Group by folder', 'Group by project', 'No grouping', 'Sort by last activity', 'Sort by name'] },
    { heading: 'Session commands', items: ['Copy working directory', 'Copy git branch', 'Copy session ID', 'Copy all', 'Changes', 'Pull request', 'Rename', 'Archive', 'Delete', 'new session here'] },
  ]);
  await ab('screenshot', join(evidence, 'palette-groups.png'));
  // A session also contains "copy all": the exact command must outrank that group.
  await ab('fill', '[aria-label="Search sessions and commands"]', 'header verification');
  await ab('wait', '--fn', `document.querySelector('[cmdk-item]')?.textContent.includes('Header verification')`);
  await ab('fill', '[aria-label="Search sessions and commands"]', 'copy all');
  await ab('wait', '--fn', `document.querySelector('[cmdk-item]')?.getAttribute('data-value') === 'Copy all'`);
  assert.ok(await evaluate(`[...document.querySelectorAll('[cmdk-item]')].some(node => node.textContent.includes('Header verification'))`), 'competing session is still in the results');
  assert.equal(await evaluate(`document.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value')`), 'Copy all');
  assert.equal(await evaluate(`document.querySelectorAll('[cmdk-item] mark').length`), 0, 'search results have no match highlighting');
  await ab('screenshot', join(evidence, 'copy-all-ranked.png'));
  await evaluate(`document.querySelector('[aria-label="Search sessions and commands"]').select(); true`);
  await ab('press', 'Backspace');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Search sessions and commands"]').value === ''`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[cmdk-group-heading]')].map(node => node.textContent)`), ['Recent sessions', 'Global commands', 'Session commands']);
  await ab('wait', '--fn', `document.querySelector('[cmdk-list]').scrollTop === 0`);
  await ab('screenshot', join(evidence, 'cleared-search-top.png'));
  await ab('fill', '[aria-label="Search sessions and commands"]', 'copy all');
  await ab('wait', '--fn', `document.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') === 'Copy all'`);
  await ab('press', 'Enter');
  await waitForCopies(9);
  assert.equal(await evaluate('window.copies.at(-1)'), allDetails, 'palette copies the same labeled details');
  await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
  await ab('click', '[aria-label="Search sessions"]');
  await ab('fill', '[aria-label="Search sessions and commands"]', 'Rename');
  await ab('find', 'role', 'option', 'click', '--name', 'Rename', '--exact');
  await ab('wait', '--text', 'Rename session');
  await ab('fill', '[aria-label="Session name"]', 'Renamed from palette');
  await ab('find', 'role', 'button', 'click', '--name', 'Rename', '--exact');
  await ab('wait', '--fn', `document.querySelector('main h1')?.textContent === 'Renamed from palette'`);
  await ab('click', '[aria-label="Session menu for Renamed from palette"]');
  await item('Rename');
  await ab('wait', '--text', 'Rename session');
  await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
  await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
  await menu(); await item('Archive');
  await ab('wait', '--fn', `!document.querySelector('[aria-label="Session menu for Renamed from palette"]')`);
  console.log('PASS: desktop/mobile sticky identity; persistent pointer/keyboard/error copy menu; outside dismissal/reopen; main-centered toasts with resized/collapsed sidebar; shared confirmations, palette rename and archive');
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
