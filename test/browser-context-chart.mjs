// Scratch-only chart journey; saved history, no Pi subprocess or paid model calls.
// node test/browser-context-chart.mjs /tmp/piano-chart-evidence
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-chart-evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-chart-'));
const cwd = join(root, 'project'), sessionDir = join(root, 'sessions');
mkdirSync(cwd); mkdirSync(sessionDir);
assert.equal(spawnSync('git', ['init', '--quiet', cwd]).status, 0);
const sessions = [3, 98].map(count => {
  const saved = SessionManager.create(cwd, sessionDir);
  for (let i = 1; i <= count; i++) saved.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'chart', content: [{ type: 'text', text: `Response ${i}` }], usage: { input: i * 100, output: i, cacheRead: 0, cacheWrite: 0, totalTokens: i * 101, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: i / 100 } }, stopReason: 'stop', timestamp: i });
  return { cwd, sessionId: saved.getSessionId(), title: `${count} responses`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false };
});
const registry = join(root, 'registry.json');
writeFileSync(registry, JSON.stringify({ projects: [cwd], worktrees: [], sessions }));
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOME: root, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry, PI_CODING_AGENT_SESSION_DIR: sessionDir }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const child of [server, frontend]) { child.stdout.on('data', d => processLog += d); child.stderr.on('data', d => processLog += d); }
const browserSession = `chart-${process.pid}`, commands = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', browserSession, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    child.on('error', reject); child.on('exit', status => resolve({ status, stdout, stderr }));
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const facts = () => evaluate(`(() => {
  const c = document.querySelector('[aria-label="Scrollable response chart"]');
  const bars = c.querySelectorAll('rect');
  const selected = [...bars].find(b => b.getAttribute('opacity') === '1').getBoundingClientRect();
  const bounds = c.getBoundingClientRect();
  return { count: bars.length, width: bars[0].getBoundingClientRect().width, scroll: c.scrollLeft, overflow: c.scrollWidth > c.clientWidth, selectedVisible: selected.left >= bounds.left - 1 && selected.right <= bounds.right + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth };
})()`);
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (i === 99) throw new Error('Scratch UI startup timed out');
    await delay(100);
  }
  await ab('open', `http://127.0.0.1:7172/s/${sessions[1].sessionId}`);
  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await ab('set', 'viewport', String(width), String(height));
    await ab('click', '[aria-label="Context usage"]');
    await ab('wait', '--text', 'Response 98 / 98');
    let observed = await facts();
    assert.equal(observed.count, 98); assert.ok(observed.width >= 11); assert.ok(observed.overflow && observed.scroll > 0 && observed.selectedVisible); assert.equal(observed.pageOverflow, false);
    await ab('screenshot', join(evidence, `chart-${width}.png`));
    await ab('click', '[aria-label="Inspect response"]');
    await ab('press', 'Home');
    await ab('wait', '--text', 'Response 1 / 98');
    observed = await facts(); assert.equal(observed.scroll, 0); assert.ok(observed.selectedVisible);
    await ab('click', '[aria-label="Show cost history"]');
    assert.ok((await facts()).selectedVisible);
    await ab('click', '[aria-label="Inspect response"]'); await ab('press', 'End');
    await ab('wait', '--text', 'Response 98 / 98'); assert.ok((await facts()).selectedVisible);
    await evaluate(`document.querySelector('[aria-label="Scrollable response chart"]').scrollLeft = 0`);
    assert.equal((await facts()).scroll, 0, 'Manual scroll is not forced back to the selection');
    await ab('press', 'Escape');
  }
  await ab('open', `http://127.0.0.1:7172/s/${sessions[0].sessionId}`);
  await ab('click', '[aria-label="Context usage"]'); await ab('wait', '--text', 'Response 3 / 3');
  const short = await facts(); assert.equal(short.overflow, false); assert.ok(short.selectedVisible && short.width >= 11);
  console.log('PASS: 98 responses retain >=11px bars on mobile/desktop; latest and slider-selected bars stay visible; manual scrolling, cost mode and short history work without page overflow. Zero model calls.');
} finally {
  await ab('close').catch(() => {});
  for (const child of [frontend, server]) { child.kill('SIGTERM'); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'processes.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
