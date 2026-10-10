// Real Pi settings and catalog, isolated resources; no model requests.
// node test/browser-model-settings.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-defaults-evidence/browser');
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
fixture.configureSentinel('disabled');
const settingsPath = join(fixture.agentDir, 'settings.json');
writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', cacheWarming: 'off' }));
const cwd = join(fixture.root, 'plain');
mkdirSync(cwd); assert.equal(spawnSync('git', ['init', '--quiet', cwd]).status, 0);
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171', frontendPort = process.env.PIANO_TEST_FRONTEND_PORT ?? '7172';
const backendUrl = `http://127.0.0.1:${backendPort}`, frontendUrl = `http://127.0.0.1:${frontendPort}`;
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOME: fixture.root, HOST: '127.0.0.1', PORT: backendPort, PIANO_DB_PATH: join(fixture.root, 'piano.db'), PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir, PIANO_PI_CLI: fixture.cli().cli, PI_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', frontendPort, '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const browser = `model-settings-${process.pid}`, commands = [];
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
const stored = () => JSON.parse(readFileSync(settingsPath, 'utf8'));
const picker = 'button[aria-label^="Model:"]';
const pickerLabel = () => evaluate(`document.querySelector(${JSON.stringify(picker)}).getAttribute('aria-label')`);
const efforts = () => evaluate(`[...document.querySelectorAll('[aria-label="Model and effort"] [role="radio"]')].map(button => button.textContent.trim())`);
const defaultButton = () => evaluate(`(() => { const b = [...document.querySelectorAll('[aria-label="Model and effort"] button')].find(b => /for new sessions$/.test(b.textContent)); return b ? { text: b.textContent, disabled: b.disabled } : null; })()`);
const chooseModel = async ref => {
  await ab('fill', 'input[aria-label="Search models"]', ref);
  await ab('find', 'role', 'option', 'click', '--name', ref, '--exact');
};
let socket;
try {
  for (let n = 0; ; n++) {
    if (backend.exitCode !== null || frontend.exitCode !== null) throw new Error(processLog);
    try { if ((await fetch(`${backendUrl}/api/folders`)).ok && (await fetch(frontendUrl)).ok) break; } catch {}
    if (n > 150) throw new Error(`Scratch startup deadline: ${processLog}`);
    await delay(100);
  }
  // Register only the scratch checkout. Observe invalidation from a second client as well.
  let invalidations = 0;
  socket = new WebSocket(backendUrl.replace('http', 'ws') + '/ws');
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    socket.send(JSON.stringify({ _tag: 'ack', deliveryId: message.deliveryId }));
    if (message._tag === 'catalogs_invalidated') invalidations++;
  });
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
  socket.send(JSON.stringify({ _tag: 'add_folder', path: cwd }));
  for (let n = 0; ; n++) {
    const result = await (await fetch(`${backendUrl}/api/folders`)).json();
    if (result.folders.some(folder => folder.path === cwd)) break;
    if (n > 100) throw new Error('Scratch registration deadline');
    await delay(50);
  }
  await ab('set', 'viewport', '1280', '900'); await ab('open', frontendUrl);
  await ab('wait', '--fn', `!!document.querySelector('button[aria-label^="Model: piano-phase0/"]:not(:disabled)')`);
  assert.match(await pickerLabel(), /effort: medium$/);
  assert.equal(stored().defaultModel, undefined, 'loading does not persist the automatic selection');
  // The Models settings section is gone.
  await button('Settings');
  assert.equal(await evaluate(`!!document.querySelector('button[aria-label="Models"]')`), false, 'no Models settings section');
  await ab('press', process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await ab('fill', 'input[aria-label="Search sessions and commands"]', 'Models');
  assert.equal(await evaluate(`[...document.querySelectorAll('[cmdk-item]')].some(e => e.getAttribute('data-value') === 'Models')`), false, 'no Models palette row');
  await ab('press', 'Escape');
  await button('Home');
  await ab('wait', '--fn', `!!document.querySelector(${JSON.stringify(picker + ':not(:disabled)')})`);
  await ab('click', picker);
  assert.deepEqual(await defaultButton(), { text: 'Default for new sessions', disabled: true }, 'the resolved default is already the default');
  await chooseModel('piano-phase0/project');
  assert.deepEqual(await efforts(), ['off', 'minimal', 'low', 'medium', 'high']);
  await ab('find', 'role', 'radio', 'click', '--name', 'high', '--exact');
  assert.deepEqual(await defaultButton(), { text: 'Use for new sessions', disabled: false });
  assert.equal(stored().defaultModel, undefined, 'choosing does not save');
  await evaluate(`(() => {
    window.pickerFlashes = [];
    const check = () => { for (const text of ['Loading models', 'No model matches.']) if (document.body.innerText.includes(text)) window.pickerFlashes.push(text); };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
    return true;
  })()`);
  await button('Use for new sessions'); await ab('wait', '--text', 'Defaults saved for new sessions.');
  assert.deepEqual({ provider: stored().defaultProvider, model: stored().defaultModel, effort: stored().defaultThinkingLevel, theme: stored().theme }, { provider: 'piano-phase0', model: 'project', effort: 'high', theme: 'dark' });
  assert.ok(invalidations > 0, 'other clients receive catalog invalidation');
  await ab('wait', '--fn', `[...document.querySelectorAll('[aria-label="Model and effort"] button')].some(b => b.textContent === 'Default for new sessions' && b.disabled)`);
  assert.deepEqual(await evaluate('window.pickerFlashes'), [], 'saving a default keeps the open picker populated while catalogs re-probe');
  await ab('screenshot', join(evidence, '01-saved-desktop.png'));
  await ab('press', 'Escape');
  // The saved default survives reload as the new-session selection.
  await ab('reload');
  await ab('wait', '--fn', `!!document.querySelector('button[aria-label="Model: piano-phase0/project; effort: high"]')`);
  const invalid = await fetch(`${backendUrl}/api/settings/defaults`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thinkingLevel: 'bogus' }) });
  assert.equal(invalid.status, 400);
  assert.equal(stored().defaultThinkingLevel, 'high');
  // A failed durability boundary is reported and never claims success.
  chmodSync(settingsPath, 0o400);
  await ab('set', 'viewport', '390', '844');
  await ab('click', picker);
  await ab('find', 'role', 'radio', 'click', '--name', 'low', '--exact');
  await button('Use for new sessions');
  await ab('wait', '--text', 'Could not save Pi settings');
  assert.equal(stored().defaultThinkingLevel, 'high');
  assert.match(await pickerLabel(), /effort: low$/);
  await ab('screenshot', join(evidence, '02-save-error-mobile.png'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  chmodSync(settingsPath, 0o600);
  await button('Use for new sessions'); await ab('wait', '--text', 'Defaults saved for new sessions.');
  assert.equal(stored().defaultThinkingLevel, 'low');
  await ab('screenshot', join(evidence, '03-saved-mobile.png'));
  assert.equal(fixture.observe().requests.length, 0);
  console.log('PASS: Models settings and palette row removed; picker saves model and effort as Pi defaults, marks the current default, invalidates catalogs, survives reload, validates input, reports save failure and retries, fits mobile; zero model requests.');
} finally {
  socket?.close();
  try { await ab('close'); } catch {}
  for (const p of [frontend, backend]) {
    if (p.exitCode === null) { p.kill('SIGTERM'); await new Promise(res => p.once('exit', res)); }
  }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  fixture.retain(evidence);
  await fixture.close();
}
