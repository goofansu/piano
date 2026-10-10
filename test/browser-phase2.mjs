// Phase 2 browser journey. Real locked CLI by default; `fake` adds delayed-abort ordering.
// node test/browser-phase2.mjs /tmp/piano-phase2-evidence/browser [fake]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase2-evidence/browser');
const fake = process.argv[3] === 'fake';
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
const cwd = fixture.project('dialog-browser', true);
const registry = join(fixture.root, 'registry.json');
writeFileSync(registry, JSON.stringify({ folders: [cwd], worktrees: [], sessions: [] }));
const cli = fake ? { cli: resolve('test/fake-dialog-pi.mjs'), extraArgs: [] } : fixture.cli();
const server = spawn(process.execPath, ['server/main.ts'], {
  env: { ...process.env, HOME: fixture.root, HOST: '127.0.0.1', PORT: '7171', ...registryEnv(registry),
    PIANO_PI_CLI: cli.cli, PIANO_PI_ARGS: cli.extraArgs.join(' '), PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [server, frontend]) {
  proc.stdout.on('data', data => processLog += data); proc.stderr.on('data', data => processLog += data);
}
const init = join(fixture.root, 'observe.js');
writeFileSync(init, `window.sent=[]; window.received=[]; const NativeWebSocket=WebSocket;
window.WebSocket=class extends NativeWebSocket {
  constructor(...args){super(...args); if(this.url.endsWith('/ws'))window.control=this; this.addEventListener('message',e=>{if(this.url.endsWith('/ws'))received.push(JSON.parse(e.data));});}
  send(data){if(this.url.endsWith('/ws'))sent.push(JSON.parse(data));return super.send(data);}
};`);
const session = `phase2-${process.pid}`;
const commands = [], observations = [];
async function ab(...args) {
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
const currentDialog = () => evaluate(`received.flatMap(m=>m._tag==='session'&&m.event._tag==='dialog'?[m.event.dialog]:m._tag==='session'&&m.event._tag==='snapshot'?m.event.snapshot.dialogs:m._tag==='selected'?m.snapshot.dialogs:[]).at(-1)`);
async function capture(name) {
  observations.push({ name, header: await evaluate(`document.querySelector('main header [role="status"]')?.textContent`) });
  writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot'));
  await ab('screenshot', join(evidence, `${name}.png`));
}
async function send(text) {
  await ab('mouse', 'move', '10', '10');
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast][data-visible="true"]')`);
  await ab('fill', '[aria-label="Message"]', text);
  await ab('click', 'main button[aria-label="Send"], main button[aria-label="Queue message"]');
}
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (i === 99) throw new Error('scratch UI did not start');
    await delay(100);
  }
  await ab('--init-script', init, 'open', 'http://127.0.0.1:7172/new');
  await ab('fill', '[aria-label="First message"]', fake ? '/hold-abort' : '/phase0-dialog');
  // Send stays disabled until the directory's model catalog arrives.
  await ab('wait', '--fn', `document.querySelector('[aria-label="Send"]')?.disabled === false`);
  await ab('click', '[aria-label="Send"]');
  if (fake) {
    await ab('wait', '--text', 'Command handled.');
    await send('/dialog input');
    await ab('wait', '--text', 'Fixture d1');
    await ab('find', 'role', 'button', 'click', '--name', 'Abort current', '--exact');
    await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
    await send('/new-turn-release-abort');
    await ab('wait', '--text', 'Fixture d3');
    await ab('wait', '--fn', `received.some(m=>m._tag==='session'&&m.event._tag==='notice'&&m.event.message==='old abort acknowledged')`);
    assert.match(await evaluate(`document.querySelector('main header [role="status"]').textContent`), /Waiting for input/);
    await capture('new-dialog-survives-old-abort');
    await ab('reload'); await ab('wait', '--text', 'Fixture d3');
    assert.equal(await evaluate(`sent.filter(m=>m.action?._tag==='prompt').length`), 0);
    await capture('new-turn-reload');
  } else {
    await ab('wait', '--text', 'Phase 0 supported dialog');
    const original = await currentDialog();
    const url = await evaluate('location.href');
    await ab('tab', 'new', '--label', 'second', url);
    await ab('wait', '--text', 'Phase 0 supported dialog');
    assert.deepEqual(await currentDialog(), original);
    await ab('reload'); await ab('wait', '--text', 'Phase 0 supported dialog');
    assert.equal((await currentDialog()).deadlineAt, original.deadlineAt);
    await capture('second-tab-original-deadline');
    await ab('tab', 't1');
    await ab('fill', '#pi-dialog-form input', 'PHASE2_ANSWER');
    await ab('click', 'button[form="pi-dialog-form"]');
    await ab('wait', '--text', 'Consumption is unconfirmed');
    await ab('tab', 'second');
    await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
    assert.equal(fixture.observe().pi.filter(e=>e.event==='command-dialog-returned'&&e.value==='PHASE2_ANSWER').length, 1);
    // A stale tab's action fails clearly, rather than replaying a second response.
    await evaluate(`control.send(JSON.stringify({...${JSON.stringify({ _tag: 'act', action: { _tag: 'answer', id: original.id, generation: original.generation, value: 'DUPLICATE' } })}, selectionId:received.filter(m=>m._tag==='selected').at(-1).selectionId})); true`);
    await ab('wait', '--text', 'Dialog is no longer open');
    await capture('one-resolution-both-tabs');
    await ab('reload'); await ab('wait', '--text', 'Consumption is unconfirmed');
    assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false);

    await send('/phase2-timeout');
    await ab('wait', '--text', 'Phase 2 timed dialog');
    const timed = await currentDialog();
    assert.equal(timed.timeoutMs, 12000); assert.equal(timed.deadlineKind, 'pi-timeout');
    await ab('reload'); await ab('wait', '--text', 'Phase 2 timed dialog');
    assert.equal((await currentDialog()).deadlineAt, timed.deadlineAt);
    await ab('wait', '--text', 'Estimated Pi deadline elapsed');
    assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false);
    assert.ok(fixture.observe().pi.some(e=>e.event==='timed-dialog-returned'&&e.value===null));
    await capture('timeout-closed');
    await ab('tab', 't1');
    await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
    await ab('reload'); await ab('wait', '--text', 'Estimated Pi deadline elapsed');
    await capture('timeout-does-not-reappear');

    await send('/phase0-dialog');
    await ab('wait', '--text', 'Phase 0 supported dialog');
    await ab('find', 'role', 'button', 'click', '--name', 'Abort current', '--exact');
    await ab('wait', '--text', 'Cancellation written to Pi');
    await ab('wait', '--text', 'PHASE0_DIALOG_RESULT cancelled');
    assert.ok(fixture.observe().pi.some(e=>e.event==='command-dialog-returned'&&e.value===null));
    await capture('idle-command-aborted');
    await ab('tab', 'second'); await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
    await ab('reload'); await ab('wait', '--text', 'Cancellation written to Pi');
    assert.equal(await evaluate(`sent.filter(m=>m.action?._tag==='prompt'||m._tag==='create_session').length`), 0);
    assert.equal(fixture.observe().requests.length, 0);
    await capture('aborted-reload');
  }
  await ab('errors');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'pass', fake, observations, paidModelCalls: 0 }, null, 2));
  console.log(`PASS: ${fake ? 'new turn/dialog survives a delayed old abort acknowledgement and reload' : 'two tabs, exactly one resolution, original deadline after reload, timeout, idle-command abort, no automatic resubmission'}; no paid calls`);
} catch (error) {
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
