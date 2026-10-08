// Scratch-only browser observation of persisted Pi delegation facts. No paid model calls.
// node test/browser-delegation-cards.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-delegation-evidence');
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171';
const webPort = process.env.PIANO_TEST_WEB_PORT ?? '7172';
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-delegation-'));
for (const name of ['repo', 'sessions', 'agent', 'home', 'config']) mkdirSync(join(root, name));
const repo = join(root, 'repo');
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { env });
git('init', '-q', '-b', 'main');
writeFileSync(join(repo, 'README.md'), '# Delegation fixture\n');
git('add', '.'); git('commit', '-qm', 'Initial fixture');
const timestamp = new Date().toISOString();
const messages = [{ role: 'user', content: 'Review the change and follow up on the findings.' }];
const assistant = content => ({ role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'alpha', stopReason: 'stop', content });
const text = value => [{ type: 'text', text: value }];
function operation(id, name, args, details, output) {
  messages.push(assistant([{ type: 'toolCall', id, name, arguments: args }]));
  messages.push({ role: 'toolResult', toolCallId: id, toolName: name, content: text(output), details, isError: false });
}
function start(id, runId, subagentId, description) {
  operation(id, 'agent_start', { agent: 'reviewer', description, prompt: 'Review this synthetic fixture only.' },
    { kind: 'start', rowPhrase: 'Started', tone: 'toolTitle', agent: 'reviewer', runId, subagentId }, `Started reviewer: ${runId}`);
}
start('call-notice', 'run-notice', 'subagent-review', 'Review notification');
messages.push({ role: 'custom', customType: 'subagent-notification', display: true,
  content: 'Notification answer: the fixture has no findings.',
  details: { runId: 'run-notice', subagentId: 'subagent-review', agent: 'reviewer', label: 'Review notification', status: 'completed', durationMillis: 1200 } });
operation('call-resume', 'agent_resume', { id: 'subagent-review', description: 'Review follow-up', prompt: 'Check the follow-up.' },
  { kind: 'resume', rowPhrase: 'Resumed', tone: 'toolTitle', subagentId: 'subagent-review', runId: 'run-followup' }, 'Resumed subagent-review: run-followup');
operation('call-wait', 'agent_wait', { ids: ['run-followup'], timeoutSeconds: 10 },
  { kind: 'collection', scope: 'named', runs: [{ runId: 'run-followup', agent: 'reviewer', status: 'failed' }], stillRunning: 0, unknown: 0, unavailable: 0, noActiveRuns: false },
  'Wait answer: the follow-up failed with partial work retained.');
start('call-open', 'run-open', 'subagent-open', 'Review pending cancellation');
operation('call-mixed-wait', 'agent_wait_all', {},
  { kind: 'collection', scope: 'all-active', runs: [{ runId: 'run-notice', agent: 'reviewer', status: 'completed' }], stillRunning: 1, unknown: 0, unavailable: 0, noActiveRuns: false },
  'One answer delivered; another Run has not finished.');
operation('call-cancel', 'agent_cancel', { ids: ['run-open'] }, { kind: 'cancel', outcomes: [{ kind: 'requested', runId: 'run-open' }] }, 'Cancellation requested, not settled.');
operation('call-malformed', 'agent_start', { agent: 'reviewer', description: 'Legacy delegation', prompt: 'Legacy shape.' },
  { kind: 'start', runId: 123, subagentId: false }, 'Readable malformed-details fallback.');
messages.push(assistant(text('Delegation fixture ready.')));
const sessionFile = join(root, 'sessions', 'delegations.jsonl');
const entries = [{ type: 'session', version: 3, id: 'delegations', cwd: repo, timestamp }, ...messages.map((message, index) => ({
  type: 'message', id: `m${index}`, parentId: index ? `m${index - 1}` : null, timestamp, message: { ...message, timestamp: index },
}))];
writeFileSync(sessionFile, entries.map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [
  { cwd: repo, sessionId: 'delegations', title: 'Delegation cards', createdAt: timestamp, updatedAt: timestamp, archived: false },
] }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: backendPort,
  PIANO_CONFIG: join(root, 'registry.json'), PIANO_PI_CLI: resolve('test/fake-delegation-pi.mjs'), PIANO_PI_ARGS: '',
  PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', webPort, '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const child of [backend, frontend]) {
  child.stdout.on('data', data => processLog += data);
  child.stderr.on('data', data => processLog += data);
}
const session = `delegation-${process.pid}`, commands = [], observations = [];
async function ab(...args) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '15000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    const timer = setTimeout(() => child.kill('SIGTERM'), 25000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', status => { clearTimeout(timer); resolveResult({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async source => JSON.parse(await ab('eval', source));
async function capture(name) {
  await ab('screenshot', join(evidence, `${name}.png`));
  writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot'));
}
async function assertDotAlignment(stage) {
  const rows = await evaluate(`Array.from(document.querySelectorAll('[data-slot="delegation-card"], [data-slot="subagent-result-card"], [aria-label="agent_start tool call"]')).map(group => {
    const dot = group.querySelector('span[aria-hidden="true"] > span');
    const trigger = group.querySelector('button[aria-expanded]');
    const d = dot.getBoundingClientRect(), t = trigger.getBoundingClientRect();
    return { label: group.getAttribute('aria-label'), offset: (d.top + d.height / 2) - (t.top + t.height / 2) };
  })`);
  observations.push({ stage, alignment: rows });
  assert.ok(rows.length >= 6, 'measure delegation, result, control and ordinary tool rows');
  for (const row of rows) assert.ok(Math.abs(row.offset) <= 1, `${stage}: ${row.label} dot is ${row.offset}px from its trigger centre`);
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(backend.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/projects`)).ok && (await fetch(`http://127.0.0.1:${webPort}`)).ok) break; } catch {}
    if (attempt === 99) throw new Error('Scratch startup deadline');
    await delay(100);
  }
  await ab('set', 'viewport', '1440', '1100');
  await ab('open', `http://127.0.0.1:${webPort}/s/delegations`);
  await ab('wait', '--text', 'Delegation fixture ready.');
  observations.push({ stage: 'loaded', transcript: await evaluate(`document.querySelector('[data-slot="transcript"]').innerText`) });
  await capture('loaded');
  await assertDotAlignment('desktop-collapsed');
  const card = (slot, run) => `[data-slot="${slot}"][data-run-id="${run}"]`;
  const delegation = run => card('delegation-card', run);
  const resultCard = run => card('subagent-result-card', run);
  async function cardText(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText`); }
  const done = await cardText(delegation('run-notice'));
  const failed = await cardText(delegation('run-followup'));
  const pending = await cardText(delegation('run-open'));
  assert.match(done, /Review notification/); assert.match(done, /Completed/);
  assert.match(failed, /Review follow-up/); assert.match(failed, /Failed/);
  assert.match(pending, /Started/); assert.doesNotMatch(pending, /Completed|Cancelled|Running/);
  const initial = await evaluate(`[...document.querySelectorAll('[data-slot="delegation-card"]')].map(e => ({run: e.dataset.runId, text: e.innerText}))`);
  assert.equal(initial.length, 3, 'malformed details retain the generic fallback, not a fabricated delegation');
  assert.match(await cardText(resultCard('run-notice')), /Review notification/);
  assert.match(await cardText(resultCard('run-followup')), /Review follow-up/);
  const mixedWait = await cardText('[aria-label="Subagent result: Subagent results"]');
  assert.match(mixedWait, /1 still running when checked/);
  assert.doesNotMatch(mixedWait, /Completed/);
  assert.equal(await evaluate(`document.body.innerText.includes('Notification answer:')`), false, 'output stays collapsed');
  await ab('click', `${resultCard('run-notice')} button`);
  await ab('wait', '--text', 'Notification answer: the fixture has no findings.');
  assert.match(await cardText(resultCard('run-notice')), /subagent-review/);
  await ab('click', `${resultCard('run-followup')} button`);
  await ab('wait', '--text', 'Wait answer: the follow-up failed with partial work retained.');
  assert.match(await cardText(resultCard('run-followup')), /subagent-review/);
  await ab('click', '[aria-label="Subagent operation: Subagent cancellation"] button');
  await ab('wait', '--text', 'Cancellation requested, not settled.');
  await ab('click', '[aria-label="agent_start tool call"] button');
  await ab('wait', '--text', 'Readable malformed-details fallback.');
  observations.push({ stage: 'correlated-history', initial, done, failed, pending, mixedWait });
  await capture('expanded');
  await assertDotAlignment('desktop-expanded');
  await ab('reload'); await ab('wait', '--text', 'Delegation fixture ready.');
  assert.match(await cardText(delegation('run-followup')), /Failed/);
  assert.match(await cardText(delegation('run-open')), /Started/);
  await ab('set', 'viewport', '390', '844');
  await capture('mobile');
  await assertDotAlignment('mobile-collapsed');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'no horizontal page overflow');
  await ab('set', 'viewport', '1440', '1100');
  await ab('fill', 'textarea', '/delegation-live');
  await ab('press', 'Enter');
  await ab('wait', `${resultCard('run-live')}`);
  assert.match(await cardText(delegation('run-live')), /Cancelled/);
  assert.match(await cardText(resultCard('run-live')), /Cancelled/);
  await ab('click', `${resultCard('run-live')} button`);
  await ab('wait', '--text', 'Live result');
  observations.push({ stage: 'live-result', text: await cardText(resultCard('run-live')) });
  await capture('live');
  await ab('reload'); await ab('wait', resultCard('run-live'));
  assert.match(await cardText(delegation('run-live')), /Cancelled/);
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(resultCard('run-live'))}).length`), 1, 'reload does not duplicate the result');
  assert.equal(await ab('errors'), '');
  console.log('PASS: delegation/result correlation, disclosure, cancellation admission, malformed fallback, live events, reload and mobile layout');
} finally {
  try { await ab('close'); } catch {}
  for (const child of [backend, frontend]) if (child.exitCode === null) {
    const stopped = new Promise(resolveExit => child.once('exit', resolveExit)); child.kill('SIGTERM'); await stopped;
  }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
