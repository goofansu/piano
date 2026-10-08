// INV-01/03: editing uses Pi's cleared queue, not a copy of a stale browser list.
// node test/browser-queue-edit.mjs /tmp/piano-queue-edit-evidence
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-queue-edit-evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-queue-edit-'));
const cwd = join(root, 'project');
mkdirSync(cwd);
spawnSync('git', ['init', '-q', cwd]);
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [cwd], worktrees: [], sessions: [] }));
// Hold the fake run open without covering the composer with a dialog.
writeFileSync(join(root, 'fake.mjs'), readFileSync('test/fake-pi.mjs', 'utf8').replace(
  'out({ type: "extension_ui_request", id: "live1", method: "input", title: "Running after response" });',
  '// Remain running until the browser explicitly stops.'
));
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171';
const webPort = process.env.PIANO_TEST_WEB_PORT ?? '7172';
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env,
  HOST: '127.0.0.1', PORT: backendPort, PIANO_CONFIG: join(root, 'registry.json'),
  PIANO_PI_CLI: join(root, 'fake.mjs'), PIANO_PI_ARGS: '',
  PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
}, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', webPort, '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [backend, frontend]) {
  proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d);
}
const session = `queue-edit-${process.pid}`, commands = [];
function ab(...args) {
  const result = spawnSync('npx', ['agent-browser', '--session', session, ...args], { encoding: 'utf8', timeout: 45000 });
  commands.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = js => JSON.parse(ab('eval', js));
async function until(js) {
  for (let n = 0; n < 30; n++) { if (evaluate(js)) return; await delay(100); }
  throw new Error(`Timed out: ${js}`);
}
const input = '[aria-label="Message"]';
const text = 'Is “new session here” or “new session from here” natural English?';
const queue = '[aria-label="Queued messages"]';
function capture(name) {
  ab('screenshot', join(evidence, `${name}.png`));
  writeFileSync(join(evidence, `${name}.txt`), ab('snapshot'));
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/projects`)).ok && (await fetch(`http://127.0.0.1:${webPort}`)).ok) break; } catch {}
    if (n === 99) throw new Error('Scratch startup deadline'); await delay(100);
  }
  ab('set', 'device', 'iPhone 16');
  ab('open', `http://127.0.0.1:${webPort}/new`);
  ab('fill', '[aria-label="First message"]', 'live context');
  ab('click', '[aria-label="Send"]');
  ab('wait', '[aria-label="Stop"]');
  ab('fill', input, text); ab('click', '[aria-label="steer"]');
  ab('wait', '[aria-label="Edit queued message"]');
  for (const width of [320, 390, 1280]) {
    ab('set', 'viewport', String(width), '844');
    const geometry = evaluate(`(() => {
      const q=document.querySelector('${queue}'), row=q.querySelector('li');
      const label=row.firstElementChild.getBoundingClientRect(), text=row.lastElementChild.getBoundingClientRect();
      const edit=q.querySelector('button').getBoundingClientRect();
      return { labelHeight:label.height, labelBottom:label.bottom, textTop:text.top,
        editHeight:edit.height, overflow:q.scrollWidth>q.clientWidth, pageOverflow:document.documentElement.scrollWidth>innerWidth };
    })()`);
    writeFileSync(join(evidence, `geometry-${width}.json`), JSON.stringify(geometry, null, 2));
    assert.ok(geometry.labelHeight < 24 && geometry.labelBottom <= geometry.textTop, 'compact label above text');
    assert.ok(!geometry.overflow && !geometry.pageOverflow, 'queue fits viewport');
    if (width < 768) assert.ok(geometry.editHeight >= 44, 'phone edit target');
    capture(`queued-${width}`);
  }
  ab('set', 'viewport', '390', '844');
  ab('click', '[aria-label="Edit queued message"]');
  await until(`document.querySelector('${input}').value === ${JSON.stringify(text)} && !document.querySelector('${queue}')`);
  assert.ok(evaluate(`document.activeElement.matches('${input}')`), 'editing focuses the composer');
  assert.ok(evaluate(`!!document.querySelector('[aria-label="Delivery: steer"]')`), 'editing does not stop Pi');
  capture('editing');
  ab('fill', input, 'Revised message'); ab('click', '[aria-label="steer"]');
  ab('wait', '[aria-label="Edit queued message"]');
  ab('click', '[aria-label="Delivery: steer"]');
  capture('delivery-menu');
  ab('find', 'role', 'menuitemradio', 'click', '--name', 'follow-up Alt Enter Add work after the current task.');
  ab('fill', input, 'Second message'); ab('click', '[aria-label="follow-up"]');
  ab('wait', '[aria-label="Edit all queued messages"]');
  ab('fill', input, 'Keep my draft');
  capture('edit-all');
  ab('click', '[aria-label="Edit all queued messages"]');
  await until(`document.querySelector('${input}').value === 'Keep my draft\\n\\nRevised message\\n\\nSecond message' && !document.querySelector('${queue}')`);
  assert.ok(evaluate(`!!document.querySelector('[aria-label="Delivery: follow-up"]')`), 'mixed queue restoration keeps the run active');
  // Requeue, then stop: the same edit affordance must work for paused queues.
  ab('fill', input, 'Paused message'); ab('click', '[aria-label="follow-up"]');
  ab('wait', '[aria-label="Stop"]'); ab('click', '[aria-label="Stop"]');
  ab('wait', '--text', 'Paused queue');
  ab('click', '[aria-label="Edit queued message"]');
  await until(`document.querySelector('${input}').value === 'Paused message' && !document.querySelector('${queue}')`);
  ab('wait', '[aria-label="Send"]');
  capture('paused-edit');
  // Esc from the composer returns queued messages to the draft first; only the next press stops Pi.
  ab('fill', input, 'live context'); ab('click', '[aria-label="Send"]'); ab('wait', '[aria-label="Stop"]');
  ab('fill', input, 'Esc message'); ab('click', '[aria-label="follow-up"]');
  ab('wait', '[aria-label="Edit queued message"]');
  ab('click', input); ab('press', 'Escape');
  await until(`document.querySelector('${input}').value === 'Esc message' && !document.querySelector('${queue}')`);
  assert.ok(evaluate(`!!document.querySelector('[aria-label="Delivery: follow-up"]')`), 'Esc with a queue edits without stopping Pi');
  assert.ok(evaluate(`document.activeElement.matches('${input}')`), 'Esc keeps the composer focused');
  capture('esc-edit');
  ab('fill', input, ''); ab('press', 'Escape');
  ab('wait', '[aria-label="Send"]');
  assert.equal(evaluate(`!!document.querySelector('${queue}')`), false, 'Esc without a queue stops Pi');
  // A paused queue is edited by Esc as well.
  ab('fill', input, 'live context'); ab('click', '[aria-label="Send"]'); ab('wait', '[aria-label="Stop"]');
  ab('fill', input, 'Paused esc'); ab('click', '[aria-label="follow-up"]');
  ab('wait', '[aria-label="Edit queued message"]'); ab('click', '[aria-label="Stop"]');
  ab('wait', '--text', 'Paused queue');
  ab('click', input); ab('press', 'Escape');
  await until(`document.querySelector('${input}').value === 'Paused esc' && !document.querySelector('${queue}')`);
  capture('esc-paused-edit');
  console.log('PASS: compact queue labels; edit while running; resend; edit all preserves draft and mixed queue; paused edit; Esc edits before stopping');
} finally {
  try { ab('close'); } catch {}
  backend.kill('SIGTERM'); frontend.kill('SIGTERM');
  await Promise.all([backend, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(done => proc.once('exit', done))));
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'processes.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
