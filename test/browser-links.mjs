// The link pile: the pull requests, issues and local servers a session mentions, set aside above
// the composer. Fake Pi,
// scratch registry, and read-only `gh` lookups when a login is available (status checks are
// skipped without one). No paid model calls.
// node test/browser-links.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
const evidence = resolve(process.argv[2] ?? '/tmp/piano-links-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-links-'));
const repo = join(root, 'piano-links'), sessions = join(root, 'sessions');
for (const p of [repo, sessions, join(root, 'agent'), join(root, 'home'), join(root, 'config')]) mkdirSync(p);
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...a], { env });
git('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'app.ts'), 'export const x = 1;\n'); git('add', '.'); git('commit', '-qm', 'Initial');
const timestamp = new Date().toISOString();
// A real merged pull request when `gh` is logged in; otherwise a plausible URL whose status stays unknown.
let PR = { url: 'https://github.com/vitejs/vite/pull/23661', number: 23661 }, live = false;
try { PR = JSON.parse(execFileSync('gh', ['pr', 'list', '-R', 'vitejs/vite', '--state', 'merged', '-L', '1', '--json', 'url,number'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString())[0]; live = true; } catch {}
const PR_URL = PR.url;
const assistant = text => ({ role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'alpha', stopReason: 'stop', content: [{ type: 'text', text }] });
const user = content => ({ role: 'user', content });
const messages = [
  user('Design a stack like https://www.hey.com/features/set-aside/. The vocabulary is in [the glossary](https://example.com/docs/glossary).'),
  assistant('I read the page. Set Aside keeps mail "at hand, but out of your face": a pile at the bottom that fans open.'),
];
for (let i = 0; i < 10; i++) { messages.push(user(`Filler question ${i}: keep the transcript long enough to scroll.`), assistant(`Filler answer ${i}.\n\nSome more lines to add height.\n\n- one\n- two\n- three`)); }
messages.push(assistant('Opened ' + PR_URL + ' and tracked https://github.com/vitejs/vite/issues/1. The dev server is at http://127.0.0.1:7172/s/links. Relevant code: https://github.com/vitejs/vite/blob/main/packages/vite/src/node/server/index.ts#L10-L20\n\n```bash\ncurl http://localhost:9999/not-a-reference\n```\n'));
const entries = [{ type: 'session', version: 3, id: 'links', cwd: repo, timestamp }, ...messages.map((message, n) => ({ type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null, timestamp, message: { ...message, timestamp: n } }))];
writeFileSync(join(sessions, 'links.jsonl'), entries.map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [{ cwd: repo, sessionId: 'links', title: 'Link pile', createdAt: timestamp, updatedAt: timestamp, archived: false }] }));
// The backend keeps the real HOME so `gh` finds its login; only git in the scratch repo is isolated.
const backend = spawn(process.execPath, ['server/main.ts'], { cwd: repoRoot, env: { ...process.env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: join(root, 'registry.json'), PIANO_PI_CLI: join(repoRoot, 'test/fake-host-pi.mjs'), PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [join(repoRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: join(repoRoot, 'web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const session = `links-${process.pid}`, commands = [], observations = {};
async function ab(...args) {
  const r = await new Promise((res, rej) => {
    const proc = spawn('agent-browser', ['--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '15000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; proc.stdout.on('data', d => stdout += d); proc.stderr.on('data', d => stderr += d);
    const t = setTimeout(() => proc.kill('SIGTERM'), 30000);
    proc.on('error', e => { clearTimeout(t); rej(e); }); proc.on('exit', status => { clearTimeout(t); res({ status, stdout, stderr }); });
  });
  commands.push({ args, ...r }); assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const shot = name => ab('screenshot', join(evidence, `${name}.png`));
const PILE = `document.querySelector('[data-slot="link-stack"]')`;
const cards = `(() => { const ul = ${PILE}; if (!ul) return null; const lis = [...ul.children]; return { fanned: ul.dataset.fanned === 'true', count: lis.length, cards: lis.map(li => { const r = li.getBoundingClientRect(); return { title: li.querySelector('a span span').textContent, detail: li.querySelector('a span span + span').textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), actions: [...li.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) }; }) }; })()`;
try {
  for (let n = 0; ; n++) {
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (n === 149) throw new Error('Scratch startup deadline'); await delay(100);
  }
  // Server: live status for the two GitHub links.
  const api = await (await fetch('http://127.0.0.1:7171/api/links?urls=' + encodeURIComponent(PR_URL + ' https://github.com/vitejs/vite/issues/1'))).json();
  observations.api = { live, ...api };
  if (live) {
    assert.equal(api.links.length, 2, JSON.stringify(api));
    assert.equal(api.links.find(l => l._tag === 'pull_request').number, PR.number);
    assert.equal(api.links.find(l => l._tag === 'issue').number, 1);
  }
  const issueTitle = live ? api.links.find(l => l._tag === 'issue').title : 'vitejs/vite #1';
  const prTitle = live ? api.links.find(l => l._tag === 'pull_request').title : `vitejs/vite #${PR.number}`;

  await ab('set', 'viewport', '1280', '900');
  await ab('open', 'http://127.0.0.1:7172/s/links');
  await ab('wait', '--text', 'Filler answer 9');
  await ab('wait', '--fn', `${PILE} && ${PILE}.children.length === 3`);
  // Live status arrives after the first fetch; wait for the PR's real title.
  if (live) await ab('wait', '--fn', `!${PILE}.textContent.includes('Pull request')`);
  await ab('wait', '--fn', `${PILE}.textContent.includes('vitejs/vite #${PR.number}')`);
  await ab('mouse', 'move', '10', '10').catch(() => {});
  observations.collapsed = await evaluate(cards);
  await shot('01-collapsed');
  const c = observations.collapsed;
  assert.equal(c.fanned, false);
  assert.equal(c.count, 3, 'web pages, code links and fenced URLs are not kept');
  // Newest mention in front: the dev server was the last kept link in the final message.
  assert.deepEqual(c.cards.map(x => x.title), ['127.0.0.1:7172', issueTitle, prTitle]);
  assert.equal(c.cards[0].detail, '/s/links');
  // Collapsed: cards behind overlap the front one (only a sliver shows).
  assert.ok(c.cards[1].bottom - c.cards[0].top > 40, JSON.stringify(c.cards.slice(0, 2)));
  assert.equal(c.cards[0].actions.length, 0, 'no actions while collapsed');

  // The empty space beside the pile is not the pile: pointing there leaves it collapsed.
  const beside = await evaluate(`(() => { const r = ${PILE}.getBoundingClientRect(); const m = document.querySelector('main').getBoundingClientRect(); return { x: Math.round((m.left + r.left) / 2), y: Math.round((r.top + r.bottom) / 2) }; })()`);
  await ab('mouse', 'move', String(beside.x), String(beside.y));
  await delay(250);
  observations.beside = { ...beside, fanned: await evaluate(`${PILE}.dataset.fanned === 'true'`) };
  assert.equal(observations.beside.fanned, false, JSON.stringify(observations.beside));

  // Hover fans the pile and reveals the actions.
  await ab('find', 'role', 'link', 'hover', '--name', 'index.ts L10', '--exact=false').catch(async () => { await ab('hover', '[data-slot="link-stack"] li a'); });
  await ab('wait', '--fn', `${PILE}.dataset.fanned === 'true'`);
  await delay(400); // margin transition
  observations.fanned = await evaluate(cards);
  await shot('02-fanned');
  const f = observations.fanned;
  assert.equal(f.fanned, true);
  for (let i = 1; i < f.count; i++) assert.ok(f.cards[i].bottom <= f.cards[i - 1].top, `card ${i} clear of card ${i - 1}: ${JSON.stringify([f.cards[i], f.cards[i - 1]])}`);
  assert.deepEqual(f.cards[0].actions, ['Copy link']);
  observations.prBadges = await evaluate(`[...${PILE}.querySelectorAll('li')].find(li => li.querySelector('a').href.includes('/pull/')).textContent`);

  // Copy: a real click carries the user activation the clipboard needs, and the button says so.
  // (The headless clipboard cannot be read back or pasted from here; the write resolving is the evidence.)
  await ab('click', '[data-slot="link-stack"] li:first-child button[aria-label="Copy link"]');
  await ab('wait', '--fn', `!!document.querySelector('[data-slot="link-stack"] button[aria-label="Copied"]')`);
  await shot('03-copied');
  // A denied clipboard write says so instead of claiming success.
  await evaluate(`window.nativeWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; true`);
  await ab('hover', '[data-slot="link-stack"] li a');
  await ab('wait', '--fn', `!!document.querySelector('[data-slot="link-stack"] li:first-child button[aria-label="Copy link"]')`);
  await ab('click', '[data-slot="link-stack"] li:first-child button[aria-label="Copy link"]');
  await ab('wait', '--fn', `!!document.querySelector('[data-slot="link-stack"] button[aria-label="Couldn’t copy"]')`);
  await evaluate('navigator.clipboard.writeText = window.nativeWrite; true');

  // Keyboard: focusing a card fans the pile too.
  await ab('mouse', 'move', '10', '10').catch(() => {});
  await ab('focus', '[data-slot="link-stack"] li a');
  await ab('wait', '--fn', `${PILE}.dataset.fanned === 'true'`);
  observations.keyboardFanned = true;
  await evaluate(`(() => { document.activeElement.blur(); return true; })()`);
  await ab('wait', '--fn', `${PILE}.dataset.fanned !== 'true'`);

  // Dark mode, fanned.
  await ab('find', 'role', 'button', 'click', '--name', 'Appearance', '--exact');
  await ab('find', 'role', 'menuitemradio', 'click', '--name', 'Dark', '--exact');
  await ab('press', 'Escape').catch(() => {});
  await ab('hover', '[data-slot="link-stack"] li a');
  await ab('wait', '--fn', `${PILE}.dataset.fanned === 'true'`);
  await delay(400);
  await shot('05-dark-fanned');
  await ab('find', 'role', 'button', 'click', '--name', 'Appearance', '--exact');
  await ab('find', 'role', 'menuitemradio', 'click', '--name', 'Light', '--exact');
  await ab('press', 'Escape').catch(() => {});
  await ab('hover', '[data-slot="link-stack"] li a');
  await ab('wait', '--fn', `${PILE}.dataset.fanned === 'true'`);
  await delay(400);
  await shot('05-light-fanned');

  // Phone width: the pile still fits.
  await ab('set', 'viewport', '390', '844');
  await delay(300);
  observations.phone = await evaluate(`(() => { const r = ${PILE}.getBoundingClientRect(); return { left: r.left, right: r.right, innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
  await shot('06-phone');
  assert.ok(observations.phone.right <= observations.phone.innerWidth && !observations.phone.overflow, JSON.stringify(observations.phone));
  observations.ok = true;
} finally {
  await ab('close').catch(() => {});
  backend.kill('SIGTERM'); frontend.kill('SIGTERM');
  writeFileSync(join(evidence, 'observations.json'), JSON.stringify({ revision: execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD']).toString().trim() + ' + working tree', observations }, null, 2));
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(observations, null, 2));
