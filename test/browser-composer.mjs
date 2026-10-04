// Browser-seam regression against separate scratch backend/dev UI processes.
// Uses npx agent-browser, no model calls or systemd built-UI interaction.
// Run: node test/browser-composer.mjs /tmp/piano-composer-evidence
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-composer-evidence');
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'piano-composer-'));
const cwd = join(scratch, 'a-very-long-project-directory-name-for-responsive-composer-verification');
mkdirSync(cwd);
spawnSync('git', ['init', cwd]);
const longModel = 'alpha-with-a-very-long-model-name-for-responsive-verification';
// Keep the existing fake untouched. Adapt only its external protocol labels.
writeFileSync(join(scratch, 'fake.mjs'), readFileSync('test/fake-pi.mjs', 'utf8').replaceAll('"alpha"', JSON.stringify(longModel)).replaceAll('fake/alpha', `fake/${longModel}`).replace('out({ type: "extension_ui_request", id: "live1", method: "input", title: "Running after response" });', '// Browser fixture: pause without a modal covering the composer.'));
writeFileSync(join(scratch, 'registry.json'), JSON.stringify({ projects: [cwd], worktrees: [], sessions: [] }));
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '7171', PIANO_CONFIG: join(scratch, 'registry.json'), PIANO_PI_CLI: join(scratch, 'fake.mjs'), PI_CODING_AGENT_DIR: join(scratch, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(scratch, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
for (const proc of [server, frontend]) {
  proc.stdout.on('data', d => serverLog += d);
  proc.stderr.on('data', d => serverLog += d);
}
const appUrl = 'http://127.0.0.1:7172';
const observe = join(scratch, 'observe.js');
writeFileSync(observe, `window.pageToken=crypto.randomUUID(); window.observedSockets=[]; window.sent=[];
const NativeWebSocket=WebSocket;
window.WebSocket=class extends NativeWebSocket {
  constructor(...args){super(...args);window.observedSockets.push(this);}
  send(data){if(this.url.endsWith('/ws'))window.sent.push(JSON.parse(data));return super.send(data);}
};`);
let session = `composer-${process.pid}`;
const log = [];
const failures = [];
function ab(...args) {
  const r = spawnSync('npx', ['agent-browser', '--session', session, ...args], { encoding: 'utf8', timeout: 45000 });
  log.push({ command: ['npx', 'agent-browser', '--session', session, ...args], status: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) throw new Error(`agent-browser ${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function evaluate(js) { return JSON.parse(ab('eval', js)); }
async function until(js) {
  for (let i = 0; i < 20; i++) { if (evaluate(js)) return; await delay(100); }
  ab('snapshot');
  throw new Error(`Timed out: ${js}`);
}
const views = [[320, 640], [375, 812], [390, 844], [430, 932], [844, 390], [768, 1024], [1024, 768], [1280, 800]];
const geometry = `(() => {
  const t = document.querySelector('textarea');
  const card = t.parentElement;
  const footer = t.nextElementSibling;
  const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
  const controls = [...footer.querySelectorAll('button, [data-slot="tooltip-trigger"]')].map(el => ({label:el.getAttribute('aria-label') || el.textContent, ...rect(el)}));
  const c = rect(card);
  const problems = controls.filter(r => r.x < c.x || r.right > c.right + 1 || r.right > innerWidth || r.bottom > innerHeight || r.width < 24).map(r => r.label);
  const overlaps = controls.flatMap((a,i) => controls.slice(i+1).filter(b => a.x < b.right-1 && b.x < a.right-1 && a.y < b.bottom-1 && b.y < a.bottom-1).map(b => a.label+' overlaps '+b.label));
  return { viewport:[innerWidth,innerHeight], coarse:matchMedia('(pointer: coarse)').matches, card:c, textarea:rect(t), footer:rect(footer), controls, documentWidth:document.documentElement.scrollWidth, problems:[...problems,...overlaps] };
})()`;
async function capture(journey) {
  for (const [w,h] of views) {
    ab('set', 'viewport', String(w), String(h));
    const g = evaluate(geometry);
    writeFileSync(join(evidence, `${journey}-${w}x${h}.json`), JSON.stringify(g, null, 2));
    ab('screenshot', join(evidence, `${journey}-${w}x${h}.png`));
    ab('snapshot', '-i');
    if (g.problems.length) failures.push(`${journey} ${w}x${h}: ${g.problems.join(', ')}`);
  }
}
try {
  for (let i=0;i<50;i++) {
    try { const r=await fetch(appUrl); if(r.ok) break; } catch {}
    if (i===49) throw new Error('Scratch server did not start');
    await delay(100);
  }
  ab('--init-script', observe, '--args', '--blink-settings=primaryPointerType=2', 'open', appUrl);
  ab('set', 'device', 'iPhone 16');
  if (!evaluate(`matchMedia('(pointer: coarse)').matches`)) throw new Error('Mobile fixture has no coarse pointer');
  await until(`!!document.querySelector('[aria-label="Model"]')?.title.includes('${longModel}')`);
  ab('fill', '[aria-label="First message"]', 'mobile first');
  ab('press', 'Enter');
  if (!evaluate(`document.querySelector('textarea').value === 'mobile first\\n'`)) throw new Error('Mobile Enter did not insert newline');
  await capture('new');
  // Pointer actions, not DOM click: Radix pickers must remain reachable.
  ab('set', 'viewport', '320', '640');
  for (const label of ['Directory', 'Model']) {
    ab('click', `[aria-label="${label}"]`);
    ab('screenshot', join(evidence, `new-${label}-320.png`));
    const pop = evaluate(`(() => {const e=document.querySelector('[data-slot="popover-content"]');const r=e.getBoundingClientRect();return {x:r.x,right:r.right,width:innerWidth};})()`);
    writeFileSync(join(evidence, `new-${label}-popover.json`), JSON.stringify(pop));
    if (pop.x < 0 || pop.right > pop.width+1) failures.push(`${label} popover extends outside 320px viewport`);
    ab('press', 'Escape');
  }
  ab('click', '[aria-label="Send"]');
  await until(`!!document.querySelector('[aria-label="Message"]') && !document.querySelector('[aria-label="Stop"]')`);
  ab('fill', '[aria-label="Message"]', 'idle draft');
  await capture('idle');
  ab('fill', '[aria-label="Message"]', 'live context');
  ab('click', '[aria-label="Send"]');
  await until(`!!document.querySelector('[aria-label="Stop"]') && document.body.textContent.includes('42,000 tokens')`);
  ab('fill', '[aria-label="Message"]', 'queued draft');
  await capture('streaming');
  // Exercise the actual actions at the narrowest phone width, not just their geometry.
  ab('set', 'viewport', '320', '640');
  ab('click', '[aria-label="Queue message"]');
  await until(`document.querySelector('[aria-label="Message"]').value === ''`);
  if (!evaluate(`!!document.querySelector('[aria-label="Stop"]')`)) throw new Error('Queue stopped the session');
  ab('click', '[aria-label="Stop"]');
  await until(`!document.querySelector('[aria-label="Stop"]')`);
  // A dropped Piano connection should reconnect in place, preserving a mobile draft.
  ab('fill', '[aria-label="Message"]', 'draft after background');
  const before = evaluate(`({pageToken, path:location.pathname, sockets:observedSockets.length, prompts:sent.filter(m=>m._tag==='create_session'||m.action?._tag==='prompt').length})`);
  evaluate(`observedSockets.find(s=>s.url.endsWith('/ws')&&s.readyState===1).close(); true`);
  ab('wait', '--fn', `observedSockets.length > ${before.sockets} && !document.querySelector('[aria-label="Send"]')?.disabled`);
  const after = evaluate(`({pageToken, path:location.pathname, text:document.querySelector('textarea').value, prompts:sent.filter(m=>m._tag==='create_session'||m.action?._tag==='prompt').length})`);
  if (before.pageToken !== after.pageToken || before.path !== after.path || after.text !== 'draft after background' || before.prompts !== after.prompts) throw new Error('Reconnect reloaded the page, lost the draft/selection, or replayed a prompt');
  writeFileSync(join(evidence, 'mobile-reconnect.json'), JSON.stringify({before, after}, null, 2));
  ab('screenshot', join(evidence, 'mobile-reconnect.png'));
  // Fine-pointer desktop: retain Shift+Enter newline and Enter send.
  const sessionUrl = ab('get', 'url');
  ab('close');
  session += '-desktop';
  ab('set', 'viewport', '1280', '800');
  ab('--init-script', observe, 'open', sessionUrl);
  await until(`!!document.querySelector('[aria-label="Message"]')`);
  if (evaluate(`matchMedia('(pointer: coarse)').matches`)) throw new Error('Desktop fixture has coarse pointer');
  ab('fill', '[aria-label="Message"]', 'desktop');
  ab('press', 'Shift+Enter');
  if (!evaluate(`document.querySelector('textarea').value === 'desktop\\n'`)) throw new Error('Shift+Enter did not insert newline');
  ab('press', 'Enter');
  await until(`document.querySelector('textarea').value === ''`);
  ab('errors');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ failures }, null, 2));
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: all composer controls fit; pickers, context, Queue/Stop, keyboard and in-place mobile reconnect checks passed');
  process.exitCode = failures.length ? 1 : 0;
} catch (e) { console.error(e); process.exitCode = 1; }
finally {
  try { ab('close'); } catch {}
  for (const proc of [server, frontend]) proc.kill('SIGTERM');
  await Promise.all([server, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(r => proc.once('exit', r))));
  writeFileSync(join(evidence, 'browser-commands.json'), JSON.stringify(log, null, 2));
  writeFileSync(join(evidence, 'server.log'), serverLog);
  rmSync(scratch, { recursive: true, force: true });
}
