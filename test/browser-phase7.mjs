// Scratch-only Phase 7: real Git/worktrees, fake Pi catalog, no model calls.
// Focused header regression: node test/browser-phase7.mjs <evidence-dir> --header-only [--long-labels]
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase7-evidence/browser'); mkdirSync(evidence, { recursive: true });
const headerOnly = process.argv.includes('--header-only');
const longLabels = process.argv.includes('--long-labels');
const projectName = longLabels ? 'project-with-an-extraordinarily-long-name' : 'repo';
const branchName = longLabels ? 'feature/session-header-with-long-workspace-labels' : 'main';
const root = mkdtempSync(join(tmpdir(), 'piano-browser-phase7-')), repo = join(root, projectName), checkout = join(root, 'checkout'), registry = join(root, 'registry.json');
for (const path of [repo, 'home', 'config', 'agent', 'sessions'].map(p => p === repo ? p : join(root, p))) mkdirSync(path, { recursive: true });
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(repo, 'init', '-q', '-b', branchName); writeFileSync(join(repo, 'source.txt'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
git(repo, 'worktree', 'add', '-b', 'second', checkout);
writeFileSync(join(repo, 'source.txt'), 'WORKSPACE_A\n'); git(repo, 'add', 'source.txt');
writeFileSync(join(checkout, 'source.txt'), 'WORKSPACE_B\n');
const original = { projects: [repo], worktrees: [{ project: repo, path: checkout, branch: 'old-name' }], sessions: [
  { cwd: repo, sessionId: 'workspace-a', title: 'Session A', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', archived: false },
  { cwd: checkout, sessionId: 'workspace-b', title: 'Session B', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', archived: false },
] };
writeFileSync(registry, JSON.stringify(original));
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry,
  PIANO_PI_CLI: resolve('test/fake-pi.mjs'), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = ''; for (const p of [server, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const session = `phase7-${process.pid}`, commands = [], observations = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '20000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result }); assert.equal(result.status, 0, `agent-browser ${args[0]}: ${result.stderr || result.stdout}`); return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const click = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
const revision = () => evaluate(`document.querySelector('[data-revision]')?.dataset.revision`);
const complete = () => ab('wait', '--fn', `document.querySelector('[role="dialog"] [role="status"]')?.textContent !== 'Capturing…' && !!document.querySelector('[role="dialog"] [role="status"]')`);
async function capture(name) { writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot')); await ab('screenshot', join(evidence, `${name}.png`)); observations.push(name); }
async function refresh() { await click('Refresh changes'); await complete(); }
// A focused geometry gate: viewport overflow alone misses text clipped inside the
// header's own flex items. Exercise the actual session view, not a CSS fixture.
async function checkHeader() {
  const failures = [];
  for (const width of [390, 320, 430, 768, 1280]) {
    await ab('set', 'viewport', String(width), '844');
    const geometry = await evaluate(`(() => {
      const header = document.querySelector('main header'), status = header.querySelector('[role="status"]');
      const box = e => { const r = e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
      const visibleWidth = e => {
        let {left,right} = box(e);
        for (let p=e.parentElement;p;p=p.parentElement) if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX)) { const r=box(p);left=Math.max(left,r.left);right=Math.min(right,r.right); }
        return Math.max(0,right-left);
      };
      const text = label => [...header.querySelectorAll('span')].find(e => e.textContent.trim()===label && ![...e.children].some(c=>c.textContent.trim()===label));
      return { width:innerWidth, header:box(header), status:box(status), statusLineHeight:parseFloat(getComputedStyle(status).lineHeight),
        labels:${JSON.stringify([projectName, branchName])}.map(label=>{const e=text(label);return {label,visible:e?visibleWidth(e):0,width:e?box(e).width:0,
          truncated:e?e.scrollWidth>e.clientWidth:false,ellipsis:e?getComputedStyle(e).textOverflow==='ellipsis':false};}),
        controls:[...header.querySelectorAll('button')].filter(e=>box(e).width>0).map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),...box(e),
          clickable:e.contains(document.elementFromPoint((box(e).left+box(e).right)/2,(box(e).top+box(e).bottom)/2))})) };
    })()`);
    writeFileSync(join(evidence, `header-${width}.json`), JSON.stringify(geometry, null, 2)); await capture(`header-${width}`);
    if (geometry.status.height > geometry.statusLineHeight + 1) failures.push(`${width}: status wraps into multiple lines`);
    for (const label of geometry.labels) {
      if (label.visible < Math.min(label.width, 24) - 1 || label.width === 0) failures.push(`${width}: ${label.label} is clipped out of the header (${label.visible}px visible)`);
      if (label.truncated && !label.ellipsis) failures.push(`${width}: ${label.label} clips instead of truncating`);
    }
    for (const control of geometry.controls) if (control.left < geometry.header.left || control.right > geometry.header.right + 1 || control.top < geometry.header.top || control.bottom > geometry.header.bottom + 1 || !control.clickable) failures.push(`${width}: ${control.name} is outside/obscured`);
  }
  writeFileSync(join(evidence, 'header-failures.json'), JSON.stringify(failures, null, 2));
  assert.deepEqual(failures, [], 'Session identity, one-line status and controls must remain visible within the header');
  // Actions still work on the narrowest viewport, including pointer-triggered UI.
  await ab('set', 'viewport', '320', '844'); await click('Changes'); await complete(); await ab('wait', '--text', 'WORKSPACE_A'); await click('Close');
  await click('End-of-turn messages only');
  assert.equal(await evaluate(`document.querySelector('[aria-label="End-of-turn messages only"]').getAttribute('aria-pressed')`), 'true');
  await click('Show sidebar'); await ab('wait', '--fn', `!!document.querySelector('[role="dialog"] nav[aria-label="Projects"]')`);
  await ab('press', 'Escape');
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok && (await fetch('http://127.0.0.1:7171/api/projects')).ok) break; } catch {}
    if (n === 99) throw new Error('scratch startup deadline'); await delay(100);
  }
  await ab('open', 'http://127.0.0.1:7172/s/workspace-a'); await ab('wait', '--text', 'Session A');
  if (headerOnly) {
    await checkHeader();
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, node: process.version }, null, 2));
    console.log(`PASS: session header visibility and actions at 320–1280px`);
  } else {
  await click('Changes'); await complete(); await ab('wait', '--text', 'WORKSPACE_A');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(repo)})`), true);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('WORKSPACE_B')`), false);
  const a = await revision(); assert.ok(a.startsWith('v1-')); await capture('workspace-a-staged'); await click('Close');
  await ab('click', 'button[title="Session B"]'); await click('Changes'); await complete(); await ab('wait', '--text', 'WORKSPACE_B');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(checkout)})`), true);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('WORKSPACE_A')`), false);
  const b = await revision(); assert.notEqual(a, b); await capture('workspace-b-unstaged');
  writeFileSync(join(checkout, 'source.txt'), 'B_EXTERNALLY_EDITED\n'); await refresh(); await ab('wait', '--text', 'B_EXTERNALLY_EDITED');
  const edited = await revision(); assert.notEqual(edited, b); await capture('external-edit-refreshed');
  git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'external change'); git(checkout, 'checkout', '--detach');
  await refresh(); await ab('wait', '--text', 'Detached HEAD'); await ab('wait', '--text', 'No changes in capture scope.');
  assert.notEqual(await revision(), edited); await capture('external-checkout-refreshed');
  renameSync(join(checkout, '.git'), join(root, 'worktree-git-backup')); await refresh(); await ab('wait', '--text', 'Capture failed');
  assert.equal(await evaluate(`!!document.querySelector('[data-revision]')`), false);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('No changes in capture scope.')`), false);
  await capture('capture-failure-not-clean'); renameSync(join(root, 'worktree-git-backup'), join(checkout, '.git'));
  await refresh(); await ab('wait', '--text', 'No changes in capture scope.'); await capture('capture-recovery'); await click('Close');
  await ab('click', 'button[title="Session A"]'); await click('Changes'); await complete(); assert.equal(await revision(), a); await capture('return-to-a-unaffected');
  await ab('click', '[aria-label="Captured changes"] > details > summary'); await ab('click', '[aria-label="Captured changes"] details details > summary'); await capture('versioned-manifest');
  await ab('set', 'viewport', '390', '844'); await capture('mobile-inspector');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  await click('Close'); await ab('reload'); await ab('wait', '--text', 'Not running'); await click('Changes'); await complete(); assert.equal(await revision(), a);
  await click('Close'); await checkHeader();
  const data = JSON.parse(readFileSync(registry, 'utf8'));
  assert.equal(data.version, 1); assert.equal(data.workspaces.length, 2); assert.equal(data.sessions.length, 2); assert.deepEqual(data.sessions, original.sessions);
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, root, node: process.version, git: git(repo, '--version'), registry: data, revisions: { a, b, edited } }, null, 2));
  console.log(`PASS: ${observations.join(', ')}`);
  }
} finally {
  try { await ab('close'); } catch {}
  for (const p of [server, frontend]) if (p.exitCode === null) { const ended = new Promise(resolve => p.once('exit', resolve)); p.kill('SIGTERM'); await ended; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); writeFileSync(join(evidence, 'process.log'), processLog);
  // Restore a deliberately removed worktree marker even when an assertion fails.
  try { renameSync(join(root, 'worktree-git-backup'), join(checkout, '.git')); } catch {}
  git(repo, 'worktree', 'remove', '--force', checkout); git(repo, 'branch', '-D', 'second');
  rmSync(root, { recursive: true, force: true });
}
