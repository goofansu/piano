// Scratch-only browser contract: npx agent-browser, fake Pi, no paid model calls.
// Run: node test/browser-attachments.mjs /tmp/piano-attachments-evidence
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const evidence = resolve(process.argv[2] ?? '/tmp/piano-attachments-evidence');
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'piano-attachments-'));
const cwd = join(scratch, 'project'); mkdirSync(cwd); spawnSync('git', ['init', cwd]);
writeFileSync(join(scratch, 'registry.json'), JSON.stringify({ projects: [cwd], worktrees: [], sessions: [] }));
const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=';
const image = join(scratch, 'pixel.png'); writeFileSync(image, Buffer.from(data, 'base64'));
const invalid = join(scratch, 'notes.txt'); writeFileSync(invalid, 'Not an image');
const oversized = join(scratch, 'large.png'); writeFileSync(oversized, Buffer.alloc(5 * 1024 * 1024 + 1));
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171';
const frontendPort = process.env.PIANO_TEST_FRONTEND_PORT ?? '7172';
const backendUrl = `http://127.0.0.1:${backendPort}`, appUrl = `http://127.0.0.1:${frontendPort}`;
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: backendPort, PIANO_CONFIG: join(scratch, 'registry.json'), PIANO_PI_CLI: resolve('test/fake-pi.mjs'), PI_CODING_AGENT_DIR: join(scratch, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(scratch, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', frontendPort, '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; for (const proc of [server, frontend]) { proc.stdout.on('data', d => serverLog += d); proc.stderr.on('data', d => serverLog += d); }
const session = `attachments-${process.pid}`, log = [];
function ab(...args) {
  const r = spawnSync('npx', ['agent-browser', '--session', session, ...args], { encoding: 'utf8', timeout: 45000 });
  log.push({ args, status: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}
function evaluate(js) { return JSON.parse(ab('eval', js)); }
async function until(js) {
  for (let i = 0; i < 30; i++) { if (evaluate(js)) return; await delay(100); }
  throw new Error(`Timed out: ${js}`);
}
const attached = `document.querySelectorAll('[aria-label="Attachments"] li').length`;
const transcriptImages = `document.querySelectorAll('img[alt="Attached image"]').length`;
try {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null || frontend.exitCode !== null) throw new Error(serverLog);
    try { if ((await fetch(`${backendUrl}/api/projects`)).ok && (await fetch(appUrl)).ok) break; } catch {}
    if (i === 59) throw new Error('Scratch startup failed'); await delay(100);
  }
  ab('open', `${appUrl}/new`);
  await until(`!!document.querySelector('[aria-label^="Model:"]')?.title.includes('alpha')`);
  ab('upload', 'input[type="file"]', invalid);
  ab('wait', '--text', "Other files aren't supported yet");
  ab('upload', 'input[type="file"]', oversized);
  ab('wait', '--text', 'up to 5 MiB');
  ab('upload', 'input[type="file"]', image);
  await until(`${attached} === 1`);
  ab('click', '[aria-label="Remove pixel.png"]'); assert.equal(evaluate(attached), 0);
  ab('upload', 'input[type="file"]', image); await until(`${attached} === 1`);
  ab('set', 'viewport', '320', '700');
  ab('screenshot', join(evidence, 'new-mobile.png'));
  assert.equal(evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.equal(evaluate(`document.querySelector('[aria-label="Send"]').disabled`), false, 'image-only send enabled');
  ab('click', '[aria-label="Send"]');
  await until(`${transcriptImages} === 1`);
  await until(`document.querySelector('img[alt="Attached image"]').naturalWidth === 1`);
  const url = evaluate(`document.querySelector('img[alt="Attached image"]').getAttribute('src')`);
  const response = evaluate(`(async () => {const r=await fetch('${url}');return {type:r.headers.get('content-type'),nosniff:r.headers.get('x-content-type-options'),data:btoa(String.fromCharCode(...new Uint8Array(await r.arrayBuffer())))};})()`);
  assert.equal(response.type, 'image/png');
  assert.equal(response.nosniff, 'nosniff');
  assert.equal(response.data, data);
  ab('reload'); await until(`${transcriptImages} === 1`);
  // Paste, then remove; drop, then send a follow-up with text.
  function fileEvent(type, name) {
    evaluate(`(() => {const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('${data}'),c=>c.charCodeAt(0))],'${name}',{type:'image/png'}));const el=document.querySelector('textarea');el.dispatchEvent(${type === 'paste' ? "new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true})" : "new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true})"});return true;})()`);
  }
  fileEvent('paste', 'pasted.png'); await until(`${attached} === 1`);
  ab('click', '[aria-label="Remove pasted.png"]');
  fileEvent('drop', 'dropped.png'); await until(`${attached} === 1`);
  ab('fill', '[aria-label="Message"]', 'describe image');
  ab('click', '[aria-label="Send"]');
  ab('wait', '--text', 'echo: describe image'); await until(`${transcriptImages} === 2`);
  assert.equal(evaluate(attached), 0);
  // Draft stays scoped and survives navigation without becoming a new session's upload.
  ab('upload', 'input[type="file"]', image); await until(`${attached} === 1`);
  evaluate(`(() => {const native=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(file){window.finishImageRead=()=>{FileReader.prototype.readAsDataURL=native;native.call(this,file);};};return true;})()`);
  fileEvent('paste', 'slow.png'); await until(`typeof window.finishImageRead === 'function'`);
  ab('set', 'viewport', '1280', '800');
  const sessionTitle = evaluate(`document.querySelector('button[aria-current="page"]').title`);
  ab('find', 'role', 'button', 'click', '--name', 'New session', '--exact'); await until(`!!document.querySelector('[aria-label="First message"]')`);
  assert.equal(evaluate(attached), 0);
  ab('click', `button[title="${sessionTitle}"]`); await until(`${attached} === 1`);
  assert.equal(evaluate(`document.querySelector('[aria-label="Attach images"]').disabled`), true, 'reading state survives navigation');
  evaluate(`(() => {window.finishImageRead();return true;})()`); await until(`${attached} === 2`);
  ab('click', '[aria-label="Remove slow.png"]');
  ab('set', 'viewport', '320', '700');
  ab('click', '[aria-label="Remove pixel.png"]');
  ab('screenshot', join(evidence, 'session-mobile.png'));
  assert.equal(evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  ab('set', 'viewport', '1280', '800'); ab('screenshot', join(evidence, 'session-desktop.png'));
  ab('snapshot', '-i');
  console.log('PASS: validation, picker/remove/reselect, image-only creation, paste/drop follow-up, image bytes, reload, scoped drafts, mobile and desktop. Fake Pi; no real model claim.');
} finally {
  try { ab('close'); } catch {}
  server.kill('SIGTERM'); frontend.kill('SIGTERM');
  writeFileSync(join(evidence, 'browser.json'), JSON.stringify(log, null, 2));
  writeFileSync(join(evidence, 'server.log'), serverLog);
  rmSync(scratch, { recursive: true, force: true });
}
