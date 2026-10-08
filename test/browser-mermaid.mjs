// Scratch-only Mermaid journey: real renderer, fake Pi history, no model calls.
// node test/browser-mermaid.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-mermaid-evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-mermaid-'));
const repo = join(root, 'repo'), sessions = join(root, 'sessions');
for (const path of [repo, sessions, join(root, 'agent'), join(root, 'home'), join(root, 'config')]) mkdirSync(path);
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
execFileSync('git', ['init', '-q', repo], { env });
const fence = source => '```mermaid\n' + source + '\n```';
const valid = fence('graph LR\nA[Project] --> B[Session]');
const wide = fence('flowchart LR\n' + [
  'Write a prompt', 'Create a session', 'Load project context', 'Send prompt to Pi',
  'Stream assistant response', 'Parse Markdown blocks', 'Identify Mermaid diagrams',
  'Load diagram renderer', 'Apply security settings', 'Generate SVG diagram',
  'Sanitize SVG output', 'Display inside message',
].map((label, i) => `N${i}[${label}]`).join(' --> '));
const text = [
  'Before diagrams.', valid,
  fence('sequenceDiagram\nAlice->>Bob: Hello'),
  fence('not a diagram'),
  fence('%%{init: {"securityLevel":"loose","themeCSS":"body { display:none }","htmlLabels":true}}%%\ngraph LR\nA["<img src=x onerror=alert(1)>"] --> B[Safe]\nclick B "javascript:alert(1)"'),
  wide,
  '```js\nconst ordinary = true;\n```',
  'After diagrams.',
  '```mermaid\ngraph LR\nUnfinished -->',
].join('\n\n');
const timestamp = new Date().toISOString();
const entries = [{ type: 'session', version: 3, id: 'mermaid', cwd: repo, timestamp },
  { type: 'message', id: 'm0', parentId: null, timestamp, message: { role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'alpha', stopReason: 'stop', timestamp: 0, content: [{ type: 'text', text }] } }];
writeFileSync(join(sessions, 'mermaid.jsonl'), entries.map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [{ cwd: repo, sessionId: 'mermaid', title: 'Mermaid check', createdAt: timestamp, updatedAt: timestamp, archived: false }] }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: join(root, 'registry.json'), PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const session = `mermaid-${process.pid}`, commands = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const p = spawn('npx', ['agent-browser', '--session', session, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => p.kill('SIGTERM'), 30000);
    p.on('error', reject); p.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result }); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const count = `document.querySelectorAll('.mermaid-diagram').length`;
const sizes = [];
async function checkWideDiagram(width) {
  await ab('set', 'viewport', String(width), '1000');
  const size = await evaluate(`(() => {
    const host = document.querySelectorAll('.mermaid-diagram')[3];
    host.scrollIntoView({ block: 'center' });
    host.scrollLeft = 0;
    const svg = host.shadowRoot.querySelector('svg');
    return { viewport: innerWidth, available: host.clientWidth, content: host.scrollWidth,
      diagram: svg.getBoundingClientRect().width, natural: svg.viewBox.baseVal.width,
      page: document.documentElement.scrollWidth };
  })()`);
  sizes.push(size);
  assert.ok(size.natural > size.available, 'fixture exceeds message width');
  assert.ok(size.diagram >= size.natural * 0.95, `diagram must not shrink: ${JSON.stringify(size)}`);
  assert.ok(size.content > size.available, 'wide diagram scrolls inside message');
  assert.ok(size.page <= size.viewport, 'diagram does not widen the page');
  await ab('eval', `document.querySelectorAll('.mermaid-diagram')[3].focus()`);
  await ab('press', 'ArrowRight');
  await ab('wait', '--fn', `document.querySelectorAll('.mermaid-diagram')[3].scrollLeft > 0`);
  await ab('screenshot', join(evidence, `wide-${width}-start.png`));
  const end = await evaluate(`(() => {
    const host = document.querySelectorAll('.mermaid-diagram')[3];
    host.scrollLeft = host.scrollWidth;
    const label = [...host.shadowRoot.querySelectorAll('text')].find(e => e.textContent.replace(/\\s+/g, '').includes('Displayinsidemessage'));
    const bounds = label.getBoundingClientRect(), viewport = host.getBoundingClientRect();
    return { visible: bounds.left >= viewport.left && bounds.right <= viewport.right, offset: host.scrollLeft };
  })()`);
  assert.ok(end.visible && end.offset > 0, 'last label is reachable by horizontal scrolling');
  await ab('screenshot', join(evidence, `wide-${width}-end.png`));
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (n === 99) throw new Error('Startup deadline'); await delay(100);
  }
  await ab('set', 'viewport', '1440', '1000');
  await ab('open', 'http://127.0.0.1:7172/s/mermaid');
  await ab('wait', '--fn', `${count} === 4`);
  const observation = await evaluate(`(() => {
    const prose = document.querySelector('.prose-chat');
    const diagrams = [...prose.querySelectorAll('.mermaid-diagram')];
    return { diagrams: diagrams.length, labels: diagrams[0].shadowRoot.textContent,
      safeLabel: diagrams[2].shadowRoot.textContent.includes('Safe'),
      fallback: [...prose.querySelectorAll('pre')].map(e => e.textContent),
      unsafe: diagrams.some(e => e.shadowRoot.querySelector('script, foreignObject, image, a, [onerror], [onclick]')),
      outsideSVG: document.querySelectorAll('body > div > svg').length,
      bodyDisplay: getComputedStyle(document.body).display };
  })()`);
  assert.equal(observation.diagrams, 4);
  await checkWideDiagram(1440);
  await checkWideDiagram(390);
  await ab('set', 'viewport', '1440', '1000');
  assert.match(observation.labels, /Project/); assert.match(observation.labels, /Session/);
  assert.deepEqual(observation.fallback, ['not a diagram', 'const ordinary = true;', 'graph LR\nUnfinished -->']);
  assert.equal(observation.safeLabel, true, 'diagram config cannot re-enable HTML labels');
  assert.equal(observation.unsafe, false); assert.equal(observation.outsideSVG, 0); assert.notEqual(observation.bodyDisplay, 'none');
  for (const theme of ['Dark', 'Light']) {
    await ab('find', 'role', 'button', 'click', '--name', 'View options', '--exact'); await ab('find', 'role', 'menuitem', 'hover', '--name', 'Appearance'); await ab('wait', '--fn', `!!document.querySelector('[role="menuitemradio"]')`);
    await ab('find', 'role', 'menuitemradio', 'click', '--name', theme, '--exact');
    await ab('wait', '--fn', `${count} === 4`);
    await ab('screenshot', join(evidence, `${theme}.png`));
  }
  await ab('set', 'viewport', '390', '844');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await ab('screenshot', join(evidence, 'mobile.png'));
  await ab('reload'); await ab('wait', '--fn', `${count} === 4`);
  // Exercise the same production Markdown component through incremental text updates,
  // without a paid model or timing-dependent fake stream.
  await ab('eval', `(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Markdown } = await import('/src/components/Markdown.tsx');
    const host = document.createElement('div'); host.id = 'stream-check'; document.body.append(host);
    const root = ReactDOM.createRoot(host);
    window.updateDiagram = text => root.render(React.createElement(Markdown, { text }));
    window.updateDiagram('Before\\n\\n' + ${JSON.stringify(valid.slice(0, -3))});
  })()`);
  await ab('wait', '--fn', `document.querySelector('#stream-check pre') !== null`);
  assert.equal(await evaluate(`document.querySelectorAll('#stream-check .mermaid-diagram').length`), 0);
  await ab('eval', `window.updateDiagram(${JSON.stringify(valid)})`);
  await ab('wait', '--fn', `document.querySelectorAll('#stream-check .mermaid-diagram').length === 1`);
  await ab('eval', `window.updateDiagram(${JSON.stringify(fence('not a diagram'))})`);
  await ab('wait', '--fn', `document.querySelector('#stream-check pre')?.textContent === 'not a diagram'`);
  assert.equal(await evaluate(`document.querySelectorAll('#stream-check .mermaid-diagram').length`), 0);
  assert.equal(await ab('errors'), '');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome: 'passed', revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: true, node: process.version, modelCalls: 0, observation, sizes, checks: ['flowchart and sequence', 'invalid and incomplete source fallback', 'ordinary fences', 'untrusted diagram', 'light/dark', 'mobile', 'wide diagram readability and keyboard scroll', 'reload', 'incremental component updates'] }, null, 2));
  console.log('PASS: Mermaid diagrams, fallbacks, security, themes, mobile, reload and incremental updates');
} finally {
  try { await ab('close'); } catch {}
  for (const p of [backend, frontend]) if (p.exitCode === null) { const stopped = new Promise(resolve => p.once('exit', resolve)); p.kill('SIGTERM'); await stopped; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
