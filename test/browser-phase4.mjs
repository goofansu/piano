// Scratch-only public routing + two-tab lifecycle journey, no model calls.
// node test/browser-phase4.mjs /tmp/piano-phase4-evidence/browser
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase4-evidence/browser');
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
const cwd = fixture.project('ownership-browser'), alias = join(fixture.root, 'checkout-alias');
symlinkSync(cwd, alias);
const id = 'browser-owned', registry = join(fixture.root, 'registry.json'), audit = join(fixture.root, 'host-audit.jsonl');
writeFileSync(audit, '');
writeFileSync(join(fixture.sessionDir, `${id}.jsonl`), [
  { type: 'session', version: 3, id, cwd, timestamp: '2026-10-05T00:00:00Z' },
  { type: 'message', id: 'saved', parentId: null, timestamp: '2026-10-05T00:00:01Z', message: { role: 'user', content: 'Saved history', timestamp: 1 } },
].map(x => JSON.stringify(x)).join('\n') + '\n');
writeFileSync(registry, JSON.stringify({ projects: [cwd], worktrees: [], sessions: [{ cwd, sessionId: id, title: 'Ownership journey', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false }] }));
const server = spawn(process.execPath, ['server/main.ts'], {
  env: { ...process.env, HOME: fixture.root, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry,
    PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: `--audit ${audit}`,
    PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [server, frontend]) { proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d); }
const init = join(fixture.root, 'observe.js');
writeFileSync(init, `window.sent=[];window.received=[];const NativeWebSocket=WebSocket;
window.WebSocket=class extends NativeWebSocket {
 constructor(...args){super(...args);if(this.url.endsWith('/ws'))window.control=this;this.addEventListener('message',e=>{if(this.url.endsWith('/ws'))received.push(JSON.parse(e.data));});}
 send(data){if(this.url.endsWith('/ws'))sent.push(JSON.parse(data));return super.send(data);}
};`);
const session = `phase4-${process.pid}`, commands = [], observations = [], sockets = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '40000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill('SIGTERM'), 55000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const records = () => readFileSync(audit, 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)).filter(r => r.sessionId === id);
const spawns = () => records().filter(r => r.event === 'spawn');
const waitStatus = word => ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent===${JSON.stringify(word)}`);
async function capture(name) {
  writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot'));
  await ab('screenshot', join(evidence, `${name}.png`)); observations.push({ name, passed: true });
}
async function send(text) {
  await ab('mouse', 'move', '10', '10');
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast][data-visible="true"]')`);
  await ab('fill', '[aria-label="Message"]', text);
  await ab('click', 'main button[aria-label="Send"], main button[aria-label="Queue message"]');
}
async function connect(path) {
  const ws = new WebSocket('ws://127.0.0.1:7171/ws'); sockets.push(ws);
  const seen = [];
  ws.addEventListener('message', e => seen.push(JSON.parse(e.data)));
  const wait = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', check); reject(new Error('websocket observation deadline')); }, 10000);
    function check() { const message = seen.find(predicate); if (message) { clearTimeout(timer); ws.removeEventListener('message', check); resolve(message); } }
    ws.addEventListener('message', check); check();
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.send(JSON.stringify({ _tag: 'select', cwd: path, sessionId: id }));
  await wait(m => m._tag === 'selected' && !m.hosted);
  return { ws, wait };
}
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok && (await fetch('http://127.0.0.1:7171/api/projects')).ok) break; } catch {}
    if (i === 99) throw new Error('scratch UI did not start'); await delay(100);
  }
  // Public WebSocket opens, not a private hosts-map assertion. No model prompts.
  const clients = await Promise.all([connect(cwd), connect(alias)]);
  for (const { ws } of clients) ws.send(JSON.stringify({ _tag: 'act', action: { _tag: 'set_thinking_level', level: 'low' }, start: {} }));
  await Promise.all(clients.map(c => c.wait(m => m._tag === 'selected' && m.hosted)));
  assert.equal(spawns().length, 1, 'simultaneous public opens coalesce aliases');
  for (const { ws } of clients) ws.close();
  const url = `http://127.0.0.1:7172/s/${id}`;
  await ab('--init-script', init, 'open', url); await waitStatus('Ready');
  await send('/hold'); await waitStatus('Working'); await capture('running');
  // Leave no browser observer attached, then return from two tabs.
  await ab('open', 'about:blank');
  assert.equal(spawns().length, 1); assert.equal(records().filter(r => r.event === 'exit').length, 0);
  await ab('open', url); await waitStatus('Working');
  await ab('tab', 'new', '--label', 'second', url); await waitStatus('Working');
  assert.equal(spawns().length, 1); assert.equal(records().filter(r => r.text === '/hold').length, 1);
  assert.equal(await evaluate(`sent.filter(m=>m.action?._tag==='prompt'||m._tag==='create_session').length`), 0);
  await capture('returned-two-tabs-one-execution');
  await evaluate('control.close(); true'); await waitStatus('Working');
  assert.equal(spawns().length, 1); assert.equal(records().filter(r => r.text === '/hold').length, 1);
  await capture('socket-reconnect-no-replay');
  await send('/silence');
  await ab('wait', '--fn', `received.some(m=>m._tag==='session'&&m.event._tag==='notice'&&m.event.message==='barrier /silence')`);
  await send('/events'); await ab('wait', '--text', 'Dialog behind readback');
  await ab('wait', '--text', 'Unable to refresh session details.');
  await capture('hung-readback-visible-dialog-responsive');
  process.kill(spawns()[0].pid, 'SIGUSR1');
  await ab('wait', '--text', 'Interrupted operations are not resumed'); await waitStatus('Exited');
  await capture('crashed-command');
  await ab('reload'); await waitStatus('Exited');
  await ab('wait', '--text', 'output behind hung readback');
  await ab('wait', '--text', 'Saved history');
  assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false);
  assert.equal(await evaluate(`sent.filter(m=>m.action?._tag==='prompt'||m._tag==='create_session').length`), 0);
  await capture('history-reopened-with-interruption');
  await ab('tab', 't1'); await waitStatus('Exited');
  await send('/after-crash'); await waitStatus('Ready');
  assert.equal(spawns().length, 2); assert.equal(records().filter(r => r.text === '/hold').length, 1);
  await capture('explicit-new-input-not-shell-resumption');
  // Archive through the normal pointer menu, then prove a stale tab cannot start it.
  await ab('click', '[aria-label="Session menu for Ownership journey"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Archive', '--exact');
  await ab('wait', '--fn', `received.some(m=>m._tag==='projects'&&m.projects.every(p=>p.sessions.every(s=>s.sessionId!==${JSON.stringify(id)})))`);
  await ab('tab', 'second');
  await evaluate(`control.send(JSON.stringify({ _tag:'act', action:{_tag:'prompt',text:'STALE_REOPEN'}, start:{} })); true`);
  await ab('wait', '--text', 'This session is archived');
  assert.equal(spawns().length, 2); assert.equal(records().some(r => r.text === 'STALE_REOPEN'), false);
  await capture('archived-stale-tab-rejected');
  assert.ok(!(await ab('errors')).includes('Error:'));
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'pass', observations, paidModelCalls: 0 }, null, 2));
  console.log('PASS: public concurrent alias opens, detachment/two tabs/reconnect, hung readback/dialog, crash/history/reopen, archive stale-tab rejection; no model calls');
} catch (error) {
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'fail', error: String(error), observations }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  for (const ws of sockets) ws.close();
  try { await ab('close'); } catch {}
  for (const proc of [server, frontend]) if (proc.exitCode === null) proc.kill('SIGTERM');
  await Promise.all([server, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(r => proc.once('exit', r))));
  writeFileSync(join(evidence, 'browser-commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'server.log'), processLog);
  writeFileSync(join(evidence, 'host-audit.jsonl'), readFileSync(audit, 'utf8'));
  const pids = [...new Set(readFileSync(audit, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid))];
  assert.deepEqual(pids.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), [], 'owned fake-Pi children must exit before scratch cleanup');
  fixture.retain(evidence); await fixture.close();
}
