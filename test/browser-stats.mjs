// Scratch-only persisted-statistics journey: fake Pi, no credentials or model calls.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-stats-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-browser-stats-'));
const repo = join(root, 'repo'), registry = join(root, 'registry.json'), statsFile = join(root, 'stats.json'), audit = join(root, 'audit.jsonl');
for (const name of ['repo', 'home', 'agent', 'sessions']) mkdirSync(join(root, name));
execFileSync('git', ['init', '--quiet', repo]);
const env = { ...process.env, HOME: join(root, 'home'), HOST: '127.0.0.1', PORT: '7171',
  PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions') };
const baseArgs = `--audit ${audit} --stats-file ${statsFile}`;
writeFileSync(statsFile, JSON.stringify({ cost: 1.23, tokens: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, total: 150 }, contextUsage: { tokens: 50, contextWindow: 1000, percent: 5 } }));
writeFileSync(registry, JSON.stringify({ folders: [repo], worktrees: [], sessions: ['cached', 'unknown'].map(sessionId => ({
  cwd: repo, sessionId, title: sessionId, archived: false, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z',
})) }));
let processLog = '';
const track = p => { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); return p; };
const startServer = (args = '') => track(spawn(process.execPath, ['server/main.ts'], { env: { ...env, ...registryEnv(registry), PIANO_PI_ARGS: `${baseArgs} ${args}` }, stdio: ['ignore', 'pipe', 'pipe'] }));
let server = startServer();
const frontend = track(spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'],
}));
const stop = async p => { if (p.exitCode === null) { const done = new Promise(resolve => p.once('exit', resolve)); p.kill('SIGTERM'); await done; } };
const session = `stats-${process.pid}`, commands = [], observations = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '15000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill('SIGTERM'), 25000);
    child.on('error', reject); child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result }); assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`); return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const click = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
const info = () => evaluate(`(() => {
  const text = document.querySelector('[aria-label="Context usage details"]').textContent;
  return {Context: text.match(/Context: ([\\d,]+ tokens)/)?.[1] ?? 'Unavailable',
    'Session cost': (() => {
      const row = [...document.querySelectorAll('[aria-label="Token and cost breakdown"] tbody tr')].find(row => row.querySelector('th')?.textContent === 'Cost');
      const value = row?.lastElementChild?.textContent;
      return value?.startsWith('$') ? '$' + Number(value.slice(1)).toFixed(2) : 'Unavailable';
    })(),
    'Session tokens': text.match(/Session total: ([\\d,]+) tokens/)?.[1]};
})()`);
async function capture(name) {
  const snapshot = await ab('snapshot');
  writeFileSync(join(evidence, `${name}.txt`), snapshot);
  assert.doesNotMatch(snapshot, /last-known/i, 'cache freshness stays internal, including menus and accessible descriptions');
  await ab('screenshot', join(evidence, `${name}.png`)); observations.push(name);
}
async function send(text) { await ab('fill', 'textarea[aria-label="Message"]', text); await click('Send'); }
async function ready() {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok && (await fetch('http://127.0.0.1:7171/api/folders')).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Scratch startup deadline');
}
try {
  await ready(); await ab('open', 'http://127.0.0.1:7172/s/cached');
  await ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent==='Not running'`);
  await click('Context usage');
  let facts = await info(); assert.equal(facts.Context, 'Unavailable'); assert.equal(facts['Session cost'], 'Unavailable');
  await capture('uncached-unavailable'); await ab('press', 'Escape');
  await send('/final'); await ab('wait', '--text', 'Final cached');
  await click('Context usage'); await ab('wait', '--fn', `document.querySelector('[aria-label="Context usage details"]')?.textContent.includes('$1.23')`);
  facts = await info(); assert.equal(facts.Context, '50 tokens'); assert.equal(facts['Session cost'], '$1.23'); assert.equal(facts['Session tokens'], '150');
  const cache = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[aria-label="Token and cost breakdown"] tbody tr')].find(row => row.querySelector('th')?.textContent === 'Cache hit');
    return { values: [...row.querySelectorAll('td')].map(cell => cell.textContent),
      heading: [...document.querySelectorAll('[aria-label="Context usage details"] h2')].find(heading => heading.textContent.startsWith('Context:')).textContent };
  })()`);
  assert.deepEqual(cache.values, ['—', '23%']);
  assert.equal(cache.heading, 'Context: 50 tokens');
  await capture('live-observation'); await ab('press', 'Escape');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label^="Session cache hit rate:"]')`), false, 'cache hit rate stays in opt-in usage details');
  assert.equal(await evaluate(`document.querySelector('button[aria-label="Context usage"]').textContent`), '5%/1k');
  assert.doesNotMatch(await evaluate(`document.querySelector('[aria-label="Session usage"]').textContent`), /cache|\$/, 'cost and cache details stay in the popover');

  await stop(server);
  await ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent==='Reconnecting'`);
  assert.equal(await evaluate(`document.querySelector('button[aria-label="Context usage"]').textContent`), '5%/1k', 'keep the composer context compact');
  assert.equal(await evaluate(`document.querySelector('button[aria-label="Context usage"]').getAttribute('aria-description')`), '50 tokens');
  await capture('disconnected-cached-values');
  server = startServer('--hold-stats'); await ready();
  await ab('reload'); await ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent==='Not running'`);
  await ab('wait', '--text', 'Final cached');
  await click('Context usage'); facts = await info();
  assert.equal(facts.Context, '50 tokens'); assert.equal(facts['Session cost'], '$1.23');
  await capture('restarted-file-history-with-cached-stats'); await ab('press', 'Escape');
  await click('Context usage'); await ab('wait', '--text', 'Context: 50 tokens'); await capture('cached-context-popover'); await ab('press', 'Escape');
  await ab('click', 'button[title="unknown"]'); await click('Context usage'); facts = await info();
  assert.equal(facts.Context, 'Unavailable'); assert.equal(facts['Session cost'], 'Unavailable'); await ab('press', 'Escape');
  await ab('click', 'button[title="cached"]');
  await send('/alive'); await ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent==='Ready'`);
  await click('Context usage'); facts = await info();
  assert.equal(facts.Context, '50 tokens'); assert.equal(facts['Session cost'], '$1.23');
  await capture('resumed-before-stats-reply'); await ab('press', 'Escape');
  writeFileSync(statsFile, JSON.stringify({ cost: 2.34, contextUsage: { tokens: 400, contextWindow: 1000, percent: 40 } }));
  const pid = readFileSync(audit, 'utf8').trim().split('\n').map(JSON.parse).findLast(r => r.sessionId === 'cached' && r.event === 'spawn').pid;
  process.kill(pid, 'SIGCONT');
  await click('Context usage'); await ab('wait', '--fn', `document.querySelector('[aria-label="Context usage details"]')?.textContent.includes('$2.34')`);
  facts = await info(); assert.equal(facts.Context, '400 tokens'); assert.equal(facts['Session cost'], '$2.34');
  await capture('pi-refresh-replaces-cache'); await ab('press', 'Escape');

  writeFileSync(statsFile, JSON.stringify({ error: 'fixture usage refresh unavailable' }));
  await send('/settle'); await ab('wait', '--text', 'Unable to refresh session details.');
  await click('Context usage'); facts = await info();
  assert.equal(facts.Context, '400 tokens'); assert.equal(facts['Session cost'], '$2.34');
  await ab('set', 'viewport', '320', '844'); await capture('failed-refresh-cached-values-mobile');
  await ab('press', 'Escape');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await evaluate(`document.querySelector('button[aria-label="Context usage"]').textContent`), '40%/1k');
  await click('Context usage'); await ab('wait', '--text', 'Context: 400 tokens'); await capture('mobile-context-details'); await ab('press', 'Escape');
  writeFileSync(statsFile, JSON.stringify({ cost: 0, contextUsage: { tokens: null, contextWindow: 1000, percent: null } }));
  await send('/settle'); await click('Context usage');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Context usage details"]')?.textContent.includes('$0.00')`);
  facts = await info(); assert.equal(facts.Context, 'Unavailable'); assert.equal(facts['Session cost'], '$0.00'); await capture('authoritative-null-and-zero');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, node: process.version, base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }, null, 2));
  console.log('PASS: cached statistics across restart, immediate reopen, refresh/failure, session isolation and mobile labels');
} finally {
  try { await ab('close'); } catch {}
  await stop(server); await stop(frontend);
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
