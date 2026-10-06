// First UX pass: real browser clipboard, keyboard disclosures, reduced motion and
// responsive navigation. Scratch-only, fake Pi, no paid model calls.
// node test/browser-ui-polish.mjs <evidence-directory>
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const evidence = resolve(process.argv[2] ?? '/tmp/piano-ui-polish-evidence/browser');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'piano-ui-polish-'));
const repo = join(root, 'piano-studio'), sessions = join(root, 'sessions');
for (const path of [repo, sessions, join(root, 'agent'), join(root, 'home'), join(root, 'config')]) mkdirSync(path);
const env = { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { env });
git('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'app.ts'), 'export const greeting = "Hello, Piano";\n'); git('add', '.'); git('commit', '-qm', 'Initial app');
const timestamp = new Date().toISOString();
const reply = '### A quieter place to work\n\nThe layout gives the conversation more room, while keeping the things you need close by.\n\n- **A clear starting point.** Your next message is the focus.\n- **Less visual noise.** Secondary details stay out of the way.\n- **Small, useful feedback.** Interactions feel connected, not abrupt.\n\n```tsx\n<Workspace>\n  <Conversation />\n  <Composer />\n</Workspace>\n```\n\nTry switching sessions and coming back. It should feel like picking up where you left off.';
const assistant = text => ({ role: 'assistant', api: 'openai-completions', provider: 'fake', model: 'alpha', stopReason: 'stop', content: [{ type: 'text', text }] });
const stories = [
  ['daily-ui', 'A calmer workspace', [
    { role: 'user', content: 'Let’s make this workspace feel a little more welcoming. Keep it simple, but give the details some care.' },
    { ...assistant('I’ll start with the parts you touch every day: the sidebar, the conversation, and the composer.'), content: [
      { type: 'text', text: 'I’ll start with the parts you touch every day: the sidebar, the conversation, and the composer.' },
      { type: 'toolCall', id: 'read-app', name: 'read', arguments: { path: 'web/src/components/session transcript with long directory names/MessageList.tsx' } },
    ] },
    { role: 'toolResult', toolCallId: 'read-app', toolName: 'read', content: [{ type: 'text', text: 'export default function App() {\n  return <Workspace />;\n}' }], isError: false },
    assistant(reply),
  ]],
  ['navigation', 'Simplify project navigation', [{ role: 'user', content: 'Make the project navigation easier to scan.' }]],
];
for (const [id, , messages] of stories) {
  const entries = [{ type: 'session', version: 3, id, cwd: repo, timestamp }, ...messages.map((message, n) => ({
    type: 'message', id: `m${n}`, parentId: n ? `m${n - 1}` : null, timestamp, message: { ...message, timestamp: n },
  }))];
  writeFileSync(join(sessions, `${id}.jsonl`), entries.map(JSON.stringify).join('\n') + '\n');
}
writeFileSync(join(root, 'registry.json'), JSON.stringify({ projects: [repo], worktrees: [], sessions: stories.map(([sessionId, title]) => ({
  cwd: repo, sessionId, title, createdAt: timestamp, updatedAt: timestamp, archived: false,
})) }));
const backend = spawn(process.execPath, ['server/main.ts'], { env: { ...env, HOST: '127.0.0.1', PORT: '7171',
  PIANO_CONFIG: join(root, 'registry.json'), PIANO_PI_CLI: resolve('test/fake-host-pi.mjs'), PIANO_PI_ARGS: '',
  PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: sessions }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '7172', '--strictPort'], {
  cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: 'http://127.0.0.1:7171' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let processLog = '';
for (const proc of [backend, frontend]) { proc.stdout.on('data', d => processLog += d); proc.stderr.on('data', d => processLog += d); }
const session = `ui-polish-${process.pid}`, commands = [], observations = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn('npx', ['agent-browser', '--session', session, ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '15000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; proc.stdout.on('data', d => stdout += d); proc.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => proc.kill('SIGTERM'), 25000);
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  commands.push({ args, ...result }); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
}
const evaluate = async js => JSON.parse(await ab('eval', js));
const click = name => ab('find', 'role', 'button', 'click', '--name', name, '--exact');
async function capture(name) {
  await ab('screenshot', join(evidence, `${name}.png`));
  writeFileSync(join(evidence, `${name}.txt`), await ab('snapshot'));
}
async function appearance(name) {
  await click('Appearance'); await ab('find', 'role', 'menuitemradio', 'click', '--name', name, '--exact');
}
const tool = '[aria-label="read tool call"] button[aria-expanded]';
const project = 'aside nav button[aria-expanded]';
const argVisible = `document.getElementById(document.querySelector('${tool}').getAttribute('aria-controls'))?.textContent.includes('"path"')`;
async function checkGeometry(name) {
  const observed = await evaluate(`(() => {
    const textarea = document.querySelector('textarea'), card = textarea.parentElement;
    const bounds = el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
    const controls = [...card.querySelectorAll('button')].map(el=>({name:el.getAttribute('aria-label')||el.textContent,...bounds(el)}));
    return {viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,card:bounds(card),controls,
      textOverflow:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth};
  })()`);
  observations.push({ name, ...observed });
  assert.ok(observed.documentWidth <= observed.viewport[0], `${name}: document overflow`);
  assert.equal(observed.textOverflow, false, `${name}: main overflow`);
  for (const control of observed.controls) {
    assert.ok(control.left >= observed.card.left && control.right <= observed.card.right + 1, `${name}: ${control.name} outside composer`);
    assert.ok(control.top >= 0 && control.bottom <= observed.viewport[1] + 1, `${name}: ${control.name} outside viewport`);
  }
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null); assert.equal(frontend.exitCode, null);
    try { if ((await fetch('http://127.0.0.1:7171/api/projects')).ok && (await fetch('http://127.0.0.1:7172')).ok) break; } catch {}
    if (n === 99) throw new Error('Scratch startup deadline'); await delay(100);
  }
  await ab('set', 'viewport', '1440', '1000');
  await ab('open', 'http://127.0.0.1:7172/s/daily-ui');
  await ab('wait', '--text', 'A quieter place to work');
  // INV-01: the retired transcript filter must not hide authoritative history,
  // even for browsers that saved the old replies-only preference.
  await evaluate(`localStorage.setItem('piano.transcriptView', 'replies'); true`);
  await ab('reload'); await ab('wait', '--text', 'A quieter place to work');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="read tool call"]')`), true);
  assert.ok(await evaluate(`document.querySelector('main').textContent.includes('I’ll start with the parts you touch every day')`));
  assert.equal(await evaluate(`!!document.querySelector('main [aria-label="Session menu"], main [aria-label="Session information"]')`), false);
  assert.equal(await evaluate(`document.querySelector('main header').getBoundingClientRect().height`), 0, 'no empty desktop header');
  // The tool outcome dot and its label share a visual centre, including wrapped
  // summaries after opening details. Observe layout, not Tailwind class names.
  for (const width of [1440, 320]) {
    await ab('set', 'viewport', String(width), '1000');
    for (const expanded of [false, true]) {
      if (expanded) await ab('click', tool);
      const alignment = await evaluate(`(() => {
        const group=document.querySelector('[aria-label="read tool call"]');
        const dot=group.querySelector('[aria-hidden] > span');
        const label=group.querySelector('button[aria-expanded] > span');
        const centre=e=>{const r=e.getBoundingClientRect();return r.top+r.height/2;};
        const summary=label.nextElementSibling;
        return {dot:centre(dot),label:centre(label),summaryLines:summary.getBoundingClientRect().height/parseFloat(getComputedStyle(summary).lineHeight)};
      })()`);
      observations.push({name:'tool-alignment',width,expanded,...alignment});
      writeFileSync(join(evidence, 'tool-alignment.json'), JSON.stringify(observations, null, 2));
      assert.ok(Math.abs(alignment.dot-alignment.label) <= 1, `${width}px expanded=${expanded}: dot and label differ by ${Math.abs(alignment.dot-alignment.label)}px`);
      if (width === 320 && expanded) assert.ok(alignment.summaryLines >= 2, 'exercise a wrapped tool summary');
      if (expanded) await ab('click', tool);
    }
  }
  await ab('set', 'viewport', '1440', '1000');
  await appearance('Light'); await capture('session-light');
  assert.equal(await evaluate(`document.querySelector('aside [aria-current="page"]')?.title`), 'A calmer workspace');
  // Native clipboard success: paste back into the composer, preserving raw Markdown.
  await click('Copy response'); await ab('wait', '--fn', `!!document.querySelector('[aria-label="Response copied"]')`);
  await ab('focus', '[aria-label="Message"]'); await ab('press', 'Control+v');
  assert.equal(await evaluate(`document.querySelector('textarea').value`), reply);
  await ab('fill', '[aria-label="Message"]', 'Keep my draft');
  // Denied clipboard writes must not claim success or discard selectable reply text.
  await ab('wait', '--fn', `!!document.querySelector('[aria-label="Copy response"]')`);
  await evaluate(`window.nativeWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = async () => { throw new DOMException('Denied','NotAllowedError'); }; true`);
  await click('Copy response'); await ab('wait', '--text', 'Couldn’t copy. Select the reply text to copy it.');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Response copied"]')`), false);
  assert.equal(await evaluate(`document.querySelector('textarea').value`), 'Keep my draft');
  await evaluate('navigator.clipboard.writeText=window.nativeWrite;true');
  await capture('copy-denied');
  // Keyboard interaction must survive animated mount/unmount. Closing details keeps
  // their trigger focused, while output previews remain available.
  await ab('focus', tool); await ab('press', 'Enter'); await ab('wait', '--fn', argVisible);
  assert.ok(await evaluate(`getComputedStyle(document.getElementById(document.querySelector('${tool}').getAttribute('aria-controls'))).animationName !== 'none'`));
  await capture('tool-expanded');
  await ab('press', 'Enter'); await ab('wait', '--fn', `!(${argVisible})`);
  assert.ok(await evaluate(`document.activeElement.matches('${tool}')`));
  assert.ok(await evaluate(`document.querySelector('[aria-label="read tool call"]').textContent.includes('return <Workspace />;')`));
  await ab('focus', project); await ab('press', 'Enter');
  await ab('wait', '--fn', `!document.querySelector('aside button[title="A calmer workspace"]')`);
  assert.ok(await evaluate(`document.activeElement.matches('${project}')`));
  await ab('press', 'Enter'); await ab('wait', '--fn', `!!document.querySelector('aside button[title="A calmer workspace"]')`);
  await ab('click', 'aside button[title="Simplify project navigation"]');
  await ab('wait', '--text', 'Make the project navigation easier to scan.');
  await ab('click', 'aside button[title="A calmer workspace"]'); await ab('wait', '--text', 'A quieter place to work');
  assert.equal(await evaluate(`document.querySelector('textarea').value`), 'Keep my draft');
  await ab('fill', '[aria-label="Message"]', '');
  await appearance('Dark'); await capture('session-dark');
  await click('New session'); await ab('wait', '--text', 'What should we work on?'); await capture('new-dark');
  await appearance('Light'); await capture('new-light');
  for (const [w,h] of [[320,640],[390,844],[844,390],[768,1024],[1440,1000]]) {
    await ab('set', 'viewport', String(w), String(h)); await checkGeometry(`new-${w}x${h}`);
  }
  // Motion preference covers entrance, disclosures, overlays, buttons and the
  // pseudo-element streaming caret, not just the original activity dot.
  await ab('set', 'media', 'light', 'reduced-motion');
  await ab('open', 'http://127.0.0.1:7172/new'); await ab('wait', '--text', 'What should we work on?');
  assert.ok(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.welcome-enter')].map(e=>getComputedStyle(e).animationName)`), ['none', 'none']);
  await ab('open', 'http://127.0.0.1:7172/s/daily-ui'); await ab('wait', '--text', 'A quieter place to work');
  await ab('focus', tool); await ab('press', 'Enter'); await ab('wait', '--fn', argVisible);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById(document.querySelector('${tool}').getAttribute('aria-controls'))).animationName`), 'none');
  await ab('press', 'Enter'); await ab('wait', '--fn', `!(${argVisible})`);
  await ab('fill', '[aria-label="Message"]', '/partial'); await click('Send'); await ab('wait', '--text', 'Partial daily-ui');
  assert.equal(await evaluate(`document.querySelector('main').innerText.includes('Esc to stop')`), false, 'no redundant working/timer row');
  const motion = await evaluate(`(() => {
    const button=document.querySelector('[aria-label="Stop"]'), r=button.getBoundingClientRect();
    return {animations:document.getAnimations().length,caret:getComputedStyle([...document.querySelectorAll('.prose-chat')].at(-1),'::after').animationName,
      button:getComputedStyle(button).transitionDuration,notices:document.querySelectorAll('[data-sonner-toast]').length,
      stopReachable:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
  })()`);
  observations.push({ name: 'reduced-motion-streaming', ...motion });
  assert.equal(motion.animations, 0); assert.equal(motion.caret, 'none'); assert.equal(motion.button, '0s');
  assert.ok(motion.notices > 0, 'Exercise Stop while a notification is present');
  assert.ok(motion.stopReachable, 'A notification must not cover Stop');
  await click('Stop');
  // Chromium's existing desktop context keeps its fine pointer after `set device`.
  // Launch a genuinely coarse-pointer browser, then apply the phone viewport.
  assert.equal(await ab('errors'), '');
  await ab('close');
  await ab('--args', '--blink-settings=primaryPointerType=2', 'open', 'http://127.0.0.1:7172/s/daily-ui');
  await ab('wait', '--text', 'A quieter place to work');
  await ab('set', 'media', 'light', 'reduced-motion');
  // No hover dependency for copy; the named sidebar restores focus to its opener.
  await ab('set', 'device', 'iPhone 16'); await ab('set', 'viewport', '390', '844');
  await ab('fill', '[aria-label="Message"]', 'Mobile draft');
  await click('Show sidebar'); await ab('wait', '--fn', `document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')`);
  await capture('mobile-navigation');
  await ab('press', 'Escape'); await ab('wait', '--fn', `document.activeElement?.getAttribute('aria-label')==='Show sidebar'`);
  assert.equal(await evaluate(`document.querySelector('textarea').value`), 'Mobile draft');
  assert.ok(await evaluate(`matchMedia('(pointer: coarse)').matches`));
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Copy response"]')).opacity`), '1');
  for (const [w,h] of [[320,640],[390,844],[844,390]]) {
    await ab('set', 'viewport', String(w), String(h)); await checkGeometry(`session-${w}x${h}`); await capture(`mobile-session-${w}`);
    assert.equal(await evaluate(`!!document.querySelector('main [aria-label="Session menu"], main [aria-label="Session information"]')`), false);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('main header button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getAttribute('aria-label'))`), w < 768 ? ['Show sidebar'] : []);
  }
  assert.equal(await ab('errors'), '');
  console.log('PASS: native copy/paste and denied copy; keyboard disclosures; session draft retention; light/dark layouts; reduced-motion entrance/disclosures/streaming; mobile controls, copy visibility and sidebar focus');
} finally {
  try { await ab('close'); } catch {}
  for (const proc of [backend, frontend]) if (proc.exitCode === null) { const stopped = new Promise(resolve => proc.once('exit', resolve)); proc.kill('SIGTERM'); await stopped; }
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
  writeFileSync(join(evidence, 'process.log'), processLog);
  rmSync(root, { recursive: true, force: true });
}
