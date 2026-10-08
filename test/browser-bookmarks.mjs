// PR 2: browser mutations against real Pi, restart, stale-tab admission.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { seedConversation } from './fixtures/ConversationHistory.ts';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-bookmark-evidence/browser');
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture(); fixture.configureSentinel('disabled');
const cwd = fixture.project('bookmark-browser'), seed = seedConversation(cwd, fixture.sessionDir);
const config = join(fixture.root, 'registry.json');
writeFileSync(config, JSON.stringify({ projects: [cwd], worktrees: [], sessions: [{ cwd, sessionId: seed.sessionId, title: 'Bookmark fixture', archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }));
const env = { ...process.env, HOST: '127.0.0.1', PORT: '7171', ...registryEnv(config), PIANO_PI_CLI: fixture.cli().cli, PIANO_PI_ARGS: fixture.cli().extraArgs.join(' '), PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir };
let log = '';
const observe = process => { process.stdout.on('data', data => log += data); process.stderr.on('data', data => log += data); return process; };
const startBackend = () => observe(spawn(process.execPath, ['server/main.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
let backend = startBackend();
const frontend = observe(spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] }));
const commands = [], browser = `bookmarks-${process.pid}`;
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', browser, ...args]); let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
  });
  commands.push({ args, ...result }); assert.equal(result.code, 0, result.stderr || result.stdout); return result.stdout.trim();
}
const evaluate = async code => JSON.parse(await ab('eval', code));
const stop = child => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
const ready = async () => {
  for (let n = 0; ; n++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) return; } catch {}
    if (n === 100) throw new Error(log); await delay(100);
  }
};
const open = async () => {
  await ab('click', '[aria-label="Session information and actions"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Bookmark', '--exact');
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Search history previews"]') && document.querySelectorAll('[cmdk-item]').length > 0`);
  await ab('fill', '[aria-label="Search history previews"]', 'Abandoned');
  await ab('press', 'ArrowDown');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Entry preview"]')?.textContent.includes('Abandoned approach')`);
};
const label = async name => {
  await ab('find', 'role', 'button', 'click', '--name', 'Bookmark', '--exact');
  await ab('fill', '[aria-label="Bookmark name"]', name);
  await ab('find', 'role', 'button', 'click', '--name', 'Save bookmark', '--exact');
  await ab('wait', '--fn', `!document.querySelector('[aria-label="Bookmark name"]') && document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(name)})`);
};
const savedLabels = () => readFileSync(seed.file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(e => e.type === 'label' && e.targetId === seed.abandoned);
try {
  await ready();
  await ab('open', `http://127.0.0.1:7172/s/${seed.sessionId}`);
  await ab('wait', '--text', 'Compacted decision');
  await open(); await ab('screenshot', join(evidence, 'before.png'));
  await label('Browser bookmark');
  assert.equal(savedLabels().at(-1).label, 'Browser bookmark');
  assert.equal(savedLabels().at(-1).parentId, seed.leaf, 'label an abandoned entry without navigating to it');
  await ab('click', '#tree-bookmarks');
  await ab('fill', '[aria-label="Search history previews"]', 'Browser bookmark');
  await ab('wait', '--text', 'Browser bookmark');
  await ab('screenshot', join(evidence, 'bookmarked.png'));
  await ab('press', 'Escape');
  // A second tab holds a deliberately old projection while tab 0 renames.
  await ab('tab', 'new', `http://127.0.0.1:7172/s/${seed.sessionId}`);
  await ab('wait', '--text', 'Compacted decision');
  await evaluate(`window.nativeFetch = fetch; window.fetch = async (...args) => {
    const response = await window.nativeFetch(...args);
    if (String(args[0]).includes('/api/session/history') && !String(args[0]).includes('entryId=') && !args[1]?.method) {
      window.savedTree ??= await response.clone().json(); return new Response(JSON.stringify(window.savedTree), { status: 200 });
    }
    return response;
  }; true`);
  await open();
  await ab('tab', 't1'); await open(); await label('Renamed bookmark');
  await ab('tab', 't2');
  await ab('find', 'role', 'button', 'click', '--name', 'Bookmark', '--exact');
  await ab('fill', '[aria-label="Bookmark name"]', 'Stale overwrite');
  await ab('find', 'role', 'button', 'click', '--name', 'Save bookmark', '--exact');
  await ab('wait', '--text', 'The session changed.');
  assert.equal(savedLabels().at(-1).label, 'Renamed bookmark');
  await ab('screenshot', join(evidence, 'stale-tab.png'));
  await ab('tab', 'close');
  await ab('press', 'Escape');
  await ab('reload'); await ab('wait', '--text', 'Compacted decision');
  await open(); await ab('wait', '--text', 'Renamed bookmark');
  await ab('press', 'Escape');
  await stop(backend); backend = startBackend(); await ready();
  await ab('reload'); await ab('wait', '--text', 'Compacted decision');
  await ab('press', 'Control+k');
  await ab('fill', '[aria-label="Search sessions and commands"]', 'Bookmark');
  await ab('find', 'role', 'option', 'click', '--name', 'Bookmark', '--exact');
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Search history previews"]')`);
  await ab('fill', '[aria-label="Search history previews"]', 'Renamed bookmark');
  await ab('press', 'ArrowDown');
  await ab('wait', '--text', 'Renamed bookmark');
  await ab('screenshot', join(evidence, 'restart.png'));
  await ab('find', 'role', 'button', 'click', '--name', 'Bookmark', '--exact');
  await ab('find', 'role', 'button', 'click', '--name', 'Remove bookmark', '--exact');
  await ab('wait', '--fn', `!document.querySelector('[aria-label="Bookmark name"]')`);
  assert.equal(savedLabels().at(-1).label, undefined);
  assert.equal(fixture.observe().requests.length, 0);
  await ab('press', 'Escape');
  await stop(backend);
  const audit = join(fixture.root, 'missing-bridge-prompts'); writeFileSync(audit, '');
  env.PIANO_PI_CLI = resolve('test/fake-history-pi.mjs'); env.PIANO_PI_ARGS = `--history-fixture missing --history-audit ${audit}`;
  backend = startBackend(); await ready();
  await ab('reload'); await ab('wait', '--text', 'Compacted decision');
  await open();
  await ab('find', 'role', 'button', 'click', '--name', 'Bookmark', '--exact');
  await ab('fill', '[aria-label="Bookmark name"]', 'Missing extension');
  await ab('find', 'role', 'button', 'click', '--name', 'Save bookmark', '--exact');
  await ab('wait', '--text', 'history extension is unavailable');
  await ab('fill', '[aria-label="Search history previews"]', 'First prompt');
  await ab('press', 'ArrowDown');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Entry preview"]')?.textContent.includes('First prompt')`);
  assert.equal(await evaluate(`[...document.querySelectorAll('[aria-label="Entry preview"] button')].find(b => b.textContent === 'Bookmark')?.disabled`), true);
  assert.equal(readFileSync(audit, 'utf8'), '', 'no unknown slash command fell through to model input');
  await ab('screenshot', join(evidence, 'missing-extension.png'));
  console.log('PASS: add/rename/filter, stale second-tab rejection, reconnect/backend restart, palette parity, removal, Pi saved labels and missing-extension fail-closed behavior; no model requests.');
} catch (error) {
  await ab('snapshot').catch(() => {}); await ab('screenshot', join(evidence, 'failure.png')).catch(() => {}); throw error;
} finally {
  await ab('close').catch(() => {}); await Promise.all([stop(backend), stop(frontend)]);
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); writeFileSync(join(evidence, 'process.log'), log);
  writeFileSync(join(evidence, 'revision.txt'), execFileSync('git', ['rev-parse', 'HEAD']).toString() + ' + working tree\n');
  fixture.retain(evidence); await fixture.close();
}
