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
const backendUrl = 'http://127.0.0.1:7171', frontendUrl = 'http://127.0.0.1:7172';
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOME: fixture.root, HOST: '127.0.0.1', PORT: '7171', PIANO_DB_PATH: join(fixture.root, 'piano.db'), PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir, PIANO_PI_CLI: fixture.cli().cli, PI_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
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
let socket;
try {
  for (let n = 0; ; n++) {
    if (backend.exitCode !== null || frontend.exitCode !== null) throw new Error(processLog);
    try { if ((await fetch(`${backendUrl}/api/projects`)).ok && (await fetch(frontendUrl)).ok) break; } catch {}
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
  socket.send(JSON.stringify({ _tag: 'add_project', path: cwd }));
  for (let n = 0; ; n++) {
    const result = await (await fetch(`${backendUrl}/api/projects`)).json();
    if (result.projects.some(project => project.path === cwd)) break;
    if (n > 100) throw new Error('Scratch registration deadline');
    await delay(50);
  }
  await ab('set', 'viewport', '1280', '900'); await ab('open', frontendUrl);
  await ab('wait', '--fn', `!!document.querySelector('button[aria-label^="Model: piano-phase0/"]')`);
  // Warm the ordinary cwd catalog before saving a different default.
  await button('Settings');
  await ab('wait', '--fn', `!!document.querySelector('#default-model:not(:disabled)')`);
  assert.equal(await evaluate(`document.querySelector('#default-model').textContent.trim()`), 'Automatic (Pi chooses)');
  assert.equal(await evaluate(`document.querySelector('[aria-labelledby="default-effort-label"] [data-state="on"]').textContent`), 'medium');
  await ab('click', '#default-model');
  await ab('fill', 'input[aria-label="Search default models"]', 'piano-phase0/project');
  await ab('find', 'role', 'option', 'click', '--name', 'piano-phase0/project', '--exact');
  await ab('find', 'role', 'radio', 'click', '--name', 'high', '--exact');
  await button('Save defaults'); await ab('wait', '--text', 'Defaults saved for new sessions.');
  assert.deepEqual({ provider: stored().defaultProvider, model: stored().defaultModel, effort: stored().defaultThinkingLevel, theme: stored().theme }, { provider: 'piano-phase0', model: 'project', effort: 'high', theme: 'dark' });
  assert.ok(invalidations > 0, 'other clients receive catalog invalidation');
  await ab('screenshot', join(evidence, '01-saved-desktop.png'));
  await button('Home');
  await ab('wait', '--fn', `!!document.querySelector('button[aria-label="Model: piano-phase0/project; effort: high"]')`);
  assert.match(await ab('snapshot'), /Model: piano-phase0\/project; effort: high/);
  // Both defaults survive reload; command-palette navigation reaches Models.
  await ab('reload');
  await ab('wait', '--fn', `!!document.querySelector('button[aria-label="Model: piano-phase0/project; effort: high"]')`);
  await ab('press', 'Control+k'); await ab('fill', 'input[aria-label="Search sessions and commands"]', 'Models');
  await ab('find', 'role', 'option', 'click', '--name', 'Models', '--exact');
  await ab('wait', '--fn', `document.querySelector('#default-model')?.textContent.includes('piano-phase0/project')`);
  assert.equal(await evaluate(`document.querySelector('[aria-labelledby="default-effort-label"] [data-state="on"]').textContent`), 'high');
  const invalid = await fetch(`${backendUrl}/api/settings/defaults`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thinkingLevel: 'bogus' }) });
  assert.equal(invalid.status, 400);
  assert.equal(stored().defaultThinkingLevel, 'high');
  // A failed durability boundary stays visible, retains the draft, and never claims success.
  chmodSync(settingsPath, 0o400);
  await ab('find', 'role', 'radio', 'click', '--name', 'low', '--exact'); await button('Save defaults');
  await ab('wait', '--text', 'Could not save defaults');
  assert.equal(stored().defaultThinkingLevel, 'high');
  assert.equal(await evaluate(`document.querySelector('[aria-labelledby="default-effort-label"] [data-state="on"]').textContent`), 'low');
  await ab('set', 'viewport', '390', '844'); await ab('screenshot', join(evidence, '02-save-error-mobile.png'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  chmodSync(settingsPath, 0o600);
  await button('Save defaults'); await ab('wait', '--text', 'Defaults saved for new sessions.');
  assert.equal(stored().defaultThinkingLevel, 'low');
  await ab('screenshot', join(evidence, '03-saved-mobile.png'));
  await ab('set', 'viewport', '1280', '900'); await button('Providers');
  await ab('wait', '--fn', `!!document.querySelector('#settings-providers-title')`);
  assert.equal(fixture.observe().requests.length, 0);
  console.log('PASS: unset defaults, model + effort persistence, catalog invalidation, new-session readback, reload, palette, validation, save failure/retry, mobile layout, Providers navigation; zero model requests.');
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
