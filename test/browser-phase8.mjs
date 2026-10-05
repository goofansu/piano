// Phase 8 scratch-only browser gate; no model calls, no user's registry/services.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase8-evidence/browser'); mkdirSync(evidence, { recursive: true });
const configOnly = process.argv.includes('--config-only');
const root = mkdtempSync(join(tmpdir(), 'piano-browser-phase8-')), repo = join(root, 'repo'), checkout = join(root, 'checkout'), registry = join(root, 'registry.json');
for (const path of [repo, join(root, 'home'), join(root, 'agent'), join(root, 'sessions')]) mkdirSync(path, { recursive: true });
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(repo, 'init', '-q', '-b', 'main'); writeFileSync(join(repo, 'source.txt'), 'GOOD\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
git(repo, 'worktree', 'add', '-b', 'second', checkout); writeFileSync(join(checkout, 'source.txt'), 'WORKSPACE_B\n');
writeFileSync(registry, JSON.stringify({ projects: [repo], worktrees: [{ project: repo, path: checkout, branch: 'second' }], sessions: [
  { cwd: repo, sessionId: 'check-a', title: 'Session A', createdAt: '2026-10-05', updatedAt: '2026-10-05', archived: false },
  { cwd: checkout, sessionId: 'check-b', title: 'Session B', createdAt: '2026-10-05', updatedAt: '2026-10-05', archived: false },
] }));
let policy = { id: 'source-check', name: 'Source contract', version: '1', timeoutMs: 10000,
  task: { id: 'TASK-8', source: 'human:phase8-browser', version: '1', content: 'Preserve a good source file' },
  criterion: { id: 'AC-1', version: '1', content: 'source.txt contains GOOD' },
  script: "import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; assert.equal(readFileSync('source.txt','utf8'),'GOOD\\n'); console.log('CHECK_GOOD');" };
const configure = change => { policy = { ...policy, ...change }; writeFileSync(join(root, 'checks.json'), JSON.stringify({ version: 1, projects: [{ project: repo, check: policy }] })); };
if (!configOnly) configure({});
let processLog = '';
function logProcess(p) { const log = d => { processLog += d; writeFileSync(join(evidence, 'process.log'), processLog); }; p.stdout.on('data', log); p.stderr.on('data', log); return p; }
function startBackend() { return logProcess(spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry,
  PIANO_PI_CLI: resolve('test/fake-pi.mjs'), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] })); }
let server = startBackend();
const frontend = logProcess(spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] }));
const session = `phase8-${process.pid}`, commands = [], observations = [];
async function ab(...args) {
  const result = await new Promise((accept, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '20000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('exit', status => { clearTimeout(timer); accept({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result }); writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`); return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const click = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
const observed = () => ab('wait', '--fn', `document.querySelector('[role="dialog"] [role="status"]')?.textContent.startsWith('Observed')`);
async function openChecks() { await click('Session menu'); await ab('find', 'role', 'menuitem', 'click', '--name', 'Checks', '--exact'); await observed(); }
async function capture(name) { writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot')); await ab('screenshot', join(evidence, `${name}.png`)); observations.push(name); }
const firstId = () => evaluate(`document.querySelector('[data-execution]')?.dataset.execution`);
const waitResult = (outcome, validity) => ab('wait', '--fn', `document.querySelector('[data-execution]')?.dataset.outcome===${JSON.stringify(outcome)} && document.querySelector('[data-execution]')?.dataset.validity===${JSON.stringify(validity)}`);
const records = () => readdirSync(`${registry}.evidence`).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(`${registry}.evidence`, f), 'utf8')));
async function ready() {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172', { signal: AbortSignal.timeout(2000) })).ok && (await fetch('http://127.0.0.1:7171/api/projects', { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('scratch startup deadline');
}
try {
  await ready(); await ab('open', 'http://127.0.0.1:7172/s/check-a'); await ab('wait', '--text', 'Session A'); await openChecks();
  if (configOnly) {
    await ab('wait', '--text', 'No check configured.');
    const empty = await evaluate(`document.querySelector('[role="dialog"]').textContent`);
    assert.ok(empty.includes(join(root, 'checks.json')));
    assert.ok(!empty.includes('registry.json.checks.json'));
    assert.equal(await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Run check')?.disabled`), true);
    await capture('missing-config-clean-name');
    configure({}); await click('Refresh evidence'); await ab('wait', '--text', 'Source contract');
    await click('Run check'); await waitResult('pass', 'current');
    await capture('checks-json-configured');
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, node: process.version }, null, 2));
    console.log('PASS: clean default configuration path, configuration reread without restart, and a passing configured check');
  } else {
  if (!process.argv.includes('--restart-only')) {
  await ab('wait', '--text', 'No check executions yet.'); await click('Run check'); await waitResult('pass', 'current');
  const passed = await firstId();
  await ab('click', '[data-execution] > details > summary'); await ab('wait', '--text', 'CHECK_GOOD');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(repo)})`), true);
  await capture('pass-output-revision');
  writeFileSync(join(repo, 'source.txt'), 'BAD\n'); await waitResult('pass', 'stale'); await capture('edit-stales-historical-pass');
  await click('Run check'); await waitResult('fail', 'current'); await capture('rerun-fails-criterion');
  writeFileSync(join(repo, 'source.txt'), 'GOOD\n'); await click('Run check'); await waitResult('pass', 'current');
  const latest = await firstId();
  rmSync(join(`${registry}.evidence`, `${latest}.output.txt`)); await waitResult('pass', 'unknown'); await ab('wait', '--text', 'Output unavailable'); await capture('missing-artifact-not-green');
  configure({ criterion: { ...policy.criterion, version: '2', content: 'Reviewed requirement version two' } }); await click('Refresh evidence');
  await ab('wait', '--fn', `document.querySelector('[data-execution="${passed}"]')?.dataset.validity==='stale'`); await capture('requirement-change');
  await click('Close'); await ab('click', 'button[title="Session B"]'); await openChecks(); await ab('wait', '--text', 'No check executions yet.');
  await click('Run check'); await waitResult('fail', 'current');
  assert.equal(await evaluate(`document.querySelectorAll('[data-execution]').length`), 1);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(checkout)})`), true); await capture('workspace-b-separate-evidence');
  await click('Close'); await ab('click', 'button[title="Session A"]'); await openChecks();
  configure({ timeoutMs: 300000, script: "console.log('WAITING'); await new Promise(() => { setInterval(() => {}, 1000); });" });
  await click('Run check'); await waitResult('running', 'unknown'); const running = await firstId(), count = records().length;
  await click('Close'); await ab('reload'); await ab('wait', '--text', 'Session A');
  // Reload must show cancellation rather than a new start; open without waiting for Run check.
  await click('Session menu'); await ab('find', 'role', 'menuitem', 'click', '--name', 'Checks', '--exact');
  await observed(); await click('Cancel check'); await waitResult('cancelled', 'unknown'); assert.equal(await firstId(), running); assert.equal(records().length, count); await capture('reload-no-duplicate-cancel');
  }
  configure({ timeoutMs: 300000, script: "console.log('WAITING'); await new Promise(() => { setInterval(() => {}, 1000); });" });
  await click('Run check'); await waitResult('running', 'unknown'); const interrupted = await firstId(), beforeRestart = records().length;
  // Wait for the actual isolation child, not an arbitrary sleep, before hard exit.
  let pids = [];
  for (let n = 0; n < 100; n++) {
    const processes = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).trim().split('\n').map(line => {
      const [, pid, parent, command] = /^\s*(\d+)\s+(\d+)\s+([\s\S]*)$/.exec(line); return { pid: Number(pid), parent: Number(parent), command };
    });
    const owned = new Set(processes.filter(p => p.parent === server.pid && p.command.includes('bwrap --unshare-all')).map(p => p.pid));
    for (let level = 0; level < 8; level++) for (const p of processes) if (owned.has(p.parent)) owned.add(p.pid);
    if (processes.some(p => owned.has(p.pid) && p.command === '/runtime/node /check.mjs')) { pids = [...owned]; break; }
    await delay(50);
  }
  assert.ok(pids.length, 'a real isolated Node command and its supervision processes are running');
  const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGKILL'); await exited;
  server = startBackend(); await ready();
  // Older session projections remount the inspector on reconnect; newer ones
  // retain it. Either way inspect the same execution without starting work.
  await ab('wait', '--fn', `document.querySelector('[data-execution]')?.dataset.outcome==='unknown' || (!document.querySelector('[role="dialog"]') && !!document.querySelector('main header [aria-label="Session menu"]'))`);
  if (!(await evaluate(`!!document.querySelector('[role="dialog"]')`))) await openChecks();
  await waitResult('unknown', 'unknown'); assert.equal(await firstId(), interrupted); assert.equal(records().length, beforeRestart);
  assert.match(records().find(r => r.id === interrupted).detail, /not resumed/); await ab('wait', '--text', 'not resumed');
  for (const pid of pids) {
    try { assert.match(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1], /^[ZX]/, 'old isolation process is not live'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  await capture('backend-loss-not-resumed');
  await ab('set', 'viewport', '390', '844'); assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true); await capture('mobile-evidence');
  await click('Close'); assert.equal(await evaluate(`document.querySelector('main header [role="status"]').textContent`), 'Not running', 'check outcomes never settle/start the Pi session');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, executions: records(), node: process.version, root }, null, 2));
  console.log(`PASS: ${observations.join(', ')}`);
  }
} catch (error) {
  try { await capture('failure-state'); writeFileSync(join(evidence, 'failure-records.json'), JSON.stringify(records(), null, 2)); } catch {}
  throw error;
} finally {
  try { await ab('close'); } catch {}
  for (const p of [server, frontend]) if (p.exitCode === null && p.signalCode === null) { const ended = new Promise(resolve => p.once('exit', resolve)); p.kill('SIGTERM'); await ended; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); writeFileSync(join(evidence, 'process.log'), processLog);
  git(repo, 'worktree', 'remove', '--force', checkout); git(repo, 'branch', '-D', 'second'); rmSync(root, { recursive: true, force: true });
}
