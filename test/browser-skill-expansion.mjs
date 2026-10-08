// A `/skill:name` prompt reads as the command that was typed; the skill file Pi put in its
// place opens on request as rendered markdown. Scratch-only, fake Pi, no paid model calls.
// node test/browser-skill-expansion.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-skill-evidence/browser');
const BACKEND_PORT = process.env.PIANO_TEST_BACKEND_PORT ?? '7171', WEB_PORT = process.env.PIANO_TEST_WEB_PORT ?? '7172';
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-skill-'));
const repo = join(root, 'piano-studio'), sessions = join(root, 'sessions');
for (const path of [repo, sessions, join(root, 'agent'), join(root, 'home'), join(root, 'config')]) mkdirSync(path);
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { env });
git('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'app.ts'), 'export const greeting = "Hello, Piano";\n'); git('add', '.'); git('commit', '-qm', 'Initial app');
const timestamp = new Date().toISOString();
// Exactly what Pi writes into history for `/skill:show-me <args>` (agent-session `_expandSkillCommand`).
const location = '/Users/james/.pi/agent/skills/show-me/SKILL.md';
const body = 'Help the user understand the current topic of conversation visually. Skip the preamble and keep prose brief. Pick the smallest view that makes the key point clear.\n\n## Views\n\n- **Table** for comparisons across a few options.\n- **Diagram** for flows and ownership, see `references/diagrams.md`.\n\n```sh\nnpx agent-browser screenshot out.png\n```';
const expansion = `<skill name="show-me" location="${location}">\nReferences are relative to /Users/james/.pi/agent/skills/show-me.\n\n${body}\n</skill>`;
const assistant = text => ({ role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'alpha', stopReason: 'stop', content: [{ type: 'text', text }] });
const messages = [
  { role: 'user', content: `${expansion}\n\nShow me how sessions reach the browser.` },
  assistant('Here is the path from Pi to the transcript.'),
  { role: 'user', content: expansion },
  assistant('A diagram of the current topic.'),
  { role: 'user', content: 'Thanks, that is clear.' },
];
const entries = [{ type: 'session', version: 3, id: 'skills', cwd: repo, timestamp }, ...messages.map((message, n) => ({
  type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null, timestamp, message: { ...message, timestamp: n },
}))];
writeFileSync(join(sessions, 'skills.jsonl'), entries.map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [
  { cwd: repo, sessionId: 'skills', title: 'Skill prompts', createdAt: timestamp, updatedAt: timestamp, archived: false },
] }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: BACKEND_PORT,
  PIANO_CONFIG: join(root, 'registry.json'), PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: '',
  PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', WEB_PORT, '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${BACKEND_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [backend, frontend]) { proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d); }
const session = `skill-${process.pid}`, commands = [], observations = [];
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
const click = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
async function capture(name) {
  await ab('screenshot', join(evidence, `${name}.png`));
  writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot'));
}
async function appearance(name) {
  await ab('find', 'role', 'button', 'click', '--name', 'View:'); await ab('find', 'role', 'menuitem', 'hover', '--name', 'Appearance'); await ab('wait', '--fn', `!!document.querySelector('[role="menuitemradio"]')`); await ab('find', 'role', 'menuitemradio', 'click', '--name', name, '--exact');
}
const group = '[role="group"][aria-label="show-me skill"]';
const trigger = `${group} button[aria-expanded]`;
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/projects`)).ok && (await fetch(`http://127.0.0.1:${WEB_PORT}`)).ok) break; } catch {}
    if (n === 99) throw new Error('Scratch startup deadline'); await delay(100);
  }
  await ab('set', 'viewport', '1440', '1000');
  await ab('open', `http://127.0.0.1:${WEB_PORT}/s/skills`);
  await ab('wait', '--text', 'Thanks, that is clear.');
  const transcript = await evaluate(`document.querySelector('[data-slot="transcript"]').innerText`);
  assert.ok(!transcript.includes('<skill'), 'expansion markup never reaches the reader');
  assert.ok(!transcript.includes('References are relative to'), 'the base-directory note is folded away');
  assert.ok(transcript.includes('Show me how sessions reach the browser.'), 'the user’s own words stay in the prompt');
  const closed = await evaluate(`(() => {
    const groups = [...document.querySelectorAll('${group}')];
    return { count: groups.length, labels: groups.map(g => g.querySelector('button').innerText.trim()), expanded: groups.map(g => g.querySelector('button').getAttribute('aria-expanded')),
      bodyVisible: document.body.innerText.includes('Skip the preamble') };
  })()`);
  observations.push({ name: 'closed', ...closed });
  assert.deepEqual(closed, { count: 2, labels: ['/skill:show-me', '/skill:show-me'], expanded: ['false', 'false'], bodyVisible: false });
  // The appearance menu sits in the sidebar, so the theme is chosen at desktop width and kept for the phone capture.
  for (const theme of ['Light', 'Dark']) {
    await ab('set', 'viewport', '1440', '1000'); await appearance(theme);
    for (const width of [1440, 390]) {
      await ab('set', 'viewport', String(width), '1000');
      await capture(`collapsed-${theme.toLowerCase()}-${width}`);
    }
  }
  await ab('set', 'viewport', '1440', '1000');
  await ab('click', trigger);
  await ab('wait', '--text', 'Skip the preamble');
  const opened = await evaluate(`(() => {
    const g = document.querySelector('${group}');
    const prose = g.querySelector('.prose-chat');
    return { expanded: g.querySelector('button').getAttribute('aria-expanded'), location: g.querySelector('p').innerText,
      headings: [...prose.querySelectorAll('h2')].map(h => h.innerText), bullets: prose.querySelectorAll('li').length, strong: prose.querySelectorAll('strong').length,
      code: prose.querySelectorAll('pre code').length, raw: prose.innerText.includes('**'),
      promptOpen: [...g.closest('article').querySelectorAll('button[aria-expanded="true"]')].some(b => !g.contains(b)) };
  })()`);
  observations.push({ name: 'opened', ...opened });
  assert.equal(opened.expanded, 'true');
  assert.equal(opened.location, '~/.pi/agent/skills/show-me/SKILL.md', 'the file path is there for a reader who wants to open it');
  assert.deepEqual(opened.headings, ['Views']);
  assert.equal(opened.bullets, 2); assert.equal(opened.strong, 2); assert.equal(opened.code, 1);
  assert.equal(opened.raw, false, 'markdown is rendered, not shown as source');
  assert.equal(opened.promptOpen, false, 'opening the skill does not toggle the prompt around it');
  for (const theme of ['Light', 'Dark']) { await appearance(theme); await capture(`expanded-${theme.toLowerCase()}-1440`); }
  // Keyboard: the trigger is reachable and toggles with Enter.
  await ab('eval', `document.querySelector('${trigger}').focus()`); await ab('press', 'Enter');
  assert.equal(await evaluate(`document.querySelector('${trigger}').getAttribute('aria-expanded')`), 'false');
  // The jump list names the prompt by its command.
  await click('Jump to message'); await ab('wait', '[aria-label="Jump to message"][role="dialog"] li');
  const jump = await evaluate(`[...document.querySelectorAll('[aria-label="Jump to message"][role="dialog"] li')].map(e => e.innerText.replace(/\\s+/g, ' ').trim())`);
  observations.push({ name: 'jump', jump });
  assert.ok(jump.some(label => label.includes('/skill:show-me Show me how sessions reach the browser.')), JSON.stringify(jump));
  assert.ok(!jump.some(label => label.includes('<skill')), JSON.stringify(jump));
  await ab('press', 'Escape');
  assert.equal(await ab('errors'), '');
  console.log('PASS: skill prompts show the typed command, fold the skill file as rendered markdown, keep the location, and are named by command in the jump list');
} finally {
  try { await ab('close'); } catch {}
  for (const proc of [backend, frontend]) if (proc.exitCode === null) { const stopped = new Promise(resolve => proc.once('exit', resolve)); proc.kill('SIGTERM'); await stopped; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
