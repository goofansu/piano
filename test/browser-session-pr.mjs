// Session PR journey: scratch Git/registry/Pi history and a controlled gh boundary, no paid calls.
// node test/browser-session-pr.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const evidence = resolve(process.argv[2] ?? '/tmp/piano-session-pr-evidence/browser');
mkdirSync(evidence, { recursive: true });
const backendPort = process.env.PR_BACKEND_PORT ?? '7171', frontendPort = process.env.PR_FRONTEND_PORT ?? '7172';
const backendUrl = `http://127.0.0.1:${backendPort}`, frontendUrl = `http://127.0.0.1:${frontendPort}`;
const root = mkdtempSync(join(tmpdir(), 'piano-session-pr-browser-'));
const githubHost = process.env.PR_GITHUB_HOST ?? 'github.com';
const repo = join(root, 'repo'), sessions = join(root, 'sessions'), bin = join(root, 'bin');
for (const dir of [repo, sessions, bin, join(root, 'agent')]) mkdirSync(dir);
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args]);
git('init', '-q', '-b', 'feature'); git('commit', '--allow-empty', '-qm', 'Initial'); git('remote', 'add', 'origin', `https://${githubHost}/example/repo.git`);
const forge = join(root, 'forge.json');
const prs = [42, 43].map(number => ({ url: `https://github.com/example/repo/pull/${number}`, number, title: number === 42 ? 'The session deliverable' : 'Explicitly linked work', state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', statusCheckRollup: [], headRefName: number === 42 ? 'feature' : 'other', headRepository: { name: 'repo' }, headRepositoryOwner: { login: 'example' } }));
const control = data => writeFileSync(forge, JSON.stringify({ expectedHost: githubHost, ...(githubHost === 'github.int.exe.xyz' ? { expectedRepo: `${githubHost}/example/repo` } : {}), ...data }));
control({ prs });
writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nimport ${JSON.stringify(resolve('test/fixtures/fake-gh.mjs'))};\n`, { mode: 0o755 });
const timestamp = new Date().toISOString();
for (const id of ['work', 'other']) writeFileSync(join(sessions, `${id}.jsonl`), [
  { type: 'session', version: 3, id, cwd: repo, timestamp },
  { type: 'message', id: 'm0', parentId: null, timestamp, message: { role: 'user', content: 'Research references: https://github.com/unrelated/project/pull/999 and https://github.com/example/repo/issues/1 and http://localhost:9999. These are not session deliverables.', timestamp: 0 } },
].map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: ['work', 'other'].map(id => ({ cwd: repo, sessionId: id, title: id === 'work' ? 'Current work' : 'Other work', createdAt: timestamp, updatedAt: timestamp, archived: false, ...(id === 'other' ? { pullRequest: null } : {}) })) }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PIANO_TEST_GH_FIXTURE: forge, HOST: '127.0.0.1', PORT: backendPort, PIANO_CONFIG: join(root, 'registry.json'), PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', frontendPort, '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
for (const p of [backend, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const browser = `session-pr-${process.pid}`, commands = [], observations = {};
async function ab(...args) {
  const result = await new Promise((res, rej) => {
    const p = spawn('npx', ['agent-browser', '--session', browser, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => p.kill('SIGTERM'), 45000);
    p.on('error', rej); p.on('exit', status => { clearTimeout(timer); res({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result }); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
const evaluate = async code => JSON.parse(await ab('eval', code));
const badge = number => `header a[aria-label="Open pull request #${number}"]`;
const waitBadge = number => ab('wait', '--fn', `!!document.querySelector(${JSON.stringify(badge(number))})`);
const noBadge = () => ab('wait', '--fn', `!document.querySelector('header a[aria-label^="Open pull request"]')`);
const button = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
const openDetails = async () => { await ab('click', '[aria-label="Session information and actions"]'); await ab('find', 'role', 'menuitem', 'click', '--name', 'Pull request', '--exact'); await ab('wait', '--fn', `!!document.querySelector('#session-pr-url:not(:disabled)')`); };
const closeDetails = async () => { await ab('press', 'Escape'); await ab('wait', '--fn', `!document.querySelector('#session-pr-url')`); };
const palette = async search => { await ab('press', 'Control+k'); await ab('fill', '[aria-label="Search sessions and commands"]', search); };
try {
  for (let n = 0; ; n++) {
    if (backend.exitCode !== null || frontend.exitCode !== null) throw new Error(`Scratch startup failed (possibly occupied ports): ${processLog}`);
    try {
      const projects = await (await fetch(`${backendUrl}/api/projects`)).json();
      if (projects.projects?.some(p => p.path === repo) && (await fetch(frontendUrl)).ok) break;
    } catch {}
    if (n > 150) throw new Error(`Scratch startup deadline: ${processLog}`); await delay(100);
  }
  await ab('set', 'viewport', '1280', '900'); await ab('open', `${frontendUrl}/s/work`);
  await ab('wait', '--text', 'These are not session deliverables.'); await waitBadge(42);
  observations.initial = await evaluate(`({ prs: [...document.querySelectorAll('header a[aria-label^="Open pull request"]')].map(a => a.href), pile: !!document.querySelector('[data-slot="link-stack"]') })`);
  assert.deepEqual(observations.initial, { prs: [prs[0].url], pile: false });
  await ab('screenshot', join(evidence, '01-current-pr-desktop.png'));
  // Removal is a durable per-session preference, not a temporary hide.
  await openDetails(); await button('Remove link'); await noBadge(); await ab('reload');
  await ab('wait', '--text', 'These are not session deliverables.'); await noBadge();
  await openDetails(); await ab('wait', '--text', 'Automatic discovery is off.');
  await button('Find from branch'); await waitBadge(42); await closeDetails();
  // Header and palette reach the same control. Invalid URLs fail without changing identity.
  await palette('Pull request'); await ab('click', '[cmdk-item][data-value="Pull request"]');
  await ab('wait', '--fn', `!!document.querySelector('#session-pr-url:not(:disabled)')`);
  await ab('fill', '#session-pr-url', 'https://github.com/example/repo/issues/1'); await button('Link pull request');
  await ab('wait', '--text', 'Enter a GitHub pull request URL.'); await waitBadge(42);
  await ab('fill', '#session-pr-url', prs[1].url + '/files?diff=split#abc'); await button('Link pull request'); await waitBadge(43);
  await ab('wait', '--fn', `!document.querySelector('#session-pr-url')`);
  await palette('Other work'); await ab('click', '[cmdk-item][data-value$=" other"]');
  await ab('wait', '--fn', `location.pathname === '/s/other'`); await noBadge();
  await palette('Current work'); await ab('click', '[cmdk-item][data-value$=" work"]');
  await ab('wait', '--fn', `location.pathname === '/s/work'`); await waitBadge(43);
  await ab('reload'); await waitBadge(43);
  // State lives in the icon/color and accessible description, not a redundant tooltip line.
  observations.prStates = [];
  for (const [label, state, isDraft] of [['Open', 'OPEN', false], ['Draft', 'OPEN', true], ['Merged', 'MERGED', false], ['Closed', 'CLOSED', false]]) {
    control({ prs: prs.map(pr => ({ ...pr, state, isDraft, reviewDecision: '' })) });
    await evaluate(`window.dispatchEvent(new Event('focus')); true`);
    await ab('wait', '--fn', `document.querySelector(${JSON.stringify(badge(43))})?.getAttribute('aria-description') === ${JSON.stringify(label)}`);
    await ab('hover', badge(43));
    await ab('wait', '--fn', `!!document.querySelector('[role="tooltip"]')`);
    assert.equal(await evaluate(`document.querySelector('[role="tooltip"]').textContent`), 'example/repo: Explicitly linked work');
    observations.prStates.push(await evaluate(`(() => { const svg = document.querySelector(${JSON.stringify(badge(43))}).querySelector('svg'); return { state: ${JSON.stringify(label)}, color: getComputedStyle(svg).color, shape: svg.innerHTML }; })()`));
    await ab('screenshot', join(evidence, `state-${label.toLowerCase()}.png`));
    await ab('mouse', 'move', '0', '0');
  }
  assert.equal(new Set(observations.prStates.map(s => s.color)).size, 4);
  assert.equal(new Set(observations.prStates.map(s => s.shape)).size, 4);
  // A failed refresh keeps identity but does not display old approval/check success.
  control({ error: 'offline' }); await openDetails(); await ab('wait', '--text', githubHost === 'github.com' ? 'Could not read GitHub.' : 'Could not read GitHub through exe.dev.');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Approved')`), false);
  await closeDetails(); await waitBadge(43);
  control({ prs });
  await ab('set', 'viewport', '390', '844'); await openDetails();
  await ab('wait', '--text', 'Explicitly linked work');
  observations.mobile = await evaluate(`({ width: innerWidth, scroll: document.documentElement.scrollWidth, dialogScroll: document.querySelector('[role="dialog"]').scrollWidth, dialogWidth: document.querySelector('[role="dialog"]').clientWidth })`);
  assert.ok(observations.mobile.scroll <= observations.mobile.width && observations.mobile.dialogScroll <= observations.mobile.dialogWidth);
  await ab('screenshot', join(evidence, '02-pr-dialog-mobile.png')); await closeDetails();
  await ab('screenshot', join(evidence, '03-current-pr-mobile.png'));
  observations.status = 'pass'; console.log('PASS');
} finally {
  await ab('close').catch(() => {});
  const stopped = [backend, frontend].map(p => new Promise(resolveExit => { if (p.exitCode !== null) return resolveExit(); p.once('exit', resolveExit); p.kill('SIGTERM'); }));
  await Promise.all(stopped);
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'observations.json'), JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim() + ' + working tree', backendPort, frontendPort, githubHost, ...observations }, null, 2));
  writeFileSync(join(evidence, 'processes.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
