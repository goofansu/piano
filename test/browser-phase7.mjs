// Phase 7's inspector UI was retired. Keep its HTTP/workspace isolation checks;
// session chrome and navigation are now covered by browser-ui-polish.mjs.
// Scratch-only: real Git/worktrees, fake Pi, no model calls.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase7-evidence/http');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-phase7-'));
const repo = join(root, 'repo'), checkout = join(root, 'checkout'), registry = join(root, 'registry.json');
for (const name of ['repo', 'home', 'config', 'agent', 'sessions']) mkdirSync(join(root, name));
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(repo, 'init', '-q', '-b', 'main');
writeFileSync(join(repo, 'source.txt'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
git(repo, 'worktree', 'add', '-b', 'second', checkout);
writeFileSync(join(repo, 'source.txt'), 'WORKSPACE_A\n'); git(repo, 'add', 'source.txt');
writeFileSync(join(checkout, 'source.txt'), 'WORKSPACE_B\n');
const original = { projects: [repo], worktrees: [{ project: repo, path: checkout, branch: 'old-name' }], sessions: [
  { cwd: repo, sessionId: 'workspace-a', title: 'Session A', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', archived: false },
  { cwd: checkout, sessionId: 'workspace-b', title: 'Session B', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', archived: false },
] };
writeFileSync(registry, JSON.stringify(original));
const retiredFiles = [join(root, 'checks.json'), `${registry}.checks.json`, join(`${registry}.evidence`, '00000000-0000-0000-0000-000000000001.json')];
const retiredContent = 'Retired check data, deliberately not valid JSON.\n';
mkdirSync(`${registry}.evidence`);
for (const path of retiredFiles) writeFileSync(path, retiredContent);
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry,
  PIANO_PI_CLI: resolve('test/fake-pi.mjs'), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = '';
server.stdout.on('data', d => processLog += d); server.stderr.on('data', d => processLog += d);
const observations = [];
async function capture(workspace) {
  const response = await fetch(`http://127.0.0.1:7171/api/workspace/capture?workspaceId=${workspace.id}`, { method: 'POST' });
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.workspace.id, workspace.id); assert.equal(receipt.workspace.path, workspace.path);
  observations.push(receipt);
  return receipt.result;
}
async function captured(workspace) {
  const result = await capture(workspace);
  assert.equal(result.status, 'captured', JSON.stringify(result));
  return result;
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok) break; } catch {}
    if (n === 99) throw new Error('Scratch startup deadline'); await delay(100);
  }
  const workspaces = JSON.parse(readFileSync(registry, 'utf8')).workspaces;
  const workspaceA = workspaces.find(w => w.path === repo), workspaceB = workspaces.find(w => w.path === checkout);
  const removedRoutes = [];
  for (const [method, path] of [['GET', '/api/workspace/checks'], ['POST', '/api/workspace/checks/run'], ['POST', '/api/workspace/checks/cancel']]) {
    const response = await fetch(`http://127.0.0.1:7171${path}?workspaceId=${workspaceA.id}`, { method, headers: { Accept: 'application/json' } });
    removedRoutes.push({ method, path, status: response.status });
    assert.equal(response.status, 404, 'the retired check runner must not remain callable');
  }
  writeFileSync(join(evidence, 'removed-checks-api.json'), JSON.stringify(removedRoutes, null, 2));
  const a = await captured(workspaceA);
  assert.ok(a.revision.startsWith('v1-')); assert.match(a.stagedDiff, /WORKSPACE_A/); assert.doesNotMatch(a.stagedDiff + a.unstagedDiff, /WORKSPACE_B/);
  const b = await captured(workspaceB);
  assert.notEqual(a.revision, b.revision); assert.match(b.unstagedDiff, /WORKSPACE_B/); assert.doesNotMatch(b.stagedDiff + b.unstagedDiff, /WORKSPACE_A/);
  writeFileSync(join(checkout, 'source.txt'), 'B_EXTERNALLY_EDITED\n');
  const edited = await captured(workspaceB); assert.notEqual(edited.revision, b.revision); assert.match(edited.unstagedDiff, /B_EXTERNALLY_EDITED/);
  git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'external change'); git(checkout, 'checkout', '--detach');
  const detached = await captured(workspaceB);
  assert.equal(detached.branch, null); assert.equal(detached.stagedDiff + detached.unstagedDiff, ''); assert.notEqual(detached.revision, edited.revision);
  renameSync(join(checkout, '.git'), join(root, 'worktree-git-backup'));
  const failure = await capture(workspaceB); assert.equal(failure.status, 'error'); assert.equal('revision' in failure, false);
  renameSync(join(root, 'worktree-git-backup'), join(checkout, '.git'));
  assert.equal((await captured(workspaceB)).revision, detached.revision);
  assert.equal((await captured(workspaceA)).revision, a.revision, 'another workspace cannot relabel or invalidate A');
  const data = JSON.parse(readFileSync(registry, 'utf8'));
  assert.equal(data.version, 2); assert.equal(data.workspaces.length, 2); assert.deepEqual(data.sessions, original.sessions);
  for (const path of retiredFiles) assert.equal(readFileSync(path, 'utf8'), retiredContent, 'saved Checks files remain untouched');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, node: process.version, base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }, null, 2));
  console.log('PASS: workspace capture HTTP identity, external edits/detachment, failure/recovery, retired check routes and data');
} finally {
  if (server.exitCode === null) { const ended = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await ended; }
  writeFileSync(join(evidence, 'process.log'), processLog);
  try { renameSync(join(root, 'worktree-git-backup'), join(checkout, '.git')); } catch {}
  git(repo, 'worktree', 'remove', '--force', checkout); git(repo, 'branch', '-D', 'second');
  rmSync(root, { recursive: true, force: true });
}
