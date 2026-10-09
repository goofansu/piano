// Scratch-only provider-error verification. Fake Pi history; no model calls.
// node test/browser-message-errors.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '.scratch/message-errors-browser');
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171';
const webPort = process.env.PIANO_TEST_WEB_PORT ?? '7172';
// Fail before launching anything if another agent owns either port.
for (const port of [backendPort, webPort]) await new Promise((resolve, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(Number(port), '127.0.0.1', () => server.close(resolve));
});
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-message-errors-'));
const repo = join(root, 'repo'), sessions = join(root, 'sessions');
for (const path of [repo, sessions, join(root, 'agent'), join(root, 'home'), join(root, 'config')]) mkdirSync(path);
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { env });
git('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'app.ts'), 'export const fixture = true;\n'); git('add', '.'); git('commit', '-qm', 'Fixture');
const timestamp = new Date().toISOString();
const raw = 'OpenAI Codex API error (429): ' + JSON.stringify({ error: { type: 'usage_limit_reached', message: 'You have hit your usage limit. Try again later.', plan_type: 'pro', resets_at: 1893456000, diagnostic: 'fixture-diagnostic-' + 'x'.repeat(500) }, request_id: 'fixture-request-429' });
const assistant = (content = [], extra = {}) => ({ role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'alpha', stopReason: 'stop', content, ...extra });
const user = content => ({ role: 'user', content });
const call = id => assistant([{ type: 'toolCall', id, name: 'bash', arguments: { command: `echo ${id}` } }], { stopReason: 'toolUse' });
const failed = id => ({ role: 'toolResult', toolCallId: id, toolName: 'bash', isError: true, content: [{ type: 'text', text: 'Command aborted' }] });
const messages = [
  user('Provider limit case'),
  assistant([{ type: 'text', text: 'Partial answer before provider failure.' }], { stopReason: 'error', errorMessage: raw }),
  user('Duplicate cancellation case'), call('duplicate-tool'), failed('duplicate-tool'),
  assistant([], { stopReason: 'aborted', errorMessage: 'This operation was aborted' }),
  user('Standalone cancellation case'), assistant([], { stopReason: 'aborted', errorMessage: 'This operation was aborted' }),
  user('Unrelated provider failure case'), call('unrelated-tool'), failed('unrelated-tool'),
  assistant([], { stopReason: 'error', errorMessage: '503 Service unavailable: upstream API failure' }),
];
const entries = [{ type: 'session', version: 3, id: 'message-errors', cwd: repo, timestamp }, ...messages.map((message, n) => ({
  type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null, timestamp, message: { ...message, timestamp: n },
}))];
writeFileSync(join(sessions, 'message-errors.jsonl'), entries.map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [
  { cwd: repo, sessionId: 'message-errors', title: 'Message errors', createdAt: timestamp, updatedAt: timestamp, archived: false },
] }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: backendPort,
  ...registryEnv(join(root, 'registry.json')), PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: '',
  PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', webPort, '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [backend, frontend]) { proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d); }
const session = `message-errors-${process.pid}`, commands = [], observations = [], failures = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '15000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; proc.stdout.on('data', d => stdout += d); proc.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => proc.kill('SIGTERM'), 25000);
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result }); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
function check(condition, message) { if (!condition) failures.push(message); }
async function capture(name) {
  await ab('screenshot', join(evidence, `${name}.png`));
  writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot'));
}
async function layout(name) {
  const result = await evaluate(`(() => {
    const transcript = document.querySelector('[data-slot="transcript"]');
    return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      transcriptWidth: transcript.clientWidth, transcriptScrollWidth: transcript.scrollWidth,
      alerts: [...transcript.querySelectorAll('[role="alert"]')].map(a => ({ text: a.innerText, nested: !!a.closest('article'), marginLeft: getComputedStyle(a).marginLeft, left: a.getBoundingClientRect().left, right: a.getBoundingClientRect().right, width: a.clientWidth, scrollWidth: a.scrollWidth })) };
  })()`);
  observations.push({ name, ...result });
  check(result.pageWidth <= result.viewport, `${name}: page does not overflow`);
  check(result.transcriptScrollWidth <= result.transcriptWidth + 1, `${name}: transcript does not overflow`);
  for (const alert of result.alerts) {
    check(!alert.nested, `${name}: Alert is separate from assistant article`);
    check(alert.marginLeft === '0px', `${name}: Alert is not inset`);
    check(alert.left >= 0 && alert.right <= result.viewport + 1 && alert.scrollWidth <= alert.width + 1, `${name}: Alert stays within viewport`);
  }
}
try {
  writeFileSync(join(evidence, 'revision.txt'), execFileSync('git', ['rev-parse', 'HEAD']).toString() + execFileSync('git', ['status', '--short']).toString());
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/projects`)).ok && (await fetch(`http://127.0.0.1:${webPort}`)).ok) break; } catch {}
    if (n === 99) throw new Error('Scratch startup deadline'); await delay(100);
  }
  await ab('set', 'viewport', '1440', '1100');
  await ab('open', `http://127.0.0.1:${webPort}/s/message-errors`);
  await ab('wait', '--text', 'Unrelated provider failure case');
  const closed = await evaluate(`(() => { const t = document.querySelector('[data-slot="transcript"]'); return { text: t.innerText, alerts: [...t.querySelectorAll('[role="alert"]')].map(a => a.innerText) }; })()`);
  observations.push({ name: 'closed', ...closed });
  check(closed.alerts.length === 3, 'Exactly three errors remain: provider, standalone abort, unrelated API error');
  check(closed.alerts.filter(t => /abort/i.test(t)).length === 1, 'Duplicate assistant cancellation is hidden; standalone cancellation remains');
  check(closed.alerts.some(t => /usage limit/i.test(t)), 'Provider error has readable usage-limit summary');
  check(closed.alerts.some(t => /upstream API failure/i.test(t)), 'Unrelated API failure after failed tool remains');
  check(!closed.text.includes('fixture-request-429') && !closed.text.includes('usage_limit_reached') && !closed.text.includes('fixture-diagnostic-'), 'Raw provider diagnostics are folded by default');
  check(closed.text.includes('Partial answer before provider failure.'), 'Partial assistant prose remains');
  for (const width of [1440, 390]) {
    await ab('set', 'viewport', String(width), '1100');
    await ab('eval', `document.querySelector('[data-slot="transcript"]').scrollTop = 0`);
    await layout(`collapsed-${width}`); await capture(`collapsed-${width}`);
  }
  await ab('set', 'viewport', '1440', '1100');
  const disclosure = '[data-slot="transcript"] button[aria-expanded]';
  const count = await evaluate(`[...document.querySelectorAll('${disclosure}')].filter(b => b.textContent.includes('Error details')).length`);
  check(count > 0, 'Provider error offers diagnostic disclosure');
  if (count > 0) {
    await ab('find', 'role', 'button', 'click', '--name', 'Error details', '--exact');
    const opened = await evaluate(`(() => { const b = [...document.querySelectorAll('${disclosure}')].find(b => b.textContent.includes('Error details')); return { text: document.querySelector('[data-slot="transcript"]').innerText, expanded: b.getAttribute('aria-expanded') }; })()`);
    observations.push({ name: 'diagnostics-open', ...opened });
    check(opened.expanded === 'true' && opened.text.includes(raw), 'Disclosure reveals complete original provider diagnostics');
    for (const width of [1440, 390]) {
      await ab('set', 'viewport', String(width), '1100');
      await ab('eval', `document.querySelector('[data-slot="transcript"]').scrollTop = 0`);
      await layout(`expanded-${width}`); await capture(`expanded-${width}`);
    }
    await ab('find', 'role', 'button', 'click', '--name', 'Error details', '--exact');
    await ab('wait', '--fn', `!document.querySelector('[data-slot="transcript"]').innerText.includes('fixture-request-429')`);
    check(!(await evaluate(`document.querySelector('[data-slot="transcript"]').innerText`)).includes('fixture-request-429'), 'Diagnostics collapse again');
  }
  // Tool failure remains available independently of suppressed assistant error.
  await ab('find', 'role', 'button', 'click', '--name', 'echo duplicate-tool');
  check((await evaluate(`document.querySelector('[data-slot="transcript"]').innerText`)).includes('Command aborted'), 'Tool retains Command aborted detail');
  await capture('tool-aborted');
  check((await ab('errors')) === '', 'No browser errors');
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log('PASS: concise standalone provider errors, on-demand raw diagnostics, duplicate abort suppression, and desktop/mobile containment');
} finally {
  try { await ab('close'); } catch {}
  for (const proc of [backend, frontend]) if (proc.exitCode === null) { const stopped = new Promise(resolve => proc.once('exit', resolve)); proc.kill('SIGTERM'); await stopped; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'observations.json'), JSON.stringify({ observations, failures }, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
