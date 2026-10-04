// Scratch-only Phase 3 journey; no credentials or model calls.
// node test/browser-phase3.mjs /tmp/piano-phase3-evidence/browser
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase3-evidence/browser');
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
const cwd = fixture.project('projection-browser', true);
const registry = join(fixture.root, 'registry.json');
writeFileSync(registry, JSON.stringify({ projects: [cwd], worktrees: [], sessions: [] }));
const canary = 'P3BrowserSecret-123456789';
const server = spawn(process.execPath, ['server/main.ts'], {
  env: { ...process.env, HOME: fixture.root, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry,
    PIANO_TEST_SECRET: canary, PIANO_PI_CLI: resolve('test/fake-projection-pi.mjs'), PIANO_PI_ARGS: '',
    PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [server, frontend]) { proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d); }
const init = join(fixture.root, 'observe.js');
writeFileSync(init, `window.sent=[]; window.received=[]; const NativeWebSocket=WebSocket;
window.WebSocket=class extends NativeWebSocket {
 constructor(...args){super(...args);this.addEventListener('message',e=>{if(this.url.endsWith('/ws'))received.push(JSON.parse(e.data));});}
 send(data){if(this.url.endsWith('/ws'))sent.push(JSON.parse(data));return super.send(data);}
};`);
const session = `phase3-${process.pid}`;
const commands = [], observations = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '30000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill('SIGTERM'), 45000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
async function capture(name) {
  const text = await ab('snapshot'); writeFileSync(join(evidence, `${name}.txt`), text);
  await ab('screenshot', join(evidence, `${name}.png`)); observations.push({ name, passed: true });
}
async function send(text) {
  await ab('mouse', 'move', '10', '10');
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast][data-visible="true"]')`);
  await ab('fill', '[aria-label="Message"]', text);
  await ab('click', 'main button[aria-label="Send"], main button[aria-label="Queue message"]');
  if (text !== '/error') await ab('wait', '--fn', `received.some(m=>m._tag==='session'&&m.event._tag==='notice'&&m.event.message===${JSON.stringify('barrier ' + text)})`);
}
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (i === 99) throw new Error('scratch UI did not start'); await delay(100);
  }
  await ab('--init-script', init, 'open', 'http://127.0.0.1:7172/new');
  await ab('wait', '--fn', `received.some(m=>m._tag==='models'&&m.catalog.cwd===${JSON.stringify(cwd)})`);
  await ab('fill', '[aria-label="First message"]', '/partial'); await ab('click', '[aria-label="Send"]');
  await ab('wait', '--text', 'first corrected second corrected');
  await ab('wait', '--text', 'Selected: router/auto');
  await capture('indexed-endings');
  await send('/secret');
  assert.equal(await evaluate(`JSON.stringify(received).includes(${JSON.stringify(canary.slice(0, 12))})`), false);
  await ab('reload'); await ab('wait', '--text', 'first corrected second corrected');
  assert.equal(await evaluate(`JSON.stringify(received).includes(${JSON.stringify(canary.slice(0, 12))})`), false);
  await capture('partial-reload-redacted');
  await send('/finish');
  await ab('wait', '--text', 'FINAL corrected'); await ab('wait', '--text', 'Nested read');
  assert.equal(await evaluate(`window.pwned??null`), null);
  assert.equal(await evaluate(`!!document.querySelector('main img,main script,main a[href^="javascript:"]')`), false);
  assert.equal(await evaluate(`JSON.stringify(received).includes(${JSON.stringify(canary)})`), false);
  const text = await evaluate('document.querySelector("main").textContent');
  assert.match(text, /Routed: physical\/answer/); assert.match(text, /Selected: router\/auto/);
  assert.match(text, /parent: parent/); assert.match(text, /parent final/); assert.match(text, /nested final \[REDACTED\]/);
  assert.match(text, /150 tokens/); assert.match(text, /Extension title/); assert.match(text, /Projection ready/);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Message"]').value`), '', 'editor request must not overwrite or send a browser draft');
  await capture('final-tools-extension-safe');
  await ab('reload'); await ab('wait', '--text', 'FINAL corrected'); await ab('wait', '--text', 'Nested read');
  assert.equal(await evaluate(`window.pwned??null`), null);
  assert.equal(await evaluate(`sent.filter(m=>m.action?._tag==='prompt'||m._tag==='create_session').length`), 0);
  assert.equal(await evaluate(`JSON.stringify(received).includes(${JSON.stringify(canary)})`), false);
  await capture('final-reload');
  await ab('find', 'role', 'button', 'click', '--name', 'Append to draft', '--exact');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Message"]').value`), 'Suggested follow-up [REDACTED]');
  await send('/clear');
  await ab('wait', '--fn', `!document.querySelector('[aria-label="Extension state"]').textContent.includes('Projection ready')`);
  await send('/compact');
  await ab('wait', '--text', 'Authoritative compacted context');
  assert.equal(await evaluate(`document.querySelector('main').textContent.includes('FINAL corrected')`), false);
  await capture('compacted-context');
  await send('/error'); await ab('wait', '--text', 'Rejected [REDACTED]');
  assert.equal(await evaluate(`JSON.stringify(received).includes(${JSON.stringify(canary)})`), false);
  await capture('rejection-redacted');
  const errors = await ab('errors');
  assert.ok(!errors.includes('Error:'), errors);
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'pass', observations, paidModelCalls: 0 }, null, 2));
  console.log('PASS: indexed corrections, selected/routed models, parent/nested output, cumulative usage, extension state/editor opt-in, compaction, redacted live/reload/errors, inert markup; zero paid calls');
} catch (error) {
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'fail', error: String(error), observations }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  try { await ab('close'); } catch {}
  for (const proc of [server, frontend]) if (proc.exitCode === null) proc.kill('SIGTERM');
  await Promise.all([server, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(r => proc.once('exit', r))));
  writeFileSync(join(evidence, 'browser-commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'server.log'), processLog.replaceAll(canary, '[REDACTED]'));
  fixture.retain(evidence); await fixture.close();
}
