// Scratch-only INV-05 browser + public WebSocket gate. No model calls.
// node test/browser-phase5.mjs /tmp/piano-phase5-evidence/browser
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase5-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-phase5-')), cwd = join(root, 'repo'), sessions = join(root, 'sessions');
mkdirSync(cwd); mkdirSync(sessions); mkdirSync(join(root, 'agent'));
assert.equal(spawnSync('git', ['init', '--quiet', cwd]).status, 0);
const registry = join(root, 'registry.json'), audit = join(root, 'audit.jsonl'); writeFileSync(audit, '');
const ids = ['ordered-a', 'ordered-b', 'delayed'];
for (const id of ids) writeFileSync(join(sessions, `${id}.jsonl`), [
  { type: 'session', version: 3, id, cwd, timestamp: new Date().toISOString() },
  { type: 'message', id: 'saved', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: `Saved ${id}`, timestamp: 1 } },
].map(v => JSON.stringify(v)).join('\n') + '\n');
writeFileSync(registry, JSON.stringify({ projects: [cwd], worktrees: [], sessions: ids.map(sessionId => ({ cwd, sessionId, title: sessionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false })) }));
const canary = 'sk-phase5-browser-canary-123456789';
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOME: root, HOST: '127.0.0.1', PORT: '7171', ...registryEnv(registry),
  PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: `--audit ${audit} --hold-session delayed --burst-delay 10`,
  PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions, PIANO_TEST_SECRET: canary }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const proc of [server, frontend]) { proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d); }
const init = join(root, 'observe.js');
writeFileSync(init, `window.sent=[];window.received=[];window.closes=[];window.connections=0;
const NativeWebSocket=WebSocket;
window.WebSocket=class extends NativeWebSocket {
 constructor(...args){super(...args);if(this.url.endsWith('/ws')){window.control=this;connections++;this.addEventListener('close',e=>closes.push(e.code));}}
 set onmessage(handler){super.onmessage=e=>{
   if(!this.url.endsWith('/ws'))return handler(e);
   const m=JSON.parse(e.data); received.push(m); this.deliver=m=>handler(new MessageEvent('message',{data:JSON.stringify(m)}));
   if(window.paused)return;
   if(m._tag==='session'&&window.dropNext){window.dropNext=false;NativeWebSocket.prototype.send.call(this,JSON.stringify({_tag:'ack',deliveryId:m.deliveryId}));return;}
   handler(e);
   if(m._tag==='session'&&window.duplicate)handler(e);
 };}
 send(data){if(this.url.endsWith('/ws'))sent.push(JSON.parse(data));return super.send(data);}
};`);
const session = `phase5-${process.pid}`, commands = [], observations = [], sockets = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '20000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const records = () => readFileSync(audit, 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
const spawns = id => records().filter(r => r.event === 'spawn' && r.sessionId === id);
const status = word => ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent===${JSON.stringify(word)}`);
async function capture(name) { writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot')); await ab('screenshot', join(evidence, `${name}.png`)); observations.push(name); }
async function prompt(text) {
  await ab('mouse', 'move', '10', '10');
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast][data-visible="true"]')`);
  await ab('fill', '[aria-label="Message"]', text);
  await ab('press', 'Enter');
}
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(50); }
  throw new Error('fixture barrier deadline');
}
async function client(id) {
  const ws = new WebSocket('ws://127.0.0.1:7171/ws'); sockets.push(ws); const seen = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); seen.push(m); ws.send(JSON.stringify({ _tag: 'ack', deliveryId: m.deliveryId })); });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const selectionId = `public-${id}`;
  ws.send(JSON.stringify({ _tag: 'select', cwd, sessionId: id, selectionId }));
  await waitFor(() => seen.some(m => m._tag === 'selected'));
  return { ws, seen, selectionId };
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok && (await fetch('http://127.0.0.1:7171/api/projects')).ok) break; } catch {}
    if (n === 99) throw new Error('scratch startup timeout'); await delay(100);
  }
  const url = id => `http://127.0.0.1:7172/s/${id}`;
  await ab('--init-script', init, 'open', url('ordered-a')); await status('Not running');
  await prompt('/partial'); await ab('wait', '--text', 'Partial ordered-a');
  await ab('reload'); await ab('wait', '--text', 'Partial ordered-a');
  assert.equal(await evaluate(`sent.filter(m=>['prompt','steer'].includes(m.action?._tag)).length`), 0);
  assert.equal(await evaluate(`JSON.stringify(received).includes(${JSON.stringify(canary)})`), false);
  assert.equal(await evaluate(`received.filter(m=>m._tag==='selected'&&m.hosted).at(-1).snapshot.tools[0].status`), 'running');
  await capture('reload-mid-message-and-tool');
  await prompt('/dialog'); await ab('wait', '--text', 'Idle dialog');
  const deadline = await evaluate(`received.filter(m=>m._tag==='session'&&m.event._tag==='dialog').at(-1).event.dialog.deadlineAt`);
  await ab('reload'); await ab('wait', '--text', 'Idle dialog');
  assert.equal(await evaluate(`received.filter(m=>m._tag==='selected').at(-1).snapshot.dialogs[0].deadlineAt`), deadline);
  await capture('reload-mid-dialog');
  await ab('find', 'role', 'button', 'click', '--name', 'Cancel', '--exact');
  await ab('wait', '--fn', `!document.querySelector('dialog[open], [role="dialog"]')`);
  await evaluate('window.duplicate=true; true'); await prompt('/final'); await status('Ready');
  assert.equal(await evaluate(`document.querySelector('main').textContent.split('Final ordered-a').length-1`), 1);
  await capture('duplicate-final-frame-ignored');
  await evaluate('window.duplicate=false;window.dropNext=true;window.selectsBefore=sent.filter(m=>m._tag==="select").length;true');
  await prompt('/partial');
  await ab('wait', '--fn', `sent.filter(m=>m._tag==='select').length>selectsBefore&&received.filter(m=>m._tag==='selected').at(-1)?.snapshot.pending?.text.includes('Partial ordered-a')`);
  await ab('wait', '--text', 'Partial ordered-a'); await capture('gap-resnapshots-without-resubmission');
  assert.equal(records().filter(r => r.text === '/partial').length, 2);

  // Delayed public selection: get(A) is blocked by its server-owned startup lock.
  // B must become current before A's old lookup can return.
  const delayed = await client('delayed');
  delayed.ws.send(JSON.stringify({ _tag: 'act', selectionId: delayed.selectionId, action: { _tag: 'set_thinking_level', level: 'low' }, start: {} }));
  await waitFor(() => spawns('delayed').length === 1);
  await ab('find', 'role', 'button', 'click', '--name', 'delayed', '--exact');
  await ab('find', 'role', 'button', 'click', '--name', 'ordered-b', '--exact'); await ab('wait', '--text', 'Saved ordered-b');
  process.kill(spawns('delayed')[0].pid, 'SIGCONT');
  await waitFor(() => delayed.seen.some(m => m._tag === 'selected' && m.hosted));
  assert.equal(await evaluate('location.pathname'), '/s/ordered-b');
  await prompt('/partial'); await ab('wait', '--text', 'Partial ordered-b');
  // Inject a genuinely old selected answer, as if delayed below the server.
  await evaluate(`control.deliver({...received.find(m=>m._tag==='selected'&&m.sessionId==='ordered-a'),deliveryId:-1});true`);
  assert.equal(await evaluate('location.pathname'), '/s/ordered-b');
  assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Partial ordered-a')`), false);
  await evaluate(`control.send(JSON.stringify({_tag:'act',selectionId:'superseded',action:{_tag:'prompt',text:'WRONG_SESSION'},start:{}}));true`);
  await ab('wait', '--text', 'Selection changed; inspect the current session before acting.');
  assert.equal(records().some(r => r.text === 'WRONG_SESSION'), false);
  await capture('rapid-switch-late-selection-rejected');

  await ab('tab', 'new', '--label', 'slow', url('ordered-b')); await ab('wait', '--text', 'Partial ordered-b');
  await evaluate('window.paused=true;true');
  await ab('tab', 't1'); await prompt('/burst');
  await ab('wait', '--fn', `received.some(m=>m._tag==='session'&&m.event._tag==='notice'&&m.event.message==='burst complete')`);
  assert.equal(await evaluate(`closes.includes(1013)`), false, 'fast browser did not overflow');
  await capture('fast-tab-survives-bounded-burst');
  // Exit/restart while the other tab is behind. It must get the new incarnation.
  const oldB = spawns('ordered-b')[0]; process.kill(oldB.pid, 'SIGUSR1'); await status('Exited');
  await prompt('/partial'); await ab('wait', '--text', 'Partial ordered-b');
  await waitFor(() => spawns('ordered-b').length === 2);
  const generationB = await evaluate(`received.filter(m=>m._tag==='selected'&&m.sessionId==='ordered-b'&&m.hosted).at(-1).cursor.generation`);
  const generationsB = await evaluate(`received.filter(m=>m._tag==='selected'&&m.sessionId==='ordered-b'&&m.hosted).map(m=>m.cursor.generation)`);
  assert.notEqual(generationB, generationsB[0], 'restarted B has a new host generation');
  await ab('tab', 'slow');
  assert.equal(await evaluate('closes.includes(1013)'), true, 'slow client was explicitly disconnected');
  await evaluate('window.paused=false;control.close();true');
  await ab('wait', '--fn', `received.filter(m=>m._tag==='selected'&&m.hosted).at(-1)?.cursor.generation===${JSON.stringify(generationB)}`);
  await ab('wait', '--text', 'Partial ordered-b');
  assert.equal(await evaluate(`sent.filter(m=>['prompt','steer'].includes(m.action?._tag)||m._tag==='create_session').length`), 0);
  assert.equal(spawns('ordered-b').length, 2);
  await capture('slow-tab-resnapshot-after-exit-restart');
  assert.ok(!(await ab('errors')).includes('Error:'));
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'pass', observations, paidModelCalls: 0 }, null, 2));
  console.log('PASS: partial/dialog reload, duplicate/gap recovery, delayed A→B selection, bounded slow tab, fast subscriber, exit/restart resnapshot; no model calls');
} catch (error) {
  try { writeFileSync(join(evidence, 'failure.txt'), await ab('snapshot')); writeFileSync(join(evidence, 'failure-state.json'), await ab('eval', 'JSON.stringify({sent,received,closes,location:location.pathname})')); } catch {}
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'fail', error: String(error), observations }, null, 2)); console.error(error); process.exitCode = 1;
} finally {
  for (const ws of sockets) ws.close();
  try { await ab('close'); } catch {}
  for (const proc of [server, frontend]) if (proc.exitCode === null) proc.kill('SIGTERM');
  await Promise.all([server, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(r => proc.once('exit', r))));
  writeFileSync(join(evidence, 'browser-commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'server.log'), processLog);
  writeFileSync(join(evidence, 'host-audit.jsonl'), readFileSync(audit, 'utf8'));
  writeFileSync(join(evidence, 'environment.json'), JSON.stringify({ root, cwd, node: process.version, cli: resolve('test/fake-host-pi.mjs'), args: ['--mode', 'rpc', '--audit', audit, '--hold-session', 'delayed', '--burst-delay', '10'], sessionDir: sessions, modelCalls: 0 }, null, 2));
  const pids = [...new Set(records().map(r => r.pid))];
  assert.deepEqual(pids.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), [], 'owned fake children exit before cleanup');
  rmSync(root, { recursive: true, force: true });
}
