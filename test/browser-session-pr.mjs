// Session PR journey: scratch Git/registry/Pi history and a controlled gh boundary, no paid calls.
// node test/browser-session-pr.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-session-pr-evidence/browser');
mkdirSync(evidence, { recursive: true });
const backendPort = process.env.PR_BACKEND_PORT ?? '7171', frontendPort = process.env.PR_FRONTEND_PORT ?? '7172';
const backendUrl = `http://127.0.0.1:${backendPort}`, frontendUrl = `http://127.0.0.1:${frontendPort}`;
const root = mkdtempSync(join(tmpdir(), 'piano-session-pr-browser-'));
const githubHost = process.env.PR_GITHUB_HOST ?? 'github.com';
const repo = join(root, 'a-very-long-workspace-name-for-header-truncation'), plain = join(root, 'plain'), sessions = join(root, 'sessions'), bin = join(root, 'bin');
for (const dir of [repo, plain, sessions, bin, join(root, 'agent')]) mkdirSync(dir);
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args]);
const branch = 'feature/a-very-long-branch-name-that-must-not-push-the-pr-control-away';
git('init', '-q', '-b', branch); git('commit', '--allow-empty', '-qm', 'Initial'); git('remote', 'add', 'origin', `https://${githubHost}/example/repo.git`);
const forge = join(root, 'forge.json');
const prs = [42, 43].map(number => ({ url: `https://github.com/example/repo/pull/${number}`, number, title: number === 42 ? 'The session deliverable' : 'Explicitly linked work', state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }], headRefName: number === 42 ? branch : 'other', headRepository: { name: 'repo' }, headRepositoryOwner: { login: 'example' } }));
const control = data => writeFileSync(forge, JSON.stringify({ expectedHost: githubHost, ...(githubHost === 'github.int.exe.xyz' ? { expectedRepo: `${githubHost}/example/repo` } : {}), ...data }));
control({ prs });
writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nimport ${JSON.stringify(resolve('test/fixtures/fake-gh.mjs'))};\n`, { mode: 0o755 });
const timestamp = new Date().toISOString();
for (const id of ['work', 'other', 'notes']) writeFileSync(join(sessions, `${id}.jsonl`), [
  { type: 'session', version: 3, id, cwd: id === 'notes' ? plain : repo, timestamp },
  { type: 'message', id: 'm0', parentId: null, timestamp, message: { role: 'user', content: 'Research references: https://github.com/unrelated/project/pull/999 and https://github.com/example/repo/issues/1 and http://localhost:9999. These are not session deliverables.', timestamp: 0 } },
].map(JSON.stringify).join('\n') + '\n');
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo, plain], worktrees: [], sessions: ['work', 'other', 'notes'].map(id => ({ cwd: id === 'notes' ? plain : repo, sessionId: id, title: id === 'work' ? 'Current work' : id === 'other' ? 'Other work' : 'Notes', createdAt: timestamp, updatedAt: timestamp, archived: false, ...(id === 'other' ? { pullRequest: null } : {}) })) }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PIANO_TEST_GH_FIXTURE: forge, HOST: '127.0.0.1', PORT: backendPort, ...registryEnv(join(root, 'registry.json')), PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
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
const badge = number => `header button[aria-label="Pull request #${number}"]`;
const waitBadge = number => ab('wait', '--fn', `!!document.querySelector(${JSON.stringify(badge(number))})`);
const noBadge = () => ab('wait', '--fn', `!document.querySelector('header button[aria-label^="Pull request #"]')`);
const button = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
const popover = '[data-slot="popover-content"][aria-labelledby]';
const waitDetails = () => ab('wait', '--fn', `!!document.querySelector('${popover}[data-state="open"]')`);
const openDetails = async () => { await ab('click', 'header [data-slot="popover-trigger"]'); await waitDetails(); };
const closeDetails = async () => { await ab('press', 'Escape'); await ab('wait', '--fn', `!document.querySelector('${popover}')`); };
const editLink = async () => { await button('Change link'); await ab('wait', '--fn', `document.activeElement?.id === 'session-pr-url'`); };
const palette = async search => { await ab('press', process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await ab('fill', '[aria-label="Search sessions and commands"]', search); };
try {
  for (let n = 0; ; n++) {
    if (backend.exitCode !== null || frontend.exitCode !== null) throw new Error(`Scratch startup failed (possibly occupied ports): ${processLog}`);
    try {
      const projects = await (await fetch(`${backendUrl}/api/projects`)).json();
      if (projects.projects?.some(p => p.path === repo) && (await fetch(frontendUrl)).ok) break;
    } catch {}
    if (n > 150) throw new Error(`Scratch startup deadline: ${processLog}`); await delay(100);
  }
  // HTTP boundary: only a registered workspace/session pair can be read or changed.
  const projects = (await (await fetch(`${backendUrl}/api/projects`)).json()).projects;
  const workspaceId = projects.flatMap(p => p.sessions).find(s => s.sessionId === 'work').workspaceId;
  const plainId = projects.flatMap(p => p.sessions).find(s => s.sessionId === 'notes').workspaceId;
  const endpoint = params => `${backendUrl}/api/session/pull-request?${new URLSearchParams(params)}`;
  observations.identityChecks = [];
  for (const method of ['GET', 'PUT']) {
    for (const [params, status] of [
      [{ sessionId: 'work', cwd: repo }, 400],
      [{ workspaceId: 'missing', sessionId: 'work' }, 404],
      [{ workspaceId: plainId, sessionId: 'work' }, 404],
      [{ workspaceId, sessionId: 'missing' }, 404],
    ]) {
      const response = await fetch(endpoint(params), { method, ...(method === 'PUT' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove' }) } : {}) });
      assert.equal(response.status, status);
      const body = await response.text(); assert.ok(!body.includes(repo) && !body.includes(plain));
      observations.identityChecks.push({ method, status });
    }
  }
  // An extra caller-supplied path cannot redirect a valid ID pair to another workspace.
  const own = await (await fetch(endpoint({ workspaceId, sessionId: 'work', cwd: plain }))).json();
  assert.equal(own.pullRequest?.number, 42);
  const notes = await fetch(endpoint({ workspaceId: plainId, sessionId: 'notes' }), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'link', url: prs[1].url }) });
  assert.equal(notes.status, 200); assert.equal((await notes.json()).link?.url, prs[1].url);
  await ab('set', 'viewport', '1280', '900'); await ab('open', `${frontendUrl}/s/work`);
  await ab('wait', '--text', 'These are not session deliverables.'); await waitBadge(42);
  observations.metadataLayout = await evaluate(`(() => {
    const [path, branch] = document.querySelectorAll('header p[title]');
    const p = path.getBoundingClientRect(), b = branch.getBoundingClientRect();
    return { pathWidth: p.width, branchWidth: b.width, gap: b.left - p.right,
      truncated: [...branch.querySelectorAll('span')].some(s => s.scrollWidth > s.clientWidth) };
  })()`);
  assert.ok(observations.metadataLayout.pathWidth <= 192 && observations.metadataLayout.branchWidth <= 192, 'Metadata has capped widths');
  assert.equal(observations.metadataLayout.gap, 12, 'Path and branch stay grouped with their original spacing');
  assert.equal(observations.metadataLayout.truncated, true, 'Long branch is truncated');
  await ab('hover', badge(42));
  await ab('wait', '--fn', `!!document.querySelector('[role="tooltip"]')`);
  assert.equal(await evaluate(`document.querySelector('[role="tooltip"]').textContent`), 'The session deliverable', 'Hover shows only the title, not status/checks/review');
  await ab('mouse', 'move', '0', '0');
  const refreshGate = { operation: 'view', started: join(root, 'refresh-started'), release: join(root, 'refresh-release') };
  control({ prs, gate: refreshGate });
  await openDetails();
  for (let n = 0; !existsSync(refreshGate.started); n++) { assert.ok(n < 100, 'Status refresh started'); await delay(50); }
  assert.equal(await evaluate(`[...document.querySelectorAll('${popover} button')].filter(b => ['Change link', 'Remove link'].includes(b.textContent)).every(b => !b.disabled)`), true, 'Background status refresh must not disable link actions');
  writeFileSync(refreshGate.release, 'release');
  control({ prs });
  await editLink();
  assert.equal(await evaluate(`document.querySelector('#session-pr-url').value`), prs[0].url, 'Editing remains available after a background refresh');
  await button('Cancel');
  observations.backgroundRefreshActions = 'pass';
  assert.equal(await evaluate(`!!document.querySelector('#session-pr-url')`), false, 'Linked PR opens details, not a form');
  assert.equal(await evaluate(`document.querySelector('${popover}').contains(document.activeElement)`), true);
  await ab('wait', '--text', 'The session deliverable');
  assert.equal(await evaluate(`document.querySelector('${popover}').textContent.includes('Checks passed') && document.querySelector('${popover}').textContent.includes('Approved')`), true);
  assert.equal(await evaluate(`document.querySelector('${popover} [data-slot="popover-title"] a').href`), prs[0].url, 'PR title is the primary link');
  assert.equal(await evaluate(`document.querySelector('${popover} [data-slot="badge"]').textContent`), 'Open');
  assert.equal(await evaluate(`document.querySelector('${popover} [data-slot="popover-header"]').textContent.includes('example/repo')`), true);
  await ab('screenshot', join(evidence, '00-pr-popover-desktop.png'));
  await editLink();
  assert.equal(await evaluate(`document.querySelector('#session-pr-url').value`), prs[0].url);
  await ab('fill', '#session-pr-url', prs[1].url);
  await evaluate(`window.dispatchEvent(new Event('focus')); true`);
  await ab('wait', '--fn', `!document.querySelector('button[type="submit"]')?.disabled`);
  assert.equal(await evaluate(`document.querySelector('#session-pr-url').value`), prs[1].url, 'Refresh preserves the edit draft');
  await button('Cancel');
  assert.equal(await evaluate(`!!document.querySelector('#session-pr-url')`), false);
  assert.equal(await evaluate(`document.querySelector('${popover}').contains(document.activeElement)`), true, 'Cancel keeps keyboard focus in details');
  await closeDetails();
  assert.equal(await evaluate(`document.activeElement?.getAttribute('data-slot')`), 'popover-trigger');
  await ab('click', '[aria-label="Session information and actions"]');
  assert.equal(await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].some(n => n.textContent === 'Pull request')`), false);
  await ab('find', 'role', 'menuitem', 'click', '--name', 'Rename', '--exact');
  await ab('wait', '--fn', `!!document.querySelector('input[aria-label="Session name"]')`);
  observations.renameFocus = await evaluate(`(() => { const input = document.querySelector('input[aria-label="Session name"]'); return { focused: document.activeElement === input, selected: input.selectionStart === 0 && input.selectionEnd === input.value.length }; })()`);
  assert.deepEqual(observations.renameFocus, { focused: true, selected: true });
  await button('Cancel');
  observations.initial = await evaluate(`({ prs: [...document.querySelectorAll('header button[aria-label^="Pull request #"]')].map(b => b.textContent.trim()), links: document.querySelectorAll('header a').length })`);
  assert.deepEqual(observations.initial, { prs: ['#42'], links: 0 });
  observations.desktopPR = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(badge(42))}), r = button.getBoundingClientRect();
    const title = document.querySelector('header h1').getBoundingClientRect();
    const metadata = document.querySelector('header p[title]').getBoundingClientRect();
    return { height: r.height, center: r.top + r.height / 2, rowsCenter: (title.top + metadata.bottom) / 2, icons: button.querySelectorAll('svg').length };
  })()`);
  assert.equal(observations.desktopPR.height, 40);
  assert.equal(observations.desktopPR.icons, 1, 'One PR icon, no chevron');
  assert.ok(Math.abs(observations.desktopPR.center - observations.desktopPR.rowsCenter) < 2, 'Desktop PR spans and centers across both header rows');
  await ab('screenshot', join(evidence, '01-current-pr-desktop.png'));
  // Removal is a durable per-session preference, not a temporary hide.
  await openDetails(); await button('Remove link'); await noBadge(); await ab('reload');
  await ab('wait', '--text', 'These are not session deliverables.'); await noBadge();
  assert.equal(await evaluate(`document.querySelector('header [data-slot="popover-trigger"]').textContent.trim()`), 'PR');
  assert.equal(await evaluate(`document.querySelector('header').textContent.includes('No PR')`), false);
  await openDetails();
  await ab('wait', '--fn', `!!document.querySelector('#session-pr-url')`);
  await button('Find PR from branch'); await waitBadge(42);
  assert.equal(await evaluate(`!!document.querySelector('#session-pr-url')`), false, 'Discovery shows details without a form');
  assert.equal(await evaluate(`document.querySelector('${popover}').contains(document.activeElement)`), true, 'Discovery keeps keyboard focus in details');
  await closeDetails();
  // Header and palette reach the same control. Invalid URLs fail without changing identity.
  await palette('Pull request'); await ab('click', '[cmdk-item][data-value="PR"]');
  await waitDetails();
  assert.equal(await evaluate(`document.querySelector('${popover}').contains(document.activeElement)`), true, 'Palette moves focus into the popover');
  await editLink();
  await ab('fill', '#session-pr-url', 'https://github.com/example/repo/issues/1'); await button('Save link');
  await ab('wait', '--fn', `document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent.includes('Enter a GitHub pull request URL.')`); await waitBadge(42);
  assert.equal(await evaluate(`document.querySelector('#session-pr-url').value`), 'https://github.com/example/repo/issues/1', 'Invalid input stays editable');
  assert.equal(await evaluate(`document.querySelector('${popover}').textContent.includes('Enter a GitHub') || document.querySelector('${popover}').textContent.includes('Retry')`), false, 'No inline error or Retry');
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast]')`);
  await ab('fill', '#session-pr-url', prs[1].url + '/files?diff=split#abc'); await button('Save link'); await waitBadge(43);
  await ab('wait', '--fn', `!document.querySelector('${popover}')`);
  assert.equal(await evaluate(`document.activeElement?.getAttribute('data-slot')`), 'popover-trigger');
  await palette('Other work'); await ab('click', '[cmdk-item][data-value$=" other"]');
  await ab('wait', '--fn', `location.pathname === '/s/other'`); await noBadge();
  await palette('Pull request'); await ab('click', '[cmdk-item][data-value="PR"]'); await waitDetails();
  await ab('wait', '--fn', `!!document.querySelector('#session-pr-url')`);
  assert.equal(await evaluate(`document.querySelector('${popover}').textContent.includes('No matching') || !!document.querySelector('[data-sonner-toast]')`), false, 'Opening shows no absence message');
  const gate = { started: join(root, 'discovery-started'), release: join(root, 'discovery-release') };
  control({ prs: [], gate });
  await ab('fill', '#session-pr-url', prs[0].url);
  await button('Find PR from branch');
  await ab('wait', '--text', 'Finding PR…');
  assert.equal(await evaluate(`[...document.querySelectorAll('${popover} button')].find(b => b.textContent.includes('Finding PR'))?.disabled`), true);
  for (let n = 0; !existsSync(gate.started); n++) { assert.ok(n < 100, 'Discovery started'); await delay(50); }
  writeFileSync(gate.release, 'release');
  await ab('wait', '--fn', `document.querySelector('[data-sonner-toast]')?.textContent.includes('No open PR found for this branch.')`);
  assert.equal(await evaluate(`document.querySelector('${popover}').textContent.includes('No open PR')`), false, 'Absence is a toast, not inline');
  assert.equal(await evaluate(`document.querySelector('#session-pr-url').value`), prs[0].url, 'Search preserves the draft and keeps the form open');
  await noBadge();
  await ab('set', 'viewport', '390', '844');
  await ab('screenshot', join(evidence, 'manual-search-empty-toast-mobile.png'));
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast]')`);
  control({ error: 'offline' });
  await button('Find PR from branch');
  await ab('wait', '--fn', `document.querySelector('[data-sonner-toast][data-type="error"]')?.textContent.includes('Could not read GitHub')`);
  assert.equal(await evaluate(`document.querySelector('${popover}').textContent.includes('Could not read GitHub') || document.querySelector('${popover}').textContent.includes('Retry')`), false, 'Discovery errors use a toast without Retry');
  await ab('screenshot', join(evidence, 'manual-search-error-toast-mobile.png'));
  await ab('wait', '--fn', `!document.querySelector('[data-sonner-toast]')`);
  control({ prs: [] });
  await evaluate(`window.dispatchEvent(new Event('focus')); true`);
  await ab('wait', '--fn', `!document.querySelector('${popover} button[type="submit"]').disabled`);
  assert.equal(await evaluate(`!!document.querySelector('[data-sonner-toast]')`), false, 'Background-style refresh does not toast absence');
  await closeDetails();
  control({ prs });
  // A newly available branch PR must not be discovered just by opening the control.
  await evaluate(`window.prRequests = 0; window.originalFetch = window.fetch; window.fetch = (...args) => { if (String(args[0]).includes('/api/session/pull-request')) window.prRequests++; return window.originalFetch(...args); }; true`);
  await openDetails();
  assert.equal(await evaluate('window.prRequests'), 0, 'Opening an unlinked popover makes no PR request');
  await noBadge();
  assert.equal(await evaluate(`!!document.querySelector('${popover} button[type="button"]') && ![...document.querySelectorAll('${popover} button')].some(b => b.textContent === 'Cancel')`), true);
  await ab('set', 'viewport', '390', '844');
  await ab('screenshot', join(evidence, 'unlinked-compact-mobile.png'));
  await closeDetails();
  // Existing background reconciliation can still associate the newly created PR.
  await evaluate(`window.fetch = window.originalFetch; window.dispatchEvent(new Event('focus')); true`);
  await waitBadge(42);
  observations.openWithoutDiscovery = 'pass';
  observations.backgroundDiscovery = 'pass';
  await ab('set', 'viewport', '1280', '900');
  await openDetails(); await button('Remove link'); await noBadge(); await openDetails();
  await ab('fill', '#session-pr-url', prs[0].url);
  await ab('click', `${popover} button[type="submit"]`); await waitBadge(42);
  await ab('wait', '--fn', `!document.querySelector('${popover}')`);
  assert.equal(await evaluate(`document.activeElement?.getAttribute('data-slot')`), 'popover-trigger', 'Linking restores focus to the PR button');
  await palette('Current work'); await ab('click', '[cmdk-item][data-value$=" work"]');
  await ab('wait', '--fn', `location.pathname === '/s/work'`); await waitBadge(43);
  await ab('reload'); await waitBadge(43);
  // State lives in the icon/color and accessible description, not a redundant tooltip line.
  observations.prStates = [];
  for (const [label, state, isDraft] of [['Open', 'OPEN', false], ['Draft', 'OPEN', true], ['Merged', 'MERGED', false], ['Closed', 'CLOSED', false]]) {
    control({ prs: prs.map(pr => ({ ...pr, state, isDraft, reviewDecision: '', statusCheckRollup: [] })) });
    await evaluate(`window.dispatchEvent(new Event('focus')); true`);
    await ab('wait', '--fn', `document.querySelector(${JSON.stringify(badge(43))})?.getAttribute('aria-description') === ${JSON.stringify(label)}`);
    await ab('hover', badge(43));
    await ab('wait', '--fn', `!!document.querySelector('[role="tooltip"]')`);
    assert.equal(await evaluate(`document.querySelector('[role="tooltip"]').textContent`), 'Explicitly linked work');
    observations.prStates.push(await evaluate(`(() => { const svg = document.querySelector(${JSON.stringify(badge(43))}).querySelector('svg'); return { state: ${JSON.stringify(label)}, color: getComputedStyle(svg).color, shape: svg.innerHTML }; })()`));
    await ab('screenshot', join(evidence, `state-${label.toLowerCase()}.png`));
    await ab('mouse', 'move', '0', '0');
    await openDetails();
    assert.equal(await evaluate(`document.querySelector('${popover} [data-slot="badge"]').textContent`), label, 'Card has an explicit state badge');
    assert.equal(await evaluate(`!!document.querySelector('${popover} [data-slot="badge"] svg')`), true, 'Status includes an icon');
    await ab('screenshot', join(evidence, `card-${label.toLowerCase()}.png`));
    await evaluate(`document.documentElement.classList.add('dark'); true`);
    await ab('screenshot', join(evidence, `card-${label.toLowerCase()}-dark.png`));
    await evaluate(`document.documentElement.classList.remove('dark'); true`);
    await closeDetails();
  }
  assert.equal(new Set(observations.prStates.map(s => s.color)).size, 4);
  assert.equal(new Set(observations.prStates.map(s => s.shape)).size, 4);
  // A failed refresh keeps identity but does not display old approval/check success.
  control({ error: 'offline' }); await openDetails(); await ab('wait', '--text', 'Status unavailable');
  assert.equal(await evaluate(`!!document.querySelector('[data-sonner-toast]')`), false, 'Automatic status failures stay silent');
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Approved')`), false);
  await closeDetails(); await waitBadge(43);
  await openDetails();
  await ab('wait', '--text', 'Status unavailable');
  control({ prs });
  await closeDetails(); await openDetails(); await ab('wait', '--text', 'Explicitly linked work'); await closeDetails();
  await ab('set', 'viewport', '390', '844');
  await ab('wait', '--fn', `document.querySelector('header [data-slot="popover-trigger"]').getBoundingClientRect().height === 24`);
  assert.ok(await evaluate(`(() => { const r = document.querySelector('header [data-slot="popover-trigger"]').getBoundingClientRect(), m = document.querySelector('header p[title]').getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - (m.top + m.bottom) / 2) < 2; })()`), 'Mobile PR remains compact beside metadata');
  await openDetails();
  await ab('wait', '--text', 'Explicitly linked work');
  assert.equal(await evaluate(`document.querySelector('${popover}').contains(document.activeElement)`), true);
  observations.mobile = await evaluate(`({ width: innerWidth, scroll: document.documentElement.scrollWidth, dialogScroll: document.querySelector('[role="dialog"]').scrollWidth, dialogWidth: document.querySelector('[role="dialog"]').clientWidth })`);
  assert.ok(observations.mobile.scroll <= observations.mobile.width && observations.mobile.dialogScroll <= observations.mobile.dialogWidth);
  await ab('screenshot', join(evidence, '02-pr-popover-mobile.png'));
  await editLink();
  await ab('screenshot', join(evidence, '02-pr-edit-mobile.png')); await closeDetails();
  await ab('screenshot', join(evidence, '03-current-pr-mobile.png'));
  await ab('set', 'viewport', '320', '700');
  assert.ok(await evaluate(`(() => { const r = document.querySelector('header [data-slot="popover-trigger"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`), 'PR control stays reachable on narrow screens');
  await openDetails();
  assert.ok(await evaluate(`(() => { const r = document.querySelector('${popover}').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`));
  await closeDetails();
  const requests = () => evaluate(`performance.getEntriesByType('resource').filter(e => new URL(e.name).pathname === '/api/session/pull-request').map(e => e.name)`);
  observations.requests = await requests();
  // A non-Git workspace must still supply its ID and display its manually associated PR.
  await ab('open', `${frontendUrl}/s/notes`); await waitBadge(43);
  observations.requests.push(...await requests());
  assert.ok(observations.requests.length > 0);
  for (const raw of observations.requests) {
    const url = new URL(raw), id = url.searchParams.get('workspaceId');
    assert.ok([workspaceId, plainId].includes(id));
    assert.equal(url.searchParams.has('cwd'), false);
    assert.ok(!decodeURIComponent(raw).includes(root));
    assert.equal(id, url.searchParams.get('sessionId') === 'notes' ? plainId : workspaceId);
  }
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
