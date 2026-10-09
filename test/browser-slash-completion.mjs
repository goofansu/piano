// Shared composer completion contract; fake Pi, scratch registry, no model calls.
// node test/browser-slash-completion.mjs /tmp/piano-slash-evidence
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { registryEnv } from './fixtures/registry.ts';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-slash-evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-slash-'));
const cwd = join(root, 'project'); mkdirSync(cwd); spawnSync('git', ['init', '-q', cwd]);
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [cwd], worktrees: [], sessions: [{ cwd, sessionId: 'not-running', title: 'Saved session', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', archived: false }] }));
writeFileSync(join(root, 'fake.mjs'), readFileSync('test/fake-pi.mjs', 'utf8').replace(
  'out({ type: "extension_ui_request", id: "live1", method: "input", title: "Running after response" });',
  '// Hold the run without a modal over the composer.'
));
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171';
const webPort = process.env.PIANO_TEST_WEB_PORT ?? '7172';
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env,
  HOST: '127.0.0.1', PORT: backendPort, ...registryEnv(join(root, 'registry.json')), PIANO_PI_CLI: join(root, 'fake.mjs'), PIANO_PI_ARGS: '',
  PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
}, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', webPort, '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [backend, frontend]) { proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d); }
const session = `slash-${process.pid}`, commands = [];
function ab(...args) {
  const result = spawnSync('npx', ['agent-browser', '--session', session, ...args], { encoding: 'utf8', timeout: 45000 });
  commands.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
const evaluate = js => JSON.parse(ab('eval', js));
async function until(js) {
  for (let n = 0; n < 25; n++) { if (evaluate(js)) return; await delay(100); }
  throw new Error(`Timed out: ${js}`);
}
const input = 'textarea';
const menu = '[role="listbox"][aria-label="Slash commands"]';
const options = `${menu} [role="option"]`;
const draft = () => evaluate(`document.querySelector('textarea').value`);
async function fill(text) {
  // Refocus before replacement: after Tab, type-to-focus can otherwise append
  // the driver's inserted text to the old draft instead of replacing it.
  ab('click', input); ab('fill', input, text);
  assert.equal(draft(), text, 'browser driver replaced the draft before testing completion');
}
async function suggestions(text) { await fill(text); ab('press', 'End'); await until(`!!document.querySelector('${options}')`); }
function capture(name) { ab('screenshot', join(evidence, `${name}.png`)); writeFileSync(join(evidence, `${name}.txt`), ab('snapshot')); }
function assertFullPageSettings() {
  assert.ok(evaluate(`(() => {
    const rect = document.querySelector('[aria-label="Settings"]').getBoundingClientRect();
    return rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight;
  })()`), 'Settings occupies the whole viewport, not the conversation inset');
  assert.equal(evaluate(`!!document.querySelector('nav[aria-label="Sessions"]')?.checkVisibility()`), false, 'session navigation is hidden in Settings');
  assert.equal(evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Settings fits without horizontal overflow');
}
function cardStyle(selector) {
  return evaluate(`(() => {
    const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
    return { radius: style.borderRadius, border: style.borderWidth, borderColor: style.borderColor,
      shadow: style.boxShadow, background: style.backgroundColor };
  })()`);
}
async function assertSettingsCard(sidebarWidth, sessionStyle) {
  // Wait for the sidebar's width transition before checking the visible card geometry.
  await until(`document.querySelector('[aria-label="Settings"] main').getBoundingClientRect().x === ${sidebarWidth}`);
  assert.deepEqual(evaluate(`(() => {
    const { x, y, width, height } = document.querySelector('[aria-label="Settings"] main').getBoundingClientRect();
    return { x, y, width, height };
  })()`), { x: sidebarWidth, y: 8, width: 1440 - sidebarWidth - 8, height: 984 }, 'Settings matches the session card geometry at 1440×1000');
  assert.deepEqual(cardStyle('[aria-label="Settings"] main'), sessionStyle, 'Settings matches the session card radius, border, shadow and background');
  assert.ok(evaluate(`document.querySelector('nav[aria-label="Settings sections"] button').checkVisibility()`), 'Settings navigation remains available in both expanded and icon modes');
  assertFullPageSettings();
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch(`http://127.0.0.1:${backendPort}/api/projects`)).ok && (await fetch(`http://127.0.0.1:${webPort}`)).ok) break; } catch {}
    if (n === 99) throw new Error('Scratch startup deadline'); await delay(100);
  }
  assert.equal((await fetch(`http://127.0.0.1:${backendPort}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, sessionId: 'not-running' }) })).status, 409, 'discovery does not open stopped sessions');
  ab('open', `http://127.0.0.1:${webPort}/new`);
  ab('set', 'viewport', '1440', '1000');
  await until(`document.querySelector('[aria-label^="Model:"]')?.title.includes('alpha')`);
  const sessionStyle = cardStyle('main');
  assert.equal(sessionStyle.radius, '16px');
  assert.equal(sessionStyle.border, '1px');
  assert.notEqual(sessionStyle.shadow, 'none');
  await fill('Keep this draft');
  ab('find', 'role', 'button', 'click', '--name', 'Settings', '--exact');
  ab('wait', '--text', 'Providers');
  assert.equal(evaluate('location.pathname'), '/settings');
  await assertSettingsCard(288, sessionStyle);
  capture('settings-desktop-expanded');
  ab('find', 'role', 'button', 'click', '--name', 'Toggle sidebar', '--exact');
  await assertSettingsCard(48, sessionStyle);
  capture('settings-desktop-collapsed');
  ab('find', 'role', 'button', 'click', '--name', 'Toggle sidebar', '--exact');
  await assertSettingsCard(288, sessionStyle);
  ab('find', 'role', 'button', 'click', '--name', 'Sign in to Radius', '--exact');
  ab('wait', '--text', 'Sign in · radius');
  await until(`!!document.querySelector('#login-answer')`);
  ab('click', '#login-answer');
  ab('wait', '--text', 'Sign in with device code (when signing in from another device)');
  capture('settings-radius'); ab('press', 'Escape'); ab('press', 'Escape');
  ab('reload'); ab('wait', '--text', 'Providers');
  assert.equal(evaluate('location.pathname'), '/settings');
  ab('find', 'role', 'button', 'click', '--name', 'Sign in to Radius', '--exact');
  await until(`!!document.querySelector('#login-answer')`);
  ab('find', 'role', 'button', 'click', '--name', 'Cancel sign-in', '--exact');
  ab('wait', '--text', 'Sign-in cancelled.');
  ab('click', '[data-slot="dialog-footer"] button:last-child');
  ab('find', 'role', 'button', 'click', '--name', 'Back to session', '--exact');
  await fill('Keep this draft');
  ab('press', 'Control+k'); ab('fill', '[placeholder="Search sessions and commands…"]', 'Settings');
  ab('click', '[role="option"]'); ab('wait', '--text', 'Providers');
  ab('press', 'x');
  evaluate('history.back(); true');
  await until(`location.pathname === '/new'`);
  evaluate('history.forward(); true');
  await until(`location.pathname === '/settings'`);
  ab('find', 'role', 'button', 'click', '--name', 'Back to session', '--exact');
  assert.equal(draft(), 'Keep this draft', 'settings navigation preserves the new-session draft');
  await fill('/login rad'); assert.equal(evaluate(`!!document.querySelector('${menu}')`), false, 'no provider completion remains');
  await suggestions('/');
  assert.ok(evaluate(`document.querySelector('${menu}').textContent.includes('probe-only')`));
  assert.equal(evaluate(`document.querySelector('${menu}').textContent.includes('live-only')`), false);
  assert.deepEqual(evaluate(`[...document.querySelectorAll('${options}')].map(e=>e.innerText.match(/\\/skill:[\\w-]+/)?.[0])`), ['/skill:probe-only', '/skill:research'], 'only skills, never extensions or templates');
  assert.ok(evaluate(`document.activeElement === document.querySelector('textarea')`));
  assert.ok(evaluate(`document.getElementById(document.querySelector('textarea').getAttribute('aria-activedescendant'))?.getAttribute('role') === 'option'`));
  ab('press', 'ArrowDown'); ab('press', 'Tab'); assert.equal(draft(), '/skill:research ');
  assert.ok(evaluate(`location.pathname === '/new'`), 'acceptance did not send');
  await suggestions('/re'); ab('press', 'Alt+Enter'); assert.equal(draft(), '/skill:research ');
  await fill('/no-such-command'); ab('wait', '--text', 'No matching commands.');
  ab('press', 'Escape');
  await fill('/resZZ keep this\nand this');
  evaluate(`document.querySelector('textarea').setSelectionRange(3,3); true`);
  ab('press', 'ArrowRight');
  await until(`!!document.querySelector('${options}')`);
  ab('press', 'Tab'); assert.equal(draft(), '/skill:research keep this\nand this', 'replace full token, not suffix prose');
  assert.equal(evaluate(`document.querySelector('textarea').selectionStart`), 16);
  ab('press', 'x'); assert.equal(draft(), '/skill:research xkeep this\nand this', 'continued typing starts the argument, not the command name');
  for (const text of ['Prose /skill:re', 'Prose\n/re', '/etc/pass', '`/re`']) {
    await fill(text); assert.equal(evaluate(`!!document.querySelector('${menu}')`), false, `not a leading command: ${text}`);
  }
  await suggestions('/re'); ab('press', 'Escape');
  await until(`!document.querySelector('${menu}')`);
  assert.equal(draft(), '/re');
  ab('press', 'Tab'); assert.notEqual(evaluate(`document.activeElement.tagName`), 'TEXTAREA', 'Tab without suggestions traverses focus');
  await suggestions('/re');
  evaluate(`document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); true`);
  await until(`!document.querySelector('${menu}')`);
  evaluate(`document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})); true`);
  assert.equal(draft(), '/re'); assert.ok(evaluate(`location.pathname === '/new'`));
  evaluate(`document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})); true`);
  await until(`!!document.querySelector('${options}')`);
  ab('press', 'Enter'); assert.equal(draft(), '/skill:research ');
  await fill('/handled'); ab('wait', '--text', 'No matching commands.');
  ab('press', 'Enter'); ab('wait', '--text', 'Command handled.');
  assert.ok(evaluate(`!!document.querySelector('[aria-label="Send"]')`), 'handled extension does not create a phantom run');
  await suggestions('/');
  assert.ok(evaluate(`document.querySelector('${menu}').textContent.includes('live-only')`));
  assert.equal(evaluate(`document.querySelector('${menu}').textContent.includes('probe-only')`), false);
  assert.deepEqual(evaluate(`[...document.querySelectorAll('${options}')].map(e=>e.innerText.match(/\\/skill:[\\w-]+/)?.[0])`), ['/skill:live-only', '/skill:research'], 'live suggestions also contain only skills');
  capture('active-desktop');
  ab('press', 'Escape'); await fill('Keep session draft');
  ab('find', 'role', 'button', 'click', '--name', 'Settings', '--exact');
  ab('wait', '--text', 'Providers');
  ab('find', 'role', 'button', 'click', '--name', 'Back to session', '--exact');
  assert.equal(draft(), 'Keep session draft', 'settings navigation preserves the session draft');
  await fill('live context'); ab('press', 'Enter'); ab('wait', '[aria-label="Stop"]');
  await fill('/handled'); ab('wait', '--text', 'No matching commands.');
  ab('press', 'Enter'); ab('wait', '--text', 'Command handled.');
  assert.ok(evaluate(`!!document.querySelector('[aria-label="Stop"]')`), 'extension command while busy preserves the active run');
  await suggestions('/re'); ab('press', 'Escape');
  await until(`!document.querySelector('${menu}')`);
  assert.ok(evaluate(`!!document.querySelector('[aria-label="Delivery: steer"]')`), 'Escape dismisses without aborting');
  ab('press', 'Escape');
  await until(`!document.querySelector('[aria-label="Delivery: steer"]')`);
  // Delay discovery to expose stale insertion after editing the draft.
  evaluate(`window.originalFetch=window.fetch;window.fetch=(...args)=>String(args[0]).includes('/api/commands')?new Promise(resolve=>setTimeout(()=>resolve(originalFetch(...args)),700)):originalFetch(...args);true`);
  await fill('/'); await fill('ordinary prose'); await delay(800);
  assert.equal(evaluate(`!!document.querySelector('${menu}')`), false); assert.equal(draft(), 'ordinary prose');
  evaluate(`window.fetch=(...args)=>String(args[0]).includes('/api/commands')?Promise.resolve(new Response(JSON.stringify({error:'unavailable'}),{status:502})):originalFetch(...args);true`);
  await fill('/'); ab('wait', '--text', 'Could not load commands. Close and reopen to retry.');
  ab('press', 'Escape');
  evaluate(`window.fetch=window.originalFetch;true`);
  // Real pointer selection through agent-browser, with a coarse-pointer viewport.
  const activeUrl = evaluate('location.href');
  ab('close');
  ab('--args', '--blink-settings=primaryPointerType=2', 'open', activeUrl);
  ab('set', 'device', 'iPhone 16');
  assert.ok(evaluate(`matchMedia('(pointer: coarse)').matches`));
  await suggestions('/skill:re'); capture('active-mobile');
  ab('click', `${options}`); assert.equal(draft(), '/skill:research ');
  assert.ok(evaluate(`document.activeElement === document.querySelector('textarea')`));
  ab('press', 'Enter'); assert.equal(draft(), '/skill:research \n', 'mobile Enter remains a newline without a target');
  ab('open', `http://127.0.0.1:${webPort}/new`);
  await suggestions('/re'); ab('click', options); assert.equal(draft(), '/skill:research ');
  await suggestions('/'); ab('set', 'viewport', '320', '640'); capture('new-mobile');
  assert.ok(evaluate(`(() => {const r=document.querySelector('${menu}').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`), 'suggestions fit phone viewport');
  ab('find', 'role', 'button', 'click', '--name', 'Show sidebar', '--exact');
  ab('find', 'role', 'button', 'click', '--name', 'Settings', '--exact');
  ab('wait', '--text', 'Providers'); capture('settings-mobile');
  assertFullPageSettings();
  assert.equal(evaluate(`!!document.querySelector('[role="dialog"]')`), false, 'mobile settings closes the sidebar');
  ab('find', 'role', 'button', 'click', '--name', 'Toggle sidebar', '--exact');
  ab('wait', '[role="dialog"]');
  assert.ok(evaluate(`document.querySelector('nav[aria-label="Settings sections"]').checkVisibility()`), 'mobile Settings exposes its own navigation');
  ab('find', 'role', 'button', 'click', '--name', 'Providers', '--exact');
  await until(`!document.querySelector('[role="dialog"]')`);
  assertFullPageSettings();
  console.log('PASS: Settings session-style card, sidebar collapse/expand, palette/mobile entry, OAuth resume/cancel, draft preservation, no login completion, both composers, live/probe discovery, keyboard and pointer acceptance, middle caret, literal prose, IME, stale response, Escape/abort, mobile newline and bounds');
} finally {
  try { capture('final'); ab('close'); } catch {}
  backend.kill('SIGTERM'); frontend.kill('SIGTERM');
  await Promise.all([backend, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(done => proc.once('exit', done))));
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'processes.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
