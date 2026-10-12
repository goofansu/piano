// Composer-local shortcut and native effort keyboard flow on isolated real Pi resources.
// node test/browser-model-picker.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-model-picker-evidence');
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
fixture.configureSentinel('disabled');
const cwd = join(fixture.root, 'plain');
mkdirSync(cwd);
assert.equal(spawnSync('git', ['init', '--quiet', cwd]).status, 0);
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171', frontendPort = process.env.PIANO_TEST_FRONTEND_PORT ?? '7172';
const backendUrl = `http://127.0.0.1:${backendPort}`, frontendUrl = `http://127.0.0.1:${frontendPort}`;
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOME: fixture.root, HOST: '127.0.0.1', PORT: backendPort, PIANO_ALLOWED_ORIGINS: frontendUrl, PIANO_DB_PATH: join(fixture.root, 'piano.db'), PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir, PIANO_PI_CLI: fixture.cli().cli, PI_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', frontendPort, '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const commands = [], browser = `model-picker-${process.pid}`;
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
const picker = 'button[aria-label^="Model:"]';
const search = 'input[aria-label="Search models"]';
const panel = '[aria-label="Model and effort"]';
const shortcut = process.platform === 'darwin' ? 'Meta+/' : 'Control+/';
const focusText = () => evaluate('document.activeElement.textContent.trim()');
const closed = () => ab('wait', '--fn', `!document.querySelector('${panel}')`);
const pick = async model => { await ab('fill', search, `piano-phase0/${model}`); await ab('press', 'Enter'); };
const resumed = async (label, draft) => {
  await closed();
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), label);
  assert.equal(await evaluate('document.activeElement.value'), draft);
};
try {
  for (let n = 0; ; n++) {
    if (backend.exitCode !== null || frontend.exitCode !== null) throw new Error(processLog);
    try { if ((await fetch(`${backendUrl}/api/folders`)).ok && (await fetch(frontendUrl)).ok) break; } catch {}
    if (n > 150) throw new Error(`Scratch startup deadline: ${processLog}`);
    await delay(100);
  }
  await ab('open', frontendUrl);
  await evaluate(`new Promise((resolve, reject) => {
    const ws = new WebSocket(${JSON.stringify(backendUrl.replace('http', 'ws') + '/ws')});
    ws.onopen = () => { ws.send(JSON.stringify({ _tag: 'add_folder', path: ${JSON.stringify(cwd)} })); resolve(true); };
    ws.onerror = reject;
    ws.onmessage = event => { const m = JSON.parse(event.data); ws.send(JSON.stringify({ _tag: 'ack', deliveryId: m.deliveryId })); };
  })`);
  for (let n = 0; ; n++) {
    if ((await (await fetch(`${backendUrl}/api/folders`)).json()).folders.some(f => f.path === cwd)) break;
    if (n > 100) throw new Error('Registration deadline');
    await delay(50);
  }
  await ab('open', frontendUrl);
  await ab('wait', '--fn', `!!document.querySelector('${picker}:not(:disabled)')`);
  await ab('fill', 'textarea[aria-label="First message"]', 'Keep this draft');
  // IME input must not open the picker.
  assert.equal(await evaluate(`(() => { const t = document.activeElement; const e = new KeyboardEvent('keydown', { key: '/', metaKey: ${process.platform === 'darwin'}, ctrlKey: ${process.platform !== 'darwin'}, isComposing: true, bubbles: true, cancelable: true }); t.dispatchEvent(e); return e.defaultPrevented; })()`), false);
  assert.equal(await evaluate(`!!document.querySelector('${panel}')`), false);
  await ab('press', shortcut);
  await ab('wait', '--fn', `document.activeElement.getAttribute('aria-label') === 'Search models'`);
  await pick('project');
  await ab('wait', '--fn', `document.activeElement.getAttribute('role') === 'radio'`);
  assert.equal(await focusText(), 'low');
  await ab('press', 'ArrowRight');
  assert.equal(await focusText(), 'medium');
  await ab('press', 'Enter'); // No Space required.
  await resumed('First message', 'Keep this draft');
  assert.match(await evaluate(`document.querySelector('${picker}').getAttribute('aria-label')`), /project; effort: medium$/);
  assert.equal(fixture.observe().requests.length, 0, 'effort Enter never sends the draft');
  await ab('press', shortcut); await pick('plain');
  await ab('wait', '--fn', `document.activeElement.textContent === 'Done'`);
  await ab('press', 'Enter'); await resumed('First message', 'Keep this draft');
  // Mouse selection retains model list and effort, Space selects without closing.
  await ab('click', picker); await ab('fill', search, 'piano-phase0/global');
  await ab('find', 'role', 'option', 'click', '--name', 'piano-phase0/global', '--exact');
  await ab('wait', '--fn', `document.activeElement.getAttribute('role') === 'radio'`);
  assert.equal(await evaluate(`!!document.querySelector('${search}') && !!document.querySelector('${panel} [role="radio"]')`), true);
  await ab('press', 'ArrowRight'); await ab('press', 'Space');
  assert.equal(await evaluate(`!!document.querySelector('${panel}')`), true);
  await ab('screenshot', join(evidence, '01-mouse-and-keyboard.png'));
  await ab('find', 'role', 'button', 'click', '--name', 'Done', '--exact'); await resumed('First message', 'Keep this draft');
  await ab('press', shortcut); await ab('press', 'Escape'); await resumed('First message', 'Keep this draft');
  // Not a global binding, even when another input has focus.
  await ab('click', 'button[aria-label="Directory"]');
  await ab('fill', 'input[aria-label="Search folders"]', ''); await ab('press', shortcut);
  assert.equal(await evaluate(`!!document.querySelector('${panel}')`), false);
  await ab('press', 'Escape');
  // Start only the synthetic fixture request, then exercise the hosted/server-owned choice.
  await ab('focus', 'textarea[aria-label="First message"]');
  await evaluate('document.activeElement.setSelectionRange(0, document.activeElement.value.length); true'); await ab('press', 'Backspace');
  await ab('fill', 'textarea[aria-label="First message"]', 'PHASE0_WAIT');
  assert.equal(await evaluate('document.activeElement.value'), 'PHASE0_WAIT');
  await ab('press', 'Enter');
  await ab('snapshot', '-i');
  await ab('wait', '--text', 'PHASE0_WAITING');
  await ab('fill', 'textarea[aria-label="Message"]', 'Hosted draft');
  await ab('press', shortcut); await pick('plain');
  await ab('wait', '--fn', `document.activeElement.textContent === 'Done'`);
  assert.match(await evaluate(`document.querySelector('${picker}').getAttribute('aria-label')`), /plain; effort: off$/);
  await ab('press', 'Escape'); await resumed('Message', 'Hosted draft');
  await ab('press', shortcut); await pick('project');
  await ab('wait', '--fn', `document.activeElement.getAttribute('role') === 'radio'`);
  assert.match(await evaluate(`document.querySelector('${picker}').getAttribute('aria-label')`), /project;/);
  assert.equal(await focusText(), 'low', 'Pi restores the supported default effort for the reasoning model');
  await ab('press', 'ArrowRight'); await ab('press', 'Enter');
  await resumed('Message', 'Hosted draft');
  await ab('wait', '--fn', `document.querySelector('${picker}').getAttribute('aria-label').endsWith('effort: medium')`);
  assert.equal(fixture.observe().requests.length, 1, 'hosted effort Enter never queues or sends');
  await ab('screenshot', join(evidence, '02-hosted-draft-preserved.png'));
  await evaluate('document.activeElement.setSelectionRange(0, document.activeElement.value.length); true');
  await ab('press', 'Backspace');
  await ab('find', 'role', 'button', 'click', '--name', 'Stop', '--exact');
  console.log('PASS: local shortcut in both composers; IME ignored; model-to-effort focus; native arrows, Space, direct Enter; mouse list stays visible; plain model focuses Done; Escape/Done restore focus and preserve drafts; hosted authoritative model/effort updates; no accidental sends.');
} finally {
  try { await ab('close'); } catch {}
  for (const p of [frontend, backend]) if (p.exitCode === null) { p.kill('SIGTERM'); await new Promise(res => p.once('exit', res)); }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  fixture.retain(evidence);
  await fixture.close();
}
