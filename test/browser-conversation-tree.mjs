// PR 1: real locked Pi, isolated resources, no provider requests.
// node test/browser-conversation-tree.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { seedConversation } from './fixtures/ConversationHistory.ts';
import { createPiCompatibilityFixture } from './fixtures/PiCompatibility.ts';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-tree-evidence/browser');
mkdirSync(evidence, { recursive: true });
const fixture = await createPiCompatibilityFixture();
fixture.configureSentinel('disabled');
const cwd = fixture.project('tree-browser');
const seed = seedConversation(cwd, fixture.sessionDir);
const second = seedConversation(cwd, fixture.sessionDir);
const before = readFileSync(seed.file, 'utf8');
const promptFacts = join(fixture.root, 'prompt-facts.json');
writeFileSync(join(cwd, '.pi', 'extensions', 'tree-input.ts'), `import { writeFileSync } from 'node:fs';
export default function(pi) { pi.on('input', (event, ctx) => {
  if (event.text !== 'TREE_OBSERVE') return;
  writeFileSync(${JSON.stringify(promptFacts)}, JSON.stringify({ leaf: ctx.sessionManager.getLeafId(), path: ctx.sessionManager.getBranch().map(e => e.id) }));
  return { action: 'handled' };
}); }`);
const config = join(fixture.root, 'registry.json');
writeFileSync(config, JSON.stringify({ projects: [cwd], worktrees: [], sessions: [seed, second].map((s, n) => ({ cwd, sessionId: s.sessionId, title: `Tree fixture ${n}`, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '7171', ...registryEnv(config), PIANO_PI_CLI: fixture.cli().cli, PIANO_PI_ARGS: fixture.cli().extraArgs.join(' '), PI_CODING_AGENT_DIR: fixture.agentDir, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
for (const process of [backend, frontend]) { process.stdout.on('data', data => log += data); process.stderr.on('data', data => log += data); }
const commands = [], browser = `tree-${process.pid}`;
async function ab(...args) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', browser, ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
  });
  commands.push({ args, ...output });
  assert.equal(output.code, 0, output.stderr || output.stdout);
  return output.stdout.trim();
}
const evaluate = async code => JSON.parse(await ab('eval', code));
async function openTree() {
  await ab('click', '[aria-label="Session information and actions"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Conversation tree', '--exact');
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Search history previews"]') && document.querySelectorAll('[cmdk-item]').length > 0`);
}
async function closeTree() {
  await ab('press', 'Escape');
  await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
}
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (n === 100) throw new Error(`Startup deadline: ${log}`);
    await delay(100);
  }
  await ab('open', `http://127.0.0.1:7172/s/${seed.sessionId}`);
  await ab('wait', '--text', 'Compacted decision');
  await ab('screenshot', join(evidence, 'before.png'));
  const starts = () => fixture.observe().pi.filter(e => e.event === 'session-start' && e.sessionId === seed.sessionId).length;
  const initialStarts = starts();
  for (const width of [1280, 390]) {
    await ab('set', 'viewport', String(width), '900');
    await openTree();
    assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Search history previews');
    for (const text of ['Original decision', 'Abandoned approach', 'Compacted decision', 'Return point']) {
      await ab('fill', '[aria-label="Search history previews"]', text);
      await ab('press', 'ArrowDown');
      await ab('wait', '--fn', `document.querySelector('[aria-label="Entry preview"]')?.textContent.includes(${JSON.stringify(text === 'Return point' ? 'Abandoned approach' : text)})`);
    }
    await ab('fill', '[aria-label="Search history previews"]', 'no-such-entry');
    await ab('wait', '--text', 'No matching entries.');
    await ab('find', 'role', 'button', 'click', '--name', 'Show current position');
    await ab('wait', '--fn', `document.querySelector('[cmdk-item][aria-selected="true"]')?.getAttribute('data-value') === ${JSON.stringify(seed.leaf)}`);
    await ab('wait', '--text', 'fixture-current');
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').getBoundingClientRect().right <= innerWidth`), true);
    await ab('screenshot', join(evidence, `tree-${width}.png`));
    await closeTree();
  }
  assert.equal(starts(), initialStarts, 'inactive browsing never starts a Pi child');
  assert.equal(readFileSync(seed.file, 'utf8'), before, 'preview leaves persisted history and leaf untouched');
  await ab('set', 'viewport', '1280', '900');
  await ab('press', 'Control+k');
  await ab('fill', '[aria-label="Search sessions and commands"]', 'Conversation tree');
  await ab('press', 'Enter');
  await ab('wait', '--fn', `document.activeElement?.getAttribute('aria-label') === 'Search history previews'`);
  await closeTree();

  // Slow obsolete response: ignore even a fetch implementation that completes
  // after AbortController cancellation. Route selection is an actual second session.
  await evaluate(`window.nativeFetch = window.fetch; window.fetch = async (...args) => { const response = await window.nativeFetch(...args); if (String(args[0]).includes('/api/session/history')) await new Promise(r => setTimeout(r, 2500)); return response; }; true`);
  await ab('click', '[aria-label="Session information and actions"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Conversation tree', '--exact');
  await closeTree();
  await evaluate(`history.pushState(null, '', '/s/${second.sessionId}'); dispatchEvent(new PopStateEvent('popstate')); true`);
  await ab('wait', '--fn', `document.querySelector('main h1')?.textContent === 'Tree fixture 1'`);
  await delay(2600);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Search history previews"]')`), false);
  await evaluate(`window.fetch = window.nativeFetch; true`);
  await openTree();
  await closeTree();

  // Failed inactive read is not an empty successful tree or a new Pi session.
  rmSync(second.file);
  await ab('click', '[aria-label="Session information and actions"]');
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Conversation tree', '--exact');
  await ab('wait', '--text', 'No saved Pi history is available');
  await ab('screenshot', join(evidence, 'failed-history.png'));
  await closeTree();
  await ab('open', `http://127.0.0.1:7172/s/${seed.sessionId}`);
  await ab('wait', '--text', 'Compacted decision');
  await ab('fill', '[aria-label="Message"]', '/phase0-facts');
  await ab('press', 'Enter');
  await ab('wait', '--text', 'Command handled.');
  const liveBefore = readFileSync(seed.file, 'utf8');
  await openTree();
  await ab('fill', '[aria-label="Search history previews"]', 'Abandoned');
  await ab('wait', '--text', 'Abandoned approach');
  await closeTree();
  assert.equal(readFileSync(seed.file, 'utf8'), liveBefore);
  await ab('fill', '[aria-label="Message"]', 'TREE_OBSERVE');
  await ab('press', 'Enter');
  await ab('wait', '--text', 'Command handled.');
  for (let n = 0; ; n++) {
    try { const facts = JSON.parse(readFileSync(promptFacts, 'utf8')); assert.equal(facts.leaf, seed.leaf); assert.ok(facts.path.includes(seed.active)); assert.ok(!facts.path.includes(seed.abandoned)); break; }
    catch (error) { if (n === 50) throw error; await delay(20); }
  }
  assert.equal(fixture.observe().requests.length, 0);
  await ab('fill', '[aria-label="Message"]', '/phase0-wait');
  await ab('press', 'Enter');
  await ab('wait', '--text', 'PHASE0_WAITING');
  await openTree();
  await ab('fill', '[aria-label="Search history previews"]', 'Abandoned');
  await ab('wait', '--text', 'Abandoned approach');
  await closeTree();
  await ab('click', '[aria-label="Stop"]');
  await fixture.aborted;
  assert.equal(fixture.observe().requests.length, 1, 'only the explicit synthetic streaming request ran');
  console.log('PASS: menu/palette, desktop/mobile, keyboard focus, both branches/compaction/label, filter-independent current position, inactive no-spawn, stale response cancellation, failed read, live idle/running preview and abort; one local synthetic stream, no paid calls.');
} catch (error) {
  await ab('snapshot').catch(() => {});
  await ab('screenshot', join(evidence, 'failure.png')).catch(() => {});
  throw error;
} finally {
  await ab('close').catch(() => {});
  const exits = [backend, frontend].map(child => new Promise(resolve => child.once('exit', resolve)));
  backend.kill('SIGTERM'); frontend.kill('SIGTERM'); await Promise.all(exits);
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), log);
  writeFileSync(join(evidence, 'revision.txt'), execFileSync('git', ['rev-parse', 'HEAD']).toString() + ' + working tree\n');
  fixture.retain(evidence); await fixture.close();
}
