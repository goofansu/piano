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
const root = realpathSync(mkdtempSync(join(tmpdir(), 'piano-header-')));
const repo = join(root, 'long-working-directory-for-session-header-verification');
const sessions = join(root, 'sessions');
const sessionId = '02863032-e09d-400f-b3b2-458194e82494';
const branch = 'header-test/long-branch-name-that-must-wrap-without-truncating-or-overflowing-the-session-menu';
for (const path of [repo, sessions, join(root, 'agent')]) mkdirSync(path);
execFileSync('git', ['init', '-q', '-b', branch, repo]);
writeFileSync(join(repo, 'README.md'), 'Scratch\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Initial']);
const timestamp = new Date().toISOString();
const sessionFile = join(sessions, 'header.jsonl');
const entries = [{ type: 'session', version: 3, id: sessionId, cwd: repo, timestamp }];
for (let n = 0; n < 40; n++) entries.push({ type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null, timestamp, message: { role: 'user', content: `Message ${n}\n\nTranscript scrolling check.`, timestamp: n } });
writeFileSync(sessionFile, entries.map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ folders: [repo], worktrees: [], sessions: [{ cwd: repo, sessionId, title: 'Header verification: copy all with a long session title to truncate on mobile', createdAt: timestamp, updatedAt: timestamp, archived: false }] }));
const fake = join(root, 'fake.mjs');
writeFileSync(fake, readFileSync('test/fake-pi.mjs', 'utf8').replace('const sessionId = args[args.indexOf("--session-id") + 1] || "nosession";', `const sessionId = args.includes("--session") ? ${JSON.stringify(sessionId)} : args[args.indexOf("--session-id") + 1] || "nosession";`));
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
/** A viewport change animates the sidebar off-canvas; click only once nothing covers the target. */
const uncovered = selector => ab('wait', '--fn', `(() => { const b = document.querySelector(${JSON.stringify(selector)}), r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })()`);
const menu = async () => {
  await ab('wait', '--fn', `!document.querySelector('[data-slot="dialog-overlay"]')`);
  await uncovered('[aria-label="Session information and actions"]');
  await ab('click', '[aria-label="Session information and actions"]');
  await ab('wait', '--fn', `!!document.querySelector('[role="menu"][data-state="open"]')`);
};
const item = name => ab('find', 'role', 'menuitem', 'click', '--name', name, '--exact');
// Rename/Archive/Delete live in the sidebar row menu and the palette; the palette reaches them at every width.
const palette = async name => {
  await ab('wait', '--fn', `!document.querySelector('[data-slot="dialog-overlay"]')`);
  await ab('press', process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await ab('fill', '[aria-label="Search sessions and commands"]', name);
  await ab('find', 'role', 'option', 'click', '--name', name, '--exact');
};
const closed = () => ab('wait', '--fn', `!document.querySelector('[role="menu"][data-state="open"]')`);
const allDetails = `Working directory: ${repo}\nSession ID: ${sessionId}`;
let copies = 0;
async function assertCopy() {
  // One browser round trip: a short-lived toast must not expire while launching CLI checks.
  await ab('wait', '--fn', `window.copies.length === ${++copies} && window.copies.at(-1) === ${JSON.stringify(allDetails)} && !document.querySelector('[role="menu"][data-state="open"]')`);
}
/** Toasts sit top-right in the main pane, below the header's content, so they never cover a title or its controls.
 *  The vertical check uses the toaster's settled offset; the toast itself may still be sliding in. */
async function assertToastPlaced(text, label) {
  // Observe in-page when the toast appears, not after several npx launches: under load
  // those launches can outlast the notification's display duration.
  await ab('wait', '--fn', `window.lastToast?.text.includes(${JSON.stringify(text)})`);
  const bounds = await evaluate('window.lastToast');
  assert.ok(bounds, `${label}: toast was visible`);
  assert.ok(bounds.toastLeft >= bounds.mainLeft && bounds.toastRight <= bounds.mainRight, `${label}: toast stays within main`);
  assert.ok(bounds.mainRight - bounds.toastRight <= 32, `${label}: toast is aligned to the right of main`);
  assert.ok(bounds.toastTop >= bounds.headerBottom, `${label}: toast stays below the header's title and controls`);
  await ab('screenshot', join(evidence, `toast-${label}.png`));
}
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).ok && (await fetch(`http://127.0.0.1:${frontendPort}`)).ok) break; } catch {}
    if (n === 100) throw new Error('Startup deadline');
    await delay(100);
  }
  await ab('open', `http://127.0.0.1:${frontendPort}/s/${sessionId}`);
  await ab('wait', '--text', 'Message 39');
  // Observe clipboard arguments while allowing the actual browser write to run.
  await evaluate(`window.copies = []; window.nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async value => { window.lastToast = null; window.copies.push(value); await window.nativeWrite(value); };
    new MutationObserver(() => requestAnimationFrame(() => {
      const node = document.querySelector('[data-sonner-toast][data-front="true"]'); // The newest toast; older ones may still be visible.
      if (!node) return;
      const main = document.querySelector('main').getBoundingClientRect();
      const toast = node.getBoundingClientRect();
      if (!toast.width || !toast.height) return;
      window.lastToast = { text: node.textContent, mainLeft: main.left, mainRight: main.right, mainCenter: main.left + main.width / 2, toastLeft: toast.left, toastRight: toast.right, toastCenter: toast.left + toast.width / 2, toastTop: node.closest('[data-sonner-toaster]').getBoundingClientRect().top, headerBottom: Math.max(...[...document.querySelectorAll('main header *')].filter(e => !e.children.length).filter(e => { const clip = e.parentElement.closest('.overflow-hidden'); return !clip || e.getBoundingClientRect().top < clip.getBoundingClientRect().bottom; }).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height).map(r => r.bottom)) };
    })).observe(document.body, { childList: true, subtree: true }); true`);
  for (const [width, height] of [[1280, 900], [390, 844], [320, 700]]) {
    await ab('set', 'viewport', String(width), String(height));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('main header p')].slice(0, 2).map(p => p.textContent)`), [`Folder: ${repo.split('/').pop()}`, 'Worktree: main']);
    assert.ok(await evaluate(`(() => {
      const create = document.querySelector('main header [aria-label="New session here"]').getBoundingClientRect();
      const menu = document.querySelector('[aria-label="Session information and actions"]').getBoundingClientRect();
      return create.width > 0 && create.right <= menu.left && menu.right <= innerWidth;
    })()`), 'Quick action remains visible');
    await uncovered('main header [aria-label="New session here"]');
    await ab('click', 'main header [aria-label="New session here"]');
    await ab('wait', '--fn', `location.pathname === '/new' && !!document.querySelector('[aria-label="First message"]')`);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Directory"]').title`), repo);
    await ab('back');
    await ab('wait', '--text', 'Message 39');
    const top = await evaluate(`document.querySelector('main header').getBoundingClientRect().top`);
    await ab('scroll', 'up', '2000', '--selector', '[data-slot="transcript"]');
    assert.equal(await evaluate(`document.querySelector('main header').getBoundingClientRect().top`), top);
    await menu();
    await ab('snapshot');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(item => item.textContent.trim())`), ['', 'Changes', 'Pull request']);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[role="menu"] dd')].map(node => node.textContent)`), [repo, sessionId]);
    assert.ok(await evaluate(`(() => {
      const menu = document.querySelector('[role="menu"]');
      const pathNode = menu.querySelector('dd');
      const path = pathNode.getBoundingClientRect();
      const copy = menu.querySelector('[aria-label="Copy all"]').getBoundingClientRect();
      const icon = menu.querySelector('[aria-label="Copy all"] svg').getBoundingClientRect();
      const firstLineCenter = path.top + parseFloat(getComputedStyle(pathNode).lineHeight) / 2;
      return !pathNode.closest('[role="group"]').querySelector('[data-slot="dropdown-menu-label"]') && path.right <= copy.left &&
        copy.width >= 44 && copy.height >= 44 && Math.abs(firstLineCenter - icon.top - icon.height / 2) <= 1;
    })()`), 'Copy icon centers on the first directory line with a mobile-sized touch target');
    assert.equal(await evaluate(`document.querySelector('[role="menu"]').textContent.includes(${JSON.stringify(sessionFile)})`), false);
    assert.ok(await evaluate(`(() => {
      const menu = document.querySelector('[role="menu"]');
      const bounds = menu.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && [...menu.querySelectorAll('dd')].every(node => {
        const r = node.getBoundingClientRect();
        return r.left >= bounds.left && r.right <= bounds.right && node.scrollWidth <= node.clientWidth && getComputedStyle(node).userSelect === 'text';
      });
    })()`), 'Full metadata wraps within the viewport and remains selectable');
    if (width === 320) assert.ok(await evaluate(`(() => {
      const values = [...document.querySelectorAll('[role="menu"] dd')];
      return values.every(node => node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight));
    })()`), 'Long path and session ID both wrap on narrow screens');
    await ab('screenshot', join(evidence, `menu-${width}.png`));
    await item('Copy all');
    await assertCopy();
    await assertToastPlaced('Session details copied', `width-${width}`);
    await palette('Rename');
    await ab('wait', '--text', 'Rename session');
    await ab('fill', '[aria-label="Session name"]', 'Do not save');
    await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
    await palette('Delete');
    await ab('wait', '--text', 'Delete this session?');
    await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
  }

  await ab('set', 'viewport', '1280', '900');
  await evaluate(`(() => {
    const handle = document.querySelector('[aria-label="Resize sidebar"]');
    // Drag by the distance that takes the sidebar itself to 420px, wherever the handle sits on its edge.
    const start = handle.getBoundingClientRect().left, target = start + 420 - handle.parentElement.getBoundingClientRect().width;
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: start }));
    dispatchEvent(new PointerEvent('pointermove', { clientX: target }));
    dispatchEvent(new PointerEvent('pointerup', { clientX: target }));
    return true;
  })()`);
  await ab('wait', '--fn', `document.querySelector('[aria-label="Resize sidebar"]')?.getAttribute('aria-valuenow') === '420'`);
  await menu(); await item('Copy all'); await assertCopy();
  await assertToastPlaced('Session details copied', 'desktop-resized');
  // Moving focus and clicking outside dismiss the non-modal menu; the trigger reopens it.
  await menu();
  await ab('focus', 'main header [aria-label="New session here"]'); await closed();
  await menu(); await ab('click', '[data-slot="transcript"]'); await closed();
  await menu(); await ab('press', 'Escape'); await closed();
  await ab('wait', '--fn', `document.activeElement?.getAttribute('aria-label') === 'Session information and actions'`);

  await ab('click', '[aria-label="Hide sidebar"]');
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Show sidebar"]') && !document.querySelector('[aria-label="Resize sidebar"]')`);
  await menu(); await item('Copy all'); await assertCopy();
  await assertToastPlaced('Session details copied', 'desktop-collapsed');
  await ab('click', '[aria-label="Show sidebar"]');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Resize sidebar"]')?.getAttribute('aria-valuenow') === '420'`);
  // Metadata is not a keyboard stop; Enter reaches the single copy action.
  await ab('focus', '[aria-label="Session information and actions"]'); await ab('press', 'Enter');
  await ab('wait', '--fn', `document.activeElement?.getAttribute('role') === 'menuitem'`);
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Copy all');
  await ab('press', 'Enter'); await assertCopy();
  await evaluate(`navigator.clipboard.writeText = async () => { window.lastToast = null; throw new Error('Denied'); }; true`);
  await menu(); await item('Copy all'); await closed();
  await assertToastPlaced('Couldn’t copy session details.', 'desktop-error');
  await evaluate(`navigator.clipboard.writeText = async value => { window.lastToast = null; window.copies.push(value); await window.nativeWrite(value); }; true`);

  await ab('click', '[aria-label="Search sessions"]');
  await ab('wait', '--fn', `!!document.querySelector('[role="dialog"]')`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[cmdk-group-heading]')].map(node => node.textContent)`), ['Recent sessions', 'Global commands', 'Session commands']);
  assert.equal(await evaluate(`document.querySelectorAll('[cmdk-item][data-value="Copy all"]').length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll('[cmdk-item][data-value="Conversation tree"], [cmdk-item][data-value="Bookmark"]').length`), 0);
  await ab('fill', '[aria-label="Search sessions and commands"]', 'copy all');
  await ab('wait', '--fn', `document.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') === 'Copy all'`);
  assert.ok(await evaluate(`[...document.querySelectorAll('[cmdk-item]')].some(node => node.textContent.includes('Header verification'))`), 'exact command outranks the competing session');
  assert.equal(await evaluate(`document.querySelectorAll('[cmdk-item] mark').length`), 0);
  await ab('screenshot', join(evidence, 'copy-details-ranked.png'));
  await evaluate(`document.querySelector('[aria-label="Search sessions and commands"]').select(); true`);
  await ab('press', 'Backspace');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Search sessions and commands"]').value === ''`);
  await ab('wait', '--fn', `document.querySelector('[cmdk-list]').scrollTop === 0`);
  await ab('fill', '[aria-label="Search sessions and commands"]', 'copy all');
  await ab('wait', '--fn', `document.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') === 'Copy all'`);
  await ab('press', 'Enter'); await assertCopy();
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
  await ab('click', '[aria-label="Session menu for Renamed from palette"]'); await item('Archive');
  await ab('wait', '--fn', `!document.querySelector('[aria-label="Session menu for Renamed from palette"]')`);
  console.log('PASS: desktop/390px/320px full selectable metadata; single pointer/keyboard copy action; copy error; palette parity/ranking; sticky header, confirmations, rename/archive, outside dismissal and top-right toasts');
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
