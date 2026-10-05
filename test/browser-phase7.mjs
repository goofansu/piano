// Scratch-only Phase 7: real Git/worktrees, fake Pi catalog, no model calls.
// Focused checks: node test/browser-phase7.mjs <evidence-dir> --header-only|--menu-only [--long-labels]
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase7-evidence/browser'); mkdirSync(evidence, { recursive: true });
const headerOnly = process.argv.includes('--header-only');
const menuOnly = process.argv.includes('--menu-only');
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
// Retired Checks data must neither block startup nor be migrated/deleted.
const retiredFiles = [join(root, 'checks.json'), `${registry}.checks.json`, join(`${registry}.evidence`, '00000000-0000-0000-0000-000000000001.json')];
const retiredContent = 'Retired check data, deliberately not valid JSON.\n';
mkdirSync(`${registry}.evidence`);
for (const path of retiredFiles) writeFileSync(path, retiredContent);
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
const menuItem = name => ab('find', 'role', 'menuitem', 'click', '--name', name, '--exact');
const click = async name => {
  // Session actions live in the menu; global navigation stays directly accessible.
  if (name === 'Changes') { await click('Session menu'); return menuItem(name); }
  return ab('find', 'role', 'button', 'click', '--name', name, '--exact');
};
const revision = () => evaluate(`document.querySelector('[data-revision]')?.dataset.revision`);
const complete = () => ab('wait', '--fn', `document.querySelector('[role="dialog"] [role="status"]')?.textContent !== 'Capturing…' && !!document.querySelector('[role="dialog"] [role="status"]')`);
async function capture(name) { writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot')); await ab('screenshot', join(evidence, `${name}.png`)); observations.push(name); }
async function refresh() { await click('Refresh changes'); await complete(); }
// Session metadata stays in the menu; sidebar navigation must not be buried there.
// Keep controls reachable and preserve the screen-reader live status without a visible label.
async function checkHeader() {
  const failures = [];
  for (const width of [390, 320, 430, 768, 1280]) {
    await ab('set', 'viewport', String(width), '844');
    const geometry = await evaluate(`(() => {
      const header = document.querySelector('main header'), status = header.querySelector('[role="status"]');
      const box = e => { const r = e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
      return { width:innerWidth, header:box(header), status:box(status), statusText:status.textContent,
        remainingText:header.textContent.replace(status.textContent,'').trim(),
        controls:[...header.querySelectorAll('button')].filter(e=>box(e).width>0).map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),...box(e),
          clickable:e.contains(document.elementFromPoint((box(e).left+box(e).right)/2,(box(e).top+box(e).bottom)/2))})) };
    })()`);
    writeFileSync(join(evidence, `header-${width}.json`), JSON.stringify(geometry, null, 2)); await capture(`header-${width}`);
    if (geometry.header.height > 56) failures.push(`${width}: an extra header row remains`);
    if (geometry.status.height > 1 || geometry.status.width > 1) failures.push(`${width}: status is still visible outside the menu`);
    assert.equal(geometry.statusText, 'Not running', 'Live status remains available to assistive technology');
    assert.equal(geometry.remainingText, '', 'All visible session labels belong in the menu');
    assert.deepEqual(geometry.controls.map(c=>c.name), width < 768 ? ['Show sidebar', 'Session menu'] : ['Session menu'], 'Navigation is separate from session actions');
    for (const control of geometry.controls) if (control.left < geometry.header.left || control.right > geometry.header.right + 1 || control.top < geometry.header.top || control.bottom > geometry.header.bottom + 1 || !control.clickable) failures.push(`${width}: ${control.name} is outside/obscured`);
  }
  writeFileSync(join(evidence, 'header-failures.json'), JSON.stringify(failures, null, 2));
  assert.deepEqual(failures, [], 'Navigation and session controls stay accessible in a compact header');
  await click('Hide sidebar'); await click('Show sidebar');
  await ab('wait', '--fn', `!!document.querySelector('aside button[title="Session A"]')`);
  // Actions still work on the narrowest viewport, including pointer-triggered UI.
  await ab('set', 'viewport', '320', '844'); await click('Changes'); await complete(); await ab('wait', '--text', 'WORKSPACE_A'); await click('Close');
  await click('Session menu'); await ab('find', 'role', 'menuitemcheckbox', 'click', '--name', 'End-of-turn messages only', '--exact');
  await click('Session menu');
  assert.equal(await evaluate(`document.querySelector('[role="menuitemcheckbox"]').getAttribute('aria-checked')`), 'true');
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.includes('Show sidebar'))`), false);
  await ab('press', 'Escape');
  await click('Show sidebar'); await ab('wait', '--fn', `!!document.querySelector('[role="dialog"] nav[aria-label="Projects"]')`);
  await ab('press', 'Escape');
  await ab('wait', '--fn', `document.activeElement?.getAttribute('aria-label') === 'Show sidebar'`);
}
async function checkSessionMenu() {
  const facts = () => evaluate(`(() => {const info=document.querySelector('[aria-label="Session information"]');return {text:info.textContent,values:Object.fromEntries([...info.querySelectorAll('dt')].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]))};})()`);
  const focusReturned = () => ab('wait', '--fn', `document.activeElement?.getAttribute('aria-label') === 'Session menu'`);
  await ab('set', 'viewport', '390', '844'); await click('Session menu');
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].some(item=>item.textContent.trim()==='Checks')`), false);
  let info = await facts(); assert.ok(info.text.includes('Session A') && info.text.includes(repo) && info.text.includes(branchName) && info.text.includes('workspace-a'));
  assert.equal(info.values['Session model'], 'Not recorded'); assert.equal(info.values['Context'], 'Unavailable'); assert.equal(info.values['Session cost'], 'Unavailable');
  await capture('session-menu-unknown-not-zero');
  for (const [width, height] of [[320, 568], [390, 844], [768, 320], [1280, 844]]) {
    await ab('set', 'viewport', String(width), String(height));
    await ab('wait', '--fn', `(() => {const r=document.querySelector('[role="menu"]')?.getBoundingClientRect();return r && r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1;})()`);
    await capture(`session-menu-${width}x${height}`);
    if (height === 320) {
      await menuItem('Changes'); await complete(); await ab('wait', '--text', 'WORKSPACE_A'); await click('Close'); await focusReturned();
      await click('Session menu');
    }
  }
  await ab('press', 'Escape'); await focusReturned();
  await ab('press', 'Enter'); await ab('wait', '--fn', `!!document.querySelector('[role="menu"]')`); await ab('press', 'Escape'); await focusReturned();
  await click('Changes'); await complete(); await ab('wait', '--text', 'WORKSPACE_A'); await click('Close'); await focusReturned();
  await click('Session menu'); await menuItem('Delete session…'); await ab('wait', '--text', 'Delete this session?');
  assert.equal(JSON.parse(readFileSync(registry, 'utf8')).sessions.length, 2);
  await capture('delete-confirmation'); await click('Cancel'); await focusReturned();
  // The browser Back action changes selection while the menu is still open.
  await ab('click', 'button[title="Session B"]'); await click('Session menu');
  info = await facts(); assert.ok(info.text.includes(checkout) && info.text.includes('workspace-b')); assert.ok(!info.text.includes('workspace-a'));
  await ab('back'); await ab('wait', '--fn', `location.pathname==='/s/workspace-a' && !!document.querySelector('main header [aria-label="Session menu"]') && !document.querySelector('[role="menu"]')`);
  await capture('selection-closes-old-menu');
  await ab('fill', 'textarea[aria-label="Message"]', 'menu facts'); await click('Send'); await ab('wait', '--text', 'echo: menu facts');
  await ab('wait', '--fn', `document.querySelector('main header [role="status"]')?.textContent==='Ready'`);
  await click('Session menu'); await ab('wait', '--fn', `document.querySelector('[aria-label="Session information"]')?.textContent.includes('$0.02')`);
  info = await facts(); assert.equal(info.values['Session model'], 'fake/alpha'); assert.equal(info.values['Effort'], 'medium'); assert.equal(info.values['Context'], '2k tokens');
  assert.equal(info.values['Session cost'], '$0.02'); assert.ok(info.text.includes('Ready')); await capture('live-session-facts');
  await ab('press', 'Escape');
  // Retention actions use the existing server contract and affect only their own session.
  await ab('click', 'button[title="Session B"]'); await click('Session menu'); await menuItem('Archive session'); await ab('wait', '--text', 'What should we work on?');
  assert.equal(JSON.parse(readFileSync(registry, 'utf8')).sessions.find(s=>s.sessionId==='workspace-b').archived, true);
  // The new-session page retains Changes, but no custom check runner.
  assert.equal(await evaluate(`[...document.querySelectorAll('main button')].some(button=>button.textContent.trim()==='Checks')`), false);
  await ab('find', 'role', 'button', 'click', '--name', 'Changes', '--exact'); await complete(); await ab('wait', '--text', 'WORKSPACE_B'); await click('Close');
  await ab('wait', '--fn', `document.activeElement?.textContent.trim()==='Changes'`);
  await ab('click', 'button[title="Session A"]'); await click('Session menu'); await menuItem('Delete session…'); await click('Delete session');
  await ab('wait', '--text', 'What should we work on?');
  const remaining = JSON.parse(readFileSync(registry, 'utf8')).sessions;
  assert.equal(remaining.length, 1); assert.equal(remaining[0].sessionId, 'workspace-b'); assert.equal(remaining[0].archived, true);
  await capture('retention-actions-complete');
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok && (await fetch('http://127.0.0.1:7171/api/projects')).ok) break; } catch {}
    if (n === 99) throw new Error('scratch startup deadline'); await delay(100);
  }
  const workspaceId = JSON.parse(readFileSync(registry, 'utf8')).workspaces.find(w => w.path === repo).id;
  const removedRoutes = [];
  for (const [method, path] of [['GET', '/api/workspace/checks'], ['POST', '/api/workspace/checks/run'], ['POST', '/api/workspace/checks/cancel']]) {
    const response = await fetch(`http://127.0.0.1:7171${path}?workspaceId=${workspaceId}`, { method, headers: { Accept: 'application/json' } });
    removedRoutes.push({ method, path, status: response.status });
    assert.equal(response.status, 404, 'the retired check runner must not remain callable');
  }
  writeFileSync(join(evidence, 'removed-checks-api.json'), JSON.stringify(removedRoutes, null, 2));
  await ab('open', 'http://127.0.0.1:7172/s/workspace-a'); await ab('wait', '--text', 'Session A');
  if (menuOnly) {
    await checkSessionMenu();
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, node: process.version }, null, 2));
    console.log('PASS: session menu information, keyboard/focus, workspace selection and retention actions');
  } else if (headerOnly) {
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
  for (const path of retiredFiles) assert.equal(readFileSync(path, 'utf8'), retiredContent, 'saved Checks files remain untouched');
} finally {
  try { await ab('close'); } catch {}
  for (const p of [server, frontend]) if (p.exitCode === null) { const ended = new Promise(resolve => p.once('exit', resolve)); p.kill('SIGTERM'); await ended; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); writeFileSync(join(evidence, 'process.log'), processLog);
  // Restore a deliberately removed worktree marker even when an assertion fails.
  try { renameSync(join(root, 'worktree-git-backup'), join(checkout, '.git')); } catch {}
  git(repo, 'worktree', 'remove', '--force', checkout); git(repo, 'branch', '-D', 'second');
  rmSync(root, { recursive: true, force: true });
}
