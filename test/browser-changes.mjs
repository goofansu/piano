// Changes sheet (INV-01, INV-07, INV-08): scratch Git + saved Pi history, no paid calls.
// node test/browser-changes.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

const evidence = resolve(process.argv[2] ?? '/tmp/piano-changes-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = realpathSync(mkdtempSync(join(tmpdir(), 'piano-changes-')));
const repo = join(root, 'repo'), sessions = join(root, 'sessions'), store = join(root, 'revisions');
for (const path of [repo, sessions, store, join(root, 'agent')]) mkdirSync(path);
execFileSync('git', ['init', '-q', '-b', 'review', repo]);
mkdirSync(join(repo, 'src'));
writeFileSync(join(repo, 'README.md'), 'Scratch\n');
writeFileSync(join(repo, 'src', 'app.ts'), 'import a;\nold line\n\ntail\n');
writeFileSync(join(repo, 'gone.txt'), 'bye\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Initial']);
// Working tree: one edit, one untracked file, one deletion; nothing staged.
writeFileSync(join(repo, 'src', 'app.ts'), 'import a;\nnew line\nanother\n\ntail\n');
writeFileSync(join(repo, 'notes.md'), 'untracked note\n');
rmSync(join(repo, 'gone.txt'));
const timestamp = new Date().toISOString();
writeFileSync(join(sessions, 'changes.jsonl'), [
  { type: 'session', version: 3, id: 'changes', cwd: repo, timestamp },
  { type: 'message', id: 'm0', parentId: null, timestamp, message: { role: 'user', content: 'Edit app.ts', timestamp: 0 } },
].map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [{ cwd: repo, sessionId: 'changes', title: 'Changes verification', createdAt: timestamp, updatedAt: timestamp, archived: false }] }));
const fake = join(root, 'fake.mjs');
writeFileSync(fake, readFileSync('test/fake-pi.mjs', 'utf8').replace('const sessionId = args[args.indexOf("--session-id") + 1] || "nosession";', 'const sessionId = args.includes("--session") ? "changes" : args[args.indexOf("--session-id") + 1] || "nosession";'));
const backendPort = await freePort(), frontendPort = await freePort();
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(backendPort), PIANO_CONFIG: join(root, 'registry.json'), PIANO_REVISION_STORE: store, PIANO_PI_CLI: fake, PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const browser = `changes-${process.pid}`, commands = [];
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
const sheet = `document.querySelector('[data-slot="sheet-content"][data-state="open"]')`;
const openMenu = async () => { await ab('click', '[aria-label="Session information and actions"]'); await ab('wait', '--fn', `!!document.querySelector('[role="menu"][data-state="open"]')`); };
const menuItem = name => ab('find', 'role', 'menuitem', 'click', '--name', name, '--exact');
const waitSheet = () => ab('wait', '--fn', `!!${sheet}`);
const waitClosed = () => ab('wait', '--fn', `!document.querySelector('[data-slot="sheet-content"]')`);
const sheetText = () => evaluate(`${sheet}.textContent`);
const filePaths = () => evaluate(`[...${sheet}.querySelectorAll('[data-path]')].map(n => n.dataset.path)`);
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/projects`)).ok && (await fetch(`http://127.0.0.1:${frontendPort}`)).ok) break; } catch {}
    if (n === 100) throw new Error('Startup deadline');
    await delay(100);
  }
  await ab('set', 'viewport', '1280', '900');
  await ab('open', `http://127.0.0.1:${frontendPort}/s/changes`);
  await ab('wait', '--text', 'Edit app.ts');

  // 1. Header menu → Changes: the working tree is listed as one review surface.
  await openMenu(); await menuItem('Changes');
  await waitSheet();
  await ab('wait', '--fn', `${sheet}.textContent.includes('3 files')`);
  assert.deepEqual(await filePaths(), ['gone.txt', 'notes.md', 'src/app.ts']);
  const text = await sheetText();
  assert.match(text, /Working tree against HEAD/);
  assert.match(text, /HEAD·review·3 files · \+3 −2/);
  assert.match(text, /@@ -1,4 \+1,5 @@/);
  assert.match(text, /New file/); assert.match(text, /Deleted/);
  const rows = await evaluate(`[...${sheet}.querySelectorAll('[data-path="src/app.ts"] tbody tr')].map(r => r.textContent.trim())`);
  assert.ok(rows.some(r => /^1\s*1\s+import a;$/.test(r)), rows.join('|'));
  assert.ok(rows.some(r => /^2\s*−old line$/.test(r)), rows.join('|'));
  assert.ok(rows.some(r => /^2\s*\+new line$/.test(r)), rows.join('|'));
  assert.equal(await evaluate(`${sheet}.textContent.includes(${JSON.stringify(repo)})`), false, 'details stay behind the disclosure');
  await ab('screenshot', join(evidence, 'sheet-desktop.png'));

  // 2. Collapse all hides hunks and survives a refresh; expand all restores them.
  await ab('find', 'role', 'button', 'click', '--name', 'Collapse all', '--exact');
  await ab('wait', '--fn', `${sheet}.querySelectorAll('table').length === 0`);
  await ab('find', 'role', 'button', 'click', '--name', 'Refresh changes', '--exact');
  await delay(800);
  assert.equal(await evaluate(`${sheet}.querySelectorAll('table').length`), 0, 'collapsed files stay collapsed across a refresh');
  await ab('find', 'role', 'button', 'click', '--name', 'Expand all', '--exact');
  await ab('wait', '--fn', `${sheet}.querySelectorAll('table').length === 3`);

  // 3. An external edit shows up after window focus.
  writeFileSync(join(repo, 'src', 'app.ts'), 'import a;\nnew line\nanother\nEDITED_AGAIN\n\ntail\n');
  await evaluate(`window.dispatchEvent(new Event('focus')); true`);
  await ab('wait', '--fn', `${sheet}.textContent.includes('EDITED_AGAIN')`);
  assert.equal(await evaluate(`${sheet}.querySelector('[role="status"]').textContent`), '3 files · +4 −2');

  // 4. Capture details are on demand.
  await ab('find', 'role', 'button', 'click', '--name', 'Capture details', '--exact');
  await ab('wait', '--fn', `${sheet}.textContent.includes('Revision')`);
  assert.match(await sheetText(), /v1-[0-9a-f]{12}/);

  // 5. Ask about this file appends the file's diff to the draft and closes the sheet.
  await ab('click', `[aria-label="Ask about src/app.ts"]`);
  await waitClosed();
  await ab('wait', '--text', 'Added to your message');
  const draft = await evaluate(`document.querySelector('[aria-label="Message"]').value`);
  assert.match(draft, /^About `src\/app\.ts` \(working tree against HEAD [0-9a-f]{12}, captured \d/);
  assert.match(draft, /```diff\ndiff --git a\/src\/app\.ts b\/src\/app\.ts\n[\s\S]*\+EDITED_AGAIN\n[\s\S]*```\n$/);
  assert.ok(!draft.includes('notes.md'), 'only the asked file is attached');
  await ab('screenshot', join(evidence, 'ask-draft.png'));

  // 6. The palette offers the same row; Escape closes the sheet.
  await ab('click', '[aria-label="Search sessions"]');
  await ab('wait', '--fn', `!!document.querySelector('[cmdk-item][data-value="Changes"]')`);
  await ab('fill', '[aria-label="Search sessions and commands"]', 'chang');
  await ab('click', '[cmdk-item][data-value="Changes"]');
  await waitSheet();
  await ab('wait', '--fn', `${sheet}.textContent.includes('3 files')`);
  await ab('press', 'Escape');
  await waitClosed();

  // 7. Phone width: the sheet fills the screen and the list stays readable.
  await ab('set', 'viewport', '390', '844');
  await openMenu(); await menuItem('Changes');
  await waitSheet();
  await ab('wait', '--fn', `${sheet}.textContent.includes('3 files')`);
  const bounds = await evaluate(`(() => { const r = ${sheet}.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, overflow: ${sheet}.scrollWidth > ${sheet}.clientWidth }; })()`);
  assert.ok(bounds.left === 0 && bounds.right === bounds.width, JSON.stringify(bounds));
  await ab('screenshot', join(evidence, 'sheet-mobile.png'));
  await ab('press', 'Escape');
  await waitClosed();

  // 8. Clean checkout: an honest empty state, not an error.
  execFileSync('git', ['-C', repo, 'checkout', '-q', '--', 'src/app.ts', 'gone.txt']);
  rmSync(join(repo, 'notes.md'));
  await ab('set', 'viewport', '1280', '900');
  await openMenu(); await menuItem('Changes');
  await waitSheet();
  await ab('wait', '--text', 'No changes');
  assert.match(await sheetText(), /HEAD·review·no changes/);
  await ab('screenshot', join(evidence, 'sheet-empty.png'));
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ status: 'pass', repo, backendPort, frontendPort }, null, 2));
  console.log('PASS');
} finally {
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'processes.log'), processLog);
  await ab('close').catch(() => {});
  backend.kill(); frontend.kill();
  rmSync(root, { recursive: true, force: true });
}
