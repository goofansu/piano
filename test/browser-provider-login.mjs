// UI contract at a controlled HTTP boundary; no OAuth requests or real credentials.
// node test/browser-provider-login.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-login-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-login-browser-'));
const backendUrl = 'http://127.0.0.1:7171', frontendUrl = 'http://127.0.0.1:7172';
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '7171', PIANO_DB_PATH: join(root, 'piano.db'), PI_CODING_AGENT_DIR: join(root, 'agent') }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const browser = `provider-login-${process.pid}`, commands = [];
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
const waitClosed = () => ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
const open = async () => { await button('Sign in to OpenAI Codex'); await ab('wait', '--fn', `!!document.querySelector('#login-answer:not(:disabled)')`); };
const dialogButtons = () => evaluate(`[...document.querySelectorAll('[role="dialog"] button')].map(b => b.textContent.trim())`);
try {
  for (let n = 0; ; n++) {
    if (backend.exitCode !== null || frontend.exitCode !== null) throw new Error(processLog);
    try { if ((await fetch(`${backendUrl}/api/projects`)).ok && (await fetch(frontendUrl)).ok) break; } catch {}
    if (n > 150) throw new Error(`Scratch startup deadline: ${processLog}`);
    await delay(100);
  }
  await ab('set', 'viewport', '1280', '900'); await ab('open', frontendUrl);
  // Only the provider HTTP boundary is simulated. The real settings/dialog components run in Vite.
  await ab('eval', `(() => {
    const original = window.fetch.bind(window);
    const fixture = window.loginFixture = { state: null, deletes: 0, failCancel: false, completeOnCancel: false, signedIn: false, providerReads: 0, polls: 0 };
    window.fetch = async (input, init = {}) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
      if (path === '/api/oauth-providers') {
        fixture.providerReads++;
        return json({ providers: [{ id: 'openai-codex', name: 'OpenAI Codex', signedIn: fixture.signedIn }] });
      }
      if (path !== '/api/provider-login') return original(input, init);
      switch (init.method ?? 'GET') {
        case 'GET': fixture.polls++; break;
        case 'POST': fixture.state = { id: crypto.randomUUID(), provider: 'openai-codex', status: 'running', prompt: { id: 'method', type: 'select', message: 'Select login method:', options: [{ id: 'device', label: 'Device code login' }, { id: 'browser', label: 'Browser login' }] } }; break;
        case 'PUT': fixture.state = { id: fixture.state.id, provider: 'openai-codex', status: 'running', userCode: 'TEST-CODE', url: 'https://example.invalid/login', message: 'Open the sign-in page and enter this code.' }; break;
        case 'DELETE':
          fixture.deletes++;
          if (fixture.failCancel) return json({ error: 'Unavailable' }, 503);
          fixture.state = { id: fixture.state.id, provider: 'openai-codex', status: fixture.completeOnCancel ? 'success' : 'cancelled' };
          if (fixture.completeOnCancel) fixture.signedIn = true;
          break;
      }
      return json({ state: fixture.state });
    };
  })()`);
  await button('Settings'); await button('Providers');
  await open();
  assert.match(await ab('snapshot'), /Sign in to OpenAI Codex/);
  assert.deepEqual(await dialogButtons(), ['Choose a sign-in method', 'Cancel', 'Continue', 'Close']);
  await ab('screenshot', join(evidence, '01-method.png'));
  // Pointer dismissal is blocked; all deliberate dismissal controls cancel exactly once.
  await ab('mouse', 'move', '5', '5'); await ab('mouse', 'down'); await ab('mouse', 'up');
  assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), true);
  assert.equal(await evaluate('window.loginFixture.deletes'), 0);
  for (const action of ['Cancel', 'Escape', 'Close']) {
    if (action === 'Escape') await ab('press', 'Escape'); else await button(action);
    await waitClosed();
    assert.equal(await evaluate('window.loginFixture.state.status'), 'cancelled');
    if (action !== 'Close') await open();
  }
  assert.equal(await evaluate('window.loginFixture.deletes'), 3);
  await open();
  await ab('click', '#login-answer'); await ab('find', 'role', 'option', 'click', '--name', 'Device code login', '--exact');
  await button('Continue'); await ab('wait', '--text', 'Waiting for authorization…');
  assert.equal(await evaluate(`document.querySelector('#login-device-code').value`), 'TEST-CODE');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] a').textContent`), 'Open sign-in page');
  await ab('set', 'viewport', '390', '844'); await ab('screenshot', join(evidence, '02-authorize-mobile.png'));
  // Failed cancellation must not silently hide the still-running attempt.
  await ab('eval', 'window.loginFixture.failCancel = true'); await button('Cancel');
  await ab('wait', '--text', 'Could not cancel sign-in.');
  assert.equal(await evaluate('window.loginFixture.state.status'), 'running');
  const polls = await evaluate('window.loginFixture.polls');
  await ab('wait', '--fn', `window.loginFixture.polls > ${polls + 1}`);
  assert.match(await ab('snapshot'), /Could not cancel sign-in/);
  await ab('eval', 'window.loginFixture.failCancel = false'); await ab('press', 'Escape'); await waitClosed();
  await open();
  await ab('eval', `window.loginFixture.state = { id: window.loginFixture.state.id, provider: 'openai-codex', status: 'error', message: 'Sign-in expired. Please try again.' }`);
  await ab('wait', '--text', 'Sign-in expired.');
  assert.deepEqual(await dialogButtons(), ['Close', 'Try again', 'Close']);
  await button('Try again'); await ab('wait', '--fn', `!!document.querySelector('#login-answer:not(:disabled)')`);
  // Manual-code prompts retain both cancel and submit actions.
  await ab('eval', `window.loginFixture.state.prompt = { id: 'code', type: 'manual_code', message: 'Paste code' }`);
  await ab('wait', '--text', 'Paste code'); await ab('fill', '#login-answer', 'test-code'); await button('Continue');
  await ab('wait', '--text', 'Waiting for authorization…');
  await ab('eval', `window.loginFixture.signedIn = true; window.loginFixture.state = { id: window.loginFixture.state.id, provider: 'openai-codex', status: 'success', message: 'Start a new session to use the updated providers.' }`);
  await ab('wait', '--text', 'You’re signed in.');
  assert.deepEqual(await dialogButtons(), ['Done', 'Close']);
  const deletes = await evaluate('window.loginFixture.deletes');
  await button('Done'); await waitClosed();
  assert.equal(await evaluate('window.loginFixture.deletes'), deletes);
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Sign out of OpenAI Codex"]')`);
  // Completion winning the cancellation race must also refresh the provider list.
  await ab('eval', 'window.loginFixture.signedIn = false');
  await ab('set', 'viewport', '1280', '900');
  await button('Home'); await button('Settings'); await button('Providers'); await open();
  const reads = await evaluate('window.loginFixture.providerReads');
  await ab('eval', 'window.loginFixture.completeOnCancel = true'); await button('Cancel'); await waitClosed();
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Sign out of OpenAI Codex"]')`);
  assert.ok(await evaluate('window.loginFixture.providerReads') > reads);
  console.log('PASS: method/device/manual-code steps, Cancel/×/Escape, outside click, cancellation failure, retry, success and completion race.');
} finally {
  try { await ab('close'); } catch {}
  for (const p of [frontend, backend]) {
    if (p.exitCode === null) { p.kill('SIGTERM'); await new Promise(res => p.once('exit', res)); }
  }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
