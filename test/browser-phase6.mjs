// Scratch-only Phase 6 gate: actual wt 0.80.0, fake Pi catalog, no model calls.
// node test/browser-phase6.mjs /tmp/piano-phase6-evidence/browser
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-phase6-evidence/browser'); mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-browser-phase6-')), repo = join(root, 'repo'), config = join(root, 'config'), sessions = join(root, 'sessions');
for (const path of [repo, sessions, join(root, 'home'), join(root, 'agent'), join(config, 'worktrunk')]) mkdirSync(path, { recursive: true });
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: config, XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', WORKTRUNK_CONFIG_PATH: join(config, 'worktrunk/config.toml') };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = message => git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-am', message);
git(repo, 'init', '--quiet', '-b', 'main');
writeFileSync(join(repo, 'source.txt'), 'base\n'); mkdirSync(join(repo, '.config'));
writeFileSync(join(repo, '.config/wt.toml'), 'pre-start = "echo ran > hook-ran"\n');
git(repo, 'add', '.'); commit('baseline');
git(repo, 'switch', '-c', 'other'); writeFileSync(join(repo, 'source.txt'), 'theirs\n'); commit('theirs');
git(repo, 'switch', 'main'); writeFileSync(join(repo, 'source.txt'), 'ours\n'); commit('ours');
const detached = join(root, 'external-detached'); git(repo, 'worktree', 'add', '--detach', detached);
writeFileSync(env.WORKTRUNK_CONFIG_PATH, 'worktree-path = "../custom/{{ branch | sanitize }}"\n');
const notes = join(root, 'notes'); mkdirSync(notes);
const registry = join(root, 'registry.json'); writeFileSync(registry, JSON.stringify({ projects: [repo, notes], worktrees: [], sessions: [] }));
const wtPath = execFileSync('which', ['wt'], { encoding: 'utf8' }).trim(), wrapper = join(root, 'wt'), failure = join(root, 'backend-failure'), unknown = join(root, 'unknown');
writeFileSync(wrapper, `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';import{existsSync}from'node:fs';
if(existsSync(${JSON.stringify(failure)})){console.error('Worktrunk unavailable: controlled fixture outage');process.exit(1);}
const r=spawnSync(${JSON.stringify(wtPath)},process.argv.slice(2),{encoding:'utf8'});let out=r.stdout??'';
if(existsSync(${JSON.stringify(unknown)})&&process.argv.includes('list')){const x=JSON.parse(out);for(const i of x.items)if(i.worktree){i.worktree.changes=null;i.worktree.operation=null;}out=JSON.stringify(x);}
process.stdout.write(out);process.stderr.write(r.stderr??'');process.exit(r.status??1);\n`, { mode: 0o755 });
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: registry, PIANO_WT_CLI: wrapper,
  PIANO_PI_CLI: resolve('test/fake-pi.mjs'), PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let processLog = ''; for (const p of [server, frontend]) { p.stdout.on('data', d => processLog += d); p.stderr.on('data', d => processLog += d); }
const session = `phase6-${process.pid}`, commands = [], observations = [];
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
const readRegistry = () => JSON.parse(readFileSync(registry, 'utf8'));
async function capture(name) { writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot')); await ab('screenshot', join(evidence, `${name}.png`)); observations.push(name); }
async function openWorktrees() { await ab('click', '[aria-label="Directory"]'); writeFileSync(join(evidence, 'directory-picker.txt'), await ab('snapshot')); await ab('click', '[cmdk-item][data-value="__worktree"]'); await ab('wait', '--fn', `document.querySelector('[role="dialog"]') && !document.querySelector('[role="dialog"] [role="status"]')`); }
async function refresh() { await click('Refresh'); await ab('wait', '--fn', `!document.querySelector('[role="dialog"] [role="status"]')`); }
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7172')).ok && (await fetch('http://127.0.0.1:7171/api/projects')).ok) break; } catch {}
    if (n === 99) throw new Error('scratch startup deadline'); await delay(100);
  }
  await ab('open', 'http://127.0.0.1:7172'); await ab('wait', '--text', 'What should we work on?');
  await ab('wait', '--fn', `document.querySelector('[aria-label="Directory"]')?.title === ${JSON.stringify(repo)}`);
  await openWorktrees(); await ab('wait', '--text', 'Detached HEAD');
  assert.equal(readRegistry().worktrees.length, 0); assert.equal(readRegistry().sessions.length, 0);
  await capture('discovery-not-registration');
  await click('Select detached'); await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Directory"]').title`), detached);
  assert.deepEqual(readRegistry().worktrees.map(w => w.path), [detached]); assert.equal(readRegistry().sessions.length, 0);
  await openWorktrees(); await ab('fill', '#wt-branch', 'browser-feature');
  await ab('check', 'input[type="checkbox"]'); await click('Create worktree');
  await ab('wait', '--text', 'Worktree operation not confirmed');
  assert.equal(existsSync(join(root, 'custom/browser-feature')), false);
  assert.equal(readRegistry().worktrees.length, 1); await capture('unapproved-hook-failure');
  await ab('uncheck', 'input[type="checkbox"]'); await click('Create worktree');
  await ab('wait', '--fn', `!document.querySelector('[role="dialog"]')`);
  const created = join(root, 'custom/browser-feature');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Directory"]').title`), created);
  assert.equal(existsSync(join(created, 'hook-ran')), false); assert.equal(readRegistry().sessions.length, 0);
  await ab('wait', '--text', 'Clean'); await capture('returned-custom-checkout-selected');
  writeFileSync(join(created, 'new-source.ts'), 'export const x = 1;\n');
  assert.equal(spawnSync('git', ['-C', created, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'merge', 'other'], { env }).status, 1);
  await openWorktrees(); await ab('wait', '--text', 'merge in progress'); await ab('wait', '--text', 'Conflicts'); await capture('external-dirty-merge-state');
  writeFileSync(unknown, ''); await refresh(); await ab('wait', '--text', 'Changes unknown'); await ab('wait', '--text', 'Operation unknown'); await capture('unknown-is-not-clean'); rmSync(unknown);
  writeFileSync(failure, ''); await refresh(); await ab('wait', '--text', 'No current Git status is available');
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Discovered worktrees"] li').length`), 0);
  await capture('backend-error-not-root-fallback');
  rmSync(failure); await refresh(); await ab('wait', '--text', 'merge in progress'); await capture('backend-recovery');
  git(created, 'merge', '--abort'); git(repo, 'worktree', 'remove', '--force', created); git(repo, 'branch', '-D', 'browser-feature');
  await refresh(); assert.equal(await evaluate(`!!document.querySelector('[aria-label="Discovered worktrees"]') && !document.querySelector('[aria-label="Discovered worktrees"]').textContent.includes('browser-feature')`), true);
  // The explicit registry selection is retained as missing, not silently dropped.
  assert.ok(readRegistry().worktrees.some(w => w.path === created));
  await capture('external-removal-reconciled');
  await click('Close');
  await ab('wait', '--text', 'Checkout missing');
  await capture('selected-missing-checkout');
  await openWorktrees(); await ab('click', '[aria-label="Worktree project"]'); await ab('find', 'role', 'option', 'click', '--name', 'notes', '--exact');
  await ab('wait', '--text', 'Non-Git directory. Chat is available');
  assert.equal(await evaluate(`!!document.querySelector('#wt-branch')`), false); await capture('non-git-is-explicit');
  await click('Close'); await ab('reload'); await ab('wait', '--text', 'What should we work on?');
  assert.equal(readRegistry().sessions.length, 0);
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ passed: true, observations, root, wt: execFileSync(wtPath, ['--version'], { encoding: 'utf8' }).trim(), node: process.version, registry: readRegistry() }, null, 2));
  console.log(`PASS: ${observations.join(', ')}`);
} finally {
  try { await ab('close'); } catch {}
  for (const p of [server, frontend]) if (p.exitCode === null) { const ended = new Promise(resolve => p.once('exit', resolve)); p.kill('SIGTERM'); await ended; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2)); writeFileSync(join(evidence, 'process.log'), processLog);
  for (const line of git(repo, 'worktree', 'list', '--porcelain').split('\n')) if (line.startsWith('worktree ') && line.slice(9) !== repo) git(repo, 'worktree', 'remove', '--force', line.slice(9));
  for (const branch of git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')) if (branch && branch !== 'main') git(repo, 'branch', '-D', branch);
  rmSync(root, { recursive: true, force: true });
}
