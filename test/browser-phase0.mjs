// Phase 0 real-Pi browser gate: scratch backend/UI/repository, no paid model calls.
// Run: node test/browser-phase0.mjs /tmp/piano-phase0-evidence/browser
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPiCompatibilityFixture, sentinelTool } from './fixtures/PiCompatibility.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase0-evidence/browser');
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
const cwd = fixture.project('browser-project', true);
const startup = fixture.project('browser-startup', true, true);
const registry = join(fixture.root, 'registry.json');
writeFileSync(registry, JSON.stringify({ projects: [cwd, startup], worktrees: [], sessions: [] }));
const cli = fixture.cli();
const server = spawn(process.execPath, ['server/main.ts'], {
  env: { ...process.env, HOME: fixture.root, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry,
    PIANO_PI_CLI: cli.cli, PIANO_PI_ARGS: cli.extraArgs.join(' '), PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [server, frontend]) {
  proc.stdout.on('data', data => processLog += data);
  proc.stderr.on('data', data => processLog += data);
}
const init = join(fixture.root, 'observe.js');
writeFileSync(init, `window.sent=[]; window.received=[]; const NativeWebSocket=WebSocket;
window.WebSocket=class extends NativeWebSocket {
  constructor(...args){super(...args); this.addEventListener('message', e=>{if(this.url.endsWith('/ws'))received.push(JSON.parse(e.data));});}
  send(data){if(this.url.endsWith('/ws'))sent.push(JSON.parse(data));return super.send(data);}
};`);
const session = `phase0-${process.pid}`;
const commands = [];
const observations = [];
async function ab(...args) {
  // Keep the controller's local HTTP endpoint draining while the browser waits.
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], {
      env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '40000' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    const timer = setTimeout(() => child.kill('SIGTERM'), 55000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const header = () => evaluate(`document.querySelector('main header [role="status"]')?.textContent ?? null`);
async function capture(name) {
  observations.push({ name, header: await header() });
  writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot'));
  await ab('screenshot', join(evidence, `${name}.png`));
}
async function send(text) {
  // Existing bottom-right notifications can cover the action; hovering pauses expiry.
  await ab('mouse', 'move', '10', '10');
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast][data-visible="true"]')`);
  await ab('fill', '[aria-label="Message"]', text);
  await ab('press', 'Enter');
}
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, 'scratch backend exited');
    assert.equal(frontend.exitCode, null, 'scratch frontend exited');
    try { if ((await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (i === 99) throw new Error('scratch UI did not start');
    await delay(100);
  }
  await ab('--init-script', init, 'open', 'http://127.0.0.1:7172/new');
  await ab('wait', '--fn', `document.querySelector('[aria-label^="Model:"]')?.title==='piano-phase0/project'`);
  await ab('click', '[aria-label^="Model:"]');
  await ab('click', '[data-value="piano-phase0/project"]');
  await ab('find', 'role', 'radio', 'click', '--name', 'high', '--exact');
  await ab('press', 'Escape');
  await ab('fill', '[aria-label="First message"]', '/phase0-dialog');
  await ab('click', '[aria-label="Send"]');
  await ab('wait', '--text', 'Phase 0 supported dialog');
  assert.equal(await header(), 'Waiting for input');
  await capture('supported-dialog');
  await ab('reload');
  await ab('wait', '--text', 'Phase 0 supported dialog');
  assert.equal(fixture.observe().pi.filter(event => event.cwd === cwd && event.event === 'command-dialog').length, 1, 'reload does not execute the command twice');
  assert.equal(await evaluate(`sent.filter(m=>m._tag==='create_session'||['prompt','steer'].includes(m.action?._tag)).length`), 0);
  await ab('fill', '#pi-dialog-form input', 'BROWSER0');
  await ab('click', 'button[form="pi-dialog-form"]');
  await ab('wait', '--text', 'PHASE0_DIALOG_RESULT BROWSER0');
  await ab('wait', '--text', 'Command handled.');
  assert.equal(await header(), 'Ready');
  assert.equal(await evaluate(`document.querySelector('[aria-label^="Model:"]').title`), 'piano-phase0/project');
  assert.match(await evaluate(`document.querySelector('[aria-label^="Model:"]').getAttribute('aria-label')`), /effort: high$/);
  assert.equal(await evaluate(`document.querySelectorAll('article').length`), 0, 'no invented user message for the command');
  await capture('answered-after-reload');

  await send('/mcp');
  await ab('wait', '--text', 'piano-sentinel: disabled (direct)');
  await capture('project-mcp-override');
  await send('/phase0-facts');
  await ab('wait', '--text', 'PHASE0_FACTS');
  const facts = await evaluate(`JSON.parse(received.filter(m=>m._tag==='session'&&m.event._tag==='notice'&&m.event.message.startsWith('PHASE0_FACTS ')).at(-1).event.message.slice('PHASE0_FACTS '.length))`);
  assert.equal(facts.cwd, cwd); assert.equal(facts.trusted, true);
  assert.equal(facts.model, 'piano-phase0/project'); assert.equal(facts.effort, 'high');
  assert.equal(facts.tools.includes('phase0_project_marker'), true);
  assert.equal(facts.tools.includes(sentinelTool), false);
  assert.equal(fixture.observe().mcp.some(event => event.event === 'spawn' && event.cwd === cwd), false);
  writeFileSync(join(evidence, 'pi-facts.json'), JSON.stringify(facts, null, 2));

  await send('/phase0-wait');
  await ab('wait', '--text', 'PHASE0_WAITING');
  assert.equal(await header(), 'Working');
  await capture('fixture-wait');
  await ab('click', '[aria-label="Stop"]');
  await ab('wait', '--fn', `document.querySelector('main header [role="status"]').textContent==='Ready'`);
  await fixture.aborted;
  assert.equal(fixture.observe().requests.length, 1);
  assert.equal(fixture.observe().requests[0].aborted, true, 'native abort closed the local synthetic response');
  await capture('aborted');
  await send('/phase0-exit');
  await ab('wait', '--fn', `document.querySelector('main header [role="status"]').textContent==='Exited'`);
  await capture('exited');
  await ab('reload');
  await ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent==='Exited'`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Stop"]') || !!document.querySelector('[role="dialog"]')`), false);
  assert.equal(await evaluate(`sent.filter(m=>m._tag==='create_session'||['prompt','steer'].includes(m.action?._tag)).length`), 0, 'exited-session reload never resubmits');
  assert.equal(fixture.observe().requests.length, 1, 'reopening history is not continuation of the interrupted stream');
  await ab('wait', '--text', 'PHASE0_WAIT');
  await capture('exited-reload');

  // A project startup dialog blocks the catalog probe before RPC attaches.
  // Its bounded failure must not leave a usable Send button or an answerable dialog.
  await ab('open', 'http://127.0.0.1:7172/new');
  await ab('click', '[aria-label="Directory"]');
  await ab('click', `[data-value="${startup}"]`);
  // Wait for the bounded catalog result rather than starting a second probe.
  await ab('wait', '--fn', `received.some(m=>m._tag==='models'&&m.catalog.cwd===${JSON.stringify(startup)})`);
  await ab('fill', '[aria-label="First message"]', '/phase0-facts');
  const startupError = await evaluate(`received.find(m=>m._tag==='models'&&m.catalog.cwd===${JSON.stringify(startup)}).catalog.error`);
  assert.match(startupError, /get_available_models within 30000ms/);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Send"]').disabled`), true, 'no model catalog means startup cannot be submitted');
  assert.ok(fixture.observe().pi.some(event => event.cwd === startup && event.event === 'startup-dialog'));
  assert.equal(await evaluate(`sent.filter(m=>m._tag==='create_session'&&m.cwd===${JSON.stringify(startup)}).length`), 0, 'failed catalog discovery never creates a session');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Stop"]') || !!document.querySelector('[role="dialog"]')`), false, 'failed startup is neither a ready host nor an answerable dialog');
  await capture('startup-bounded-failure');
  await ab('errors');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'pass', facts, observations, startupError, paidModelCalls: 0 }, null, 2));
  console.log('PASS: real supported dialog/reload/answer, trusted project MCP/resource facts, model/effort, native abort, explicit exit/read-only reload, bounded startup failure without replay; startup dialog support remains blocked');
} catch (error) {
  try {
    await capture('failure');
    writeFileSync(join(evidence, 'failure-wire.json'), JSON.stringify(await evaluate('({sent,received})'), null, 2));
  } catch {}
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'fail', error: String(error), observations }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  try { await ab('close'); } catch {}
  for (const proc of [server, frontend]) if (proc.exitCode === null) proc.kill('SIGTERM');
  await Promise.all([server, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(r => proc.once('exit', r))));
  writeFileSync(join(evidence, 'browser-commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'server.log'), processLog);
  fixture.retain(evidence);
  try { await fixture.close(); } catch (error) { console.error(error); process.exitCode = 1; }
}
