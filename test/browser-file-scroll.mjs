// Regression: long file previews scroll without hiding the dialog's actions.
// node test/browser-file-scroll.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '.scratch/file-scroll/evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-file-scroll-'));
const repo = join(root, 'repo'), sessions = join(root, 'sessions');
for (const dir of [repo, sessions, join(root, 'agent')]) mkdirSync(dir);
execFileSync('git', ['init', '-q', repo]);
const timestamp = new Date().toISOString();
const links = [];
for (const extension of ['md', 'txt']) {
  const name = `long.${extension}`, path = join(repo, name);
  writeFileSync(path, Array.from({ length: 150 }, (_, i) => `Paragraph ${i}: readable file preview content.\n`).join('\n') + '\nSCROLL END MARKER\n');
  links.push(`[${name}](${pathToFileURL(path).href})`);
}
writeFileSync(join(sessions, 'file-scroll.jsonl'), [
  { type: 'session', version: 3, id: 'file-scroll', cwd: repo, timestamp },
  { type: 'message', id: 'm0', parentId: null, timestamp, message: { role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'alpha', stopReason: 'stop', timestamp: 0, content: [{ type: 'text', text: links.join('\n\n') }] } },
].map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: [{ cwd: repo, sessionId: 'file-scroll', title: 'File scroll check', createdAt: timestamp, updatedAt: timestamp, archived: false }] }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '7171', ...registryEnv(join(root, 'registry.json')), PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const session = `file-scroll-${process.pid}`, commands = [], observations = [];
async function ab(...args) {
  const result = await new Promise((resolveResult, reject) => {
    const p = spawn('npx', ['agent-browser', '--session', session, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => p.kill('SIGTERM'), 35000);
    p.on('error', reject); p.on('exit', status => { clearTimeout(timer); resolveResult({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
let outcome = 'failed';
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null, processLog); assert.equal(frontend.exitCode, null, processLog);
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (n === 99) throw new Error('Startup deadline'); await delay(100);
  }
  await ab('open', 'http://127.0.0.1:7172/s/file-scroll');
  await ab('wait', '--text', 'long.md');
  for (const [width, height] of [[1440, 900], [390, 700]]) {
    await ab('set', 'viewport', String(width), String(height));
    for (const extension of ['md', 'txt']) {
      await ab('click', `a[data-file-href$="long.${extension}"]`);
      await ab('wait', '--text', 'SCROLL END MARKER');
      // Locate the actual overflow container, independently of its component/classes.
      const before = await evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const body = [...dialog.querySelectorAll('*')].find(e => ['auto','scroll'].includes(getComputedStyle(e).overflowY) && e.textContent.includes('SCROLL END MARKER'));
        body.id = 'file-scroll-body';
        const d = dialog.getBoundingClientRect(), f = dialog.querySelector('[data-slot="dialog-footer"]').getBoundingClientRect();
        return { client: body.clientHeight, content: body.scrollHeight, footerVisible: f.top >= d.top && f.bottom <= d.bottom && f.bottom <= innerHeight, dialogVisible: d.top >= 0 && d.bottom <= innerHeight, pageFits: document.documentElement.scrollWidth <= innerWidth };
      })()`);
      observations.push({ width, extension, before });
      await ab('screenshot', join(evidence, `${width}-${extension}-before.png`));
      assert.ok(before.footerVisible, `preview must not clip Close/Download: ${JSON.stringify(before)}`);
      assert.ok(before.client > 0 && before.content > before.client, 'long preview must have a bounded scrollable viewport');
      assert.ok(before.dialogVisible && before.pageFits, 'dialog must fit the viewport');
      await ab('scroll', 'down', '100000', '--selector', '#file-scroll-body');
      await ab('wait', '--fn', `(() => { const e = document.querySelector('#file-scroll-body'); return e.scrollTop > 0 && e.scrollHeight - e.clientHeight - e.scrollTop < 2; })()`);
      const end = await evaluate(`(() => {
        const body = document.querySelector('#file-scroll-body');
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode())) { const index = node.textContent.indexOf('SCROLL END MARKER'); if (index < 0) continue;
          const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 17);
          const r = range.getBoundingClientRect(), b = body.getBoundingClientRect();
          return { visible: r.top >= b.top && r.bottom <= b.bottom, scrollTop: body.scrollTop };
        }
      })()`);
      observations.at(-1).end = end;
      assert.ok(end.visible, 'last line is visibly reachable, not clipped by dialog');
      await ab('screenshot', join(evidence, `${width}-${extension}-end.png`));
      await ab('click', '[data-slot="dialog-footer"] button');
      await ab('wait', '--fn', `document.querySelector('[role="dialog"]') === null`);
    }
  }
  outcome = 'passed';
  console.log('PASS: long Markdown/text previews scroll to last line; actions visible on desktop/mobile');
} finally {
  try { await ab('close'); } catch {}
  for (const p of [backend, frontend]) if (p.exitCode === null) { const stopped = new Promise(done => p.once('exit', done)); p.kill('SIGTERM'); await stopped; }
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ outcome, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: true, node: process.version, modelCalls: 0, observations }, null, 2));
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
