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
writeFileSync(join(scratch, 'fake.mjs'), readFileSync('test/fake-pi.mjs', 'utf8').replaceAll('"alpha"', JSON.stringify(longModel)).replaceAll('fake/alpha', `fake/${longModel}`).replaceAll('timestamp: Date.now()', 'usage: { input: 120, output: 30, cacheRead: 50, cacheWrite: 10, totalTokens: 210, cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.0033 } }, timestamp: Date.now()').replace('contextWindow: 2000 } ]', 'contextWindow: 2000 }, { provider: "fake", id: "claude-sonnet", name: "Claude Sonnet", reasoning: true, contextWindow: 2000 }, { provider: "fake", id: "sol", name: "Sol Online Network", reasoning: false, contextWindow: 2000 } ]').replace('out({ type: "extension_ui_request", id: "live1", method: "input", title: "Running after response" });', '// Browser fixture: pause without a modal covering the composer.'));
writeFileSync(join(scratch, 'registry.json'), JSON.stringify({ projects: [cwd], worktrees: [], sessions: [{ cwd, sessionId: 'saved-without-context', title: 'Saved session', createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z', archived: false }] }));
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? '7171';
const frontendPort = process.env.PIANO_TEST_FRONTEND_PORT ?? '7172';
const backendUrl = `http://127.0.0.1:${backendPort}`;
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: backendPort, PIANO_CONFIG: join(scratch, 'registry.json'), PIANO_PI_CLI: join(scratch, 'fake.mjs'), PI_CODING_AGENT_DIR: join(scratch, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(scratch, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
const frontend = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', frontendPort, '--strictPort'], { cwd: resolve('web'), env: { ...process.env, PIANO_DEV_BACKEND: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
for (const proc of [server, frontend]) {
  proc.stdout.on('data', d => serverLog += d);
  proc.stderr.on('data', d => serverLog += d);
}
const appUrl = `http://127.0.0.1:${frontendPort}`;
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
function expectAction(label) {
  const labels = evaluate(`[...document.querySelectorAll('main button[aria-label="Stop"], main button[aria-label="Queue message"], main button[aria-label="Send"]')].map(button=>button.getAttribute('aria-label'))`);
  if (JSON.stringify(labels) !== JSON.stringify([label])) throw new Error(`Expected only ${label}, got ${labels.join(', ')}`);
}
async function until(js) {
  for (let i = 0; i < 20; i++) { if (evaluate(js)) return; await delay(100); }
  ab('snapshot');
  throw new Error(`Timed out: ${js}`);
}
const layoutOnly = process.argv.includes('--layout-only');
const views = layoutOnly ? [[320, 640], [390, 844]] : [[320, 640], [375, 812], [390, 844], [430, 932], [390, 400], [844, 390], [768, 1024], [1024, 768], [1280, 800]];
const geometry = `(() => {
  const t = document.querySelector('textarea');
  const card = t.closest('.composer-card');
  const footer = card.lastElementChild;
  const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
  const controls = [...footer.querySelectorAll('button, [data-slot="tooltip-trigger"]')].map(el => ({label:el.getAttribute('aria-label') || el.textContent, ...rect(el)}));
  const model = footer.querySelector('[aria-label^="Model:"]');
  const label = model?.querySelector('.truncate');
  const modelLabel = label ? { text:label.textContent, width:label.clientWidth, scrollWidth:label.scrollWidth,
    overflow:getComputedStyle(label).textOverflow, accessibleName:model.getAttribute('aria-label') } : null;
  const c = rect(card);
  const usage = document.querySelector('[aria-label="Session usage"]');
  const usageRect = usage ? rect(usage) : null;
  const fonts = [...card.querySelectorAll('textarea, button, span, label, input')].map(el=>({tag:el.tagName,family:getComputedStyle(el).fontFamily}));
  const problems = controls.filter(r => r.x < c.x || r.right > c.right + 1 || r.right > innerWidth || r.bottom > innerHeight || r.width < 24).map(r => r.label);
  if (usageRect && (usageRect.y < c.bottom || Math.abs(usageRect.right - c.right) > 1 || usageRect.bottom > innerHeight)) problems.push('Usage footer is not below and aligned with the composer inside the viewport');
  if (card.querySelector('[aria-label="Context usage"]')) problems.push('Context usage still occupies the action toolbar');
  if (fonts.some(font=>!font.family.includes(font.tag === 'TEXTAREA' ? 'Instrument Sans' : 'JetBrains Mono'))) problems.push('Message input must use sans-serif while composer controls stay monospace');
  const action = controls.find(r => ['Send', 'Stop', 'Queue message'].includes(r.label));
  if (action && controls.some(r => Math.abs(r.y + r.height/2 - action.y - action.height/2) > 2)) problems.push('Composer toolbar wraps instead of reserving the action row');
  const steer = card.querySelector('[aria-label="Steer"]');
  const messageActions = [...controls.filter(c => ['Send', 'Stop', 'Queue message'].includes(c.label)), ...(steer ? [{label:'Steer', ...rect(steer)}] : [])];
  if (innerWidth < 768 && messageActions.some(c => c.width < 44 || c.height < 44)) problems.push('Message action touch target is smaller than 44px');
  if (messageActions.some(action => action.x < c.x || action.right > c.right + 1 || action.right > innerWidth || action.bottom > innerHeight)) problems.push('Message action outside viewport');
  if (!modelLabel) problems.push('Model control is missing');
  if (modelLabel && modelLabel.width < 24) problems.push('No readable space left for the model label');
  if (modelLabel && !modelLabel.accessibleName.includes(modelLabel.text)) problems.push('Accessible model name was truncated');
  if (modelLabel && modelLabel.scrollWidth > modelLabel.width && modelLabel.overflow !== 'ellipsis') problems.push('Long model label does not ellipsize');
  const sidebar = document.querySelector('main [aria-label="Show sidebar"]');
  const navigation = sidebar ? rect(sidebar) : null;
  if (innerWidth < 768 && navigation && (navigation.y < 0 || navigation.bottom > innerHeight)) problems.push('Mobile navigation is outside the viewport');
  const queue = card.querySelector('[aria-label="Queued messages"]');
  if (queue && queue.scrollWidth > queue.clientWidth) problems.push('Queued text overflow');
  const overlaps = controls.flatMap((a,i) => controls.slice(i+1).filter(b => a.x < b.right-1 && b.x < a.right-1 && a.y < b.bottom-1 && b.y < a.bottom-1).map(b => a.label+' overlaps '+b.label));
  return { viewport:[innerWidth,innerHeight], coarse:matchMedia('(pointer: coarse)').matches, card:c, textarea:rect(t), footer:rect(footer), usage:usageRect, controls, fonts, modelLabel, navigation, documentScrollTop:scrollY, documentWidth:document.documentElement.scrollWidth, problems:[...problems,...overlaps] };
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
async function run() {
  for (let i=0;i<50;i++) {
    if (server.exitCode !== null || frontend.exitCode !== null) throw new Error(`Scratch process exited during startup: ${serverLog}`);
    try {
      const [backend, ui] = await Promise.all([fetch(`${backendUrl}/api/projects`), fetch(appUrl)]);
      if (backend.ok && ui.ok) break;
    } catch {}
    if (i===49) throw new Error('Scratch server did not start');
    await delay(100);
  }
  ab('--init-script', observe, '--args', '--blink-settings=primaryPointerType=2', 'open', `${appUrl}/s/saved-without-context`);
  ab('set', 'device', 'iPhone 16');
  ab('wait', '--text', 'Not running');
  ab('screenshot', join(evidence, 'saved-unknown-context.png'));
  if (layoutOnly) await capture('saved');
  if (evaluate(`document.querySelector('button[aria-label="Context usage"]')?.textContent.trim()`) !== '— context') throw new Error('Missing context must remain visible as unknown, not disappear');
  ab('click', '[aria-label="Context usage"]');
  ab('wait', '--text', 'Context usage unavailable');
  ab('press', 'Escape');
  ab('open', `${appUrl}/new`);
  if (!evaluate(`matchMedia('(pointer: coarse)').matches`)) throw new Error('Mobile fixture has no coarse pointer');
  await until(`!!document.querySelector('[aria-label^="Model:"]')?.title.includes('${longModel}')`);
  if (evaluate(`document.activeElement === document.querySelector('textarea')`)) throw new Error('New session auto-focused the mobile input');
  ab('fill', '[aria-label="First message"]', 'mobile first');
  ab('press', 'Enter');
  if (!evaluate(`document.querySelector('textarea').value === 'mobile first\\n'`)) throw new Error('Mobile Enter did not insert newline');
  await capture('new');
  if (layoutOnly) {
    if (failures.length) throw new Error(failures.join('\n'));
    console.log('PASS: both mobile toolbars stay on one row with a reserved primary touch target and an accessible truncated model label');
    return;
  }
  // Pointer actions, not DOM click: Radix pickers must remain reachable.
  ab('set', 'viewport', '320', '640');
  for (const label of ['Directory', 'Model']) {
    ab('click', label === 'Model' ? '[aria-label^="Model:"]' : `[aria-label="${label}"]`);
    ab('screenshot', join(evidence, `new-${label}-320.png`));
    const pop = evaluate(`(() => {const e=document.querySelector('[data-slot="popover-content"]');const r=e.getBoundingClientRect();return {x:r.x,right:r.right,width:innerWidth};})()`);
    writeFileSync(join(evidence, `new-${label}-popover.json`), JSON.stringify(pop));
    if (pop.x < 0 || pop.right > pop.width+1) failures.push(`${label} popover extends outside 320px viewport`);
    if (evaluate(`document.activeElement.tagName`) === 'INPUT') throw new Error(`${label} picker automatically focused search on a phone`);
    if (label === 'Model') {
      ab('focus', '[aria-label="First message"]');
      await until(`!document.querySelector('[aria-label="Model and effort"]')`);
      if (!evaluate(`document.activeElement.matches('[aria-label="First message"]')`)) throw new Error('Dismissal stole focus from the composer');
    } else ab('press', 'Escape');
  }
  // Reduced viewport checks exercise geometry, not a claim about the OS keyboard.
  ab('set', 'viewport', '390', '400');
  ab('click', '[aria-label^="Model:"]');
  const shortPopup = evaluate(`(() => { const r=document.querySelector('[aria-label="Model and effort"]').getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:innerHeight}; })()`);
  if (shortPopup.top < 0 || shortPopup.bottom > shortPopup.height) throw new Error('Settings popup overflows a short viewport');
  ab('screenshot', join(evidence, 'model-effort-short-viewport.png'));
  ab('press', 'Escape');
  ab('set', 'viewport', '320', '640');
  // One settings popup, full model names, native effort radios and no automatic prompt.
  const longAction = evaluate(geometry).controls.find(c => c.label === 'Send');
  evaluate(`window.draftInput=document.querySelector('textarea');draftInput.focus();draftInput.setSelectionRange(2,5);true`);
  ab('click', '[aria-label^="Model:"]');
  const option = `[data-value="fake/${longModel}"]`;
  const fullName = evaluate(`(() => { const e=document.querySelector('${option}'); return {text:e.innerText,width:e.clientWidth,scrollWidth:e.scrollWidth}; })()`);
  if (!fullName.text.includes(longModel) || fullName.scrollWidth > fullName.width) throw new Error('Full model name is not readable inside the picker');
  const pickerLayout = evaluate(`(() => {
    const pop=document.querySelector('[aria-label="Model and effort"]');
    const rows=[...pop.querySelectorAll('[cmdk-item]')];
    return {text:pop.textContent,close:!!pop.querySelector('[aria-label="Close model picker"]'),
      fonts:[...pop.querySelectorAll('input,span,label,legend')].map(e=>getComputedStyle(e).fontFamily),
      rows:rows.map(row=>{const label=row.querySelector('span'),check=row.querySelector('svg');return {
        text:label.textContent,left:label.getBoundingClientRect().left,right:label.getBoundingClientRect().right,
        checkLeft:check.getBoundingClientRect().left,checked:getComputedStyle(check).opacity==='1'};})};
  })()`);
  writeFileSync(join(evidence, 'model-picker-layout.json'), JSON.stringify(pickerLayout,null,2));
  if (pickerLayout.text.includes('Model and effort') || pickerLayout.close || pickerLayout.text.includes('default')) throw new Error('Retired model picker heading or default badge remains');
  if (pickerLayout.fonts.some(font=>!font.includes('JetBrains Mono'))) throw new Error('Settings popup is not monospace');
  if (pickerLayout.rows.some(row=>Math.abs(row.left-pickerLayout.rows[0].left)>1 || row.checkLeft<row.right)) throw new Error('Model labels are not left aligned with checks on the right');
  if (pickerLayout.rows.filter(row=>row.checked).map(row=>row.text).join() !== `fake/${longModel}`) throw new Error('Model selection check marks the wrong option');
  const visibleModels = () => evaluate(`[...document.querySelectorAll('[cmdk-item]')].filter(e=>e.getBoundingClientRect().height>0).map(e=>e.getAttribute('data-value'))`);
  const originalOrder = visibleModels();
  for (const [query, expected] of [['fake', originalOrder], ['beta', ['fake/beta']], ['fake', originalOrder], ['sonnet', ['fake/claude-sonnet']], ['  SoNnEt  ', ['fake/claude-sonnet']], ['sol', ['fake/sol']], ['Online', ['fake/sol']], ['ta', ['fake/beta']], ['no-such-model', []], ['', originalOrder]]) {
    if (query) ab('fill', '[aria-label="Search models"]', query);
    else { ab('focus', '[aria-label="Search models"]'); ab('press', 'Control+a'); ab('press', 'Backspace'); }
    const actual = visibleModels();
    writeFileSync(join(evidence, `model-order-${query || 'cleared'}.json`), JSON.stringify({query,expected,actual}, null, 2));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Search ${JSON.stringify(query)} returned incorrect models/order: ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
    if (!expected.length && !evaluate(`document.querySelector('[cmdk-empty]')?.textContent.includes('No model matches.')`)) throw new Error('Empty model search has no feedback');
  }
  ab('click', '[data-value="fake/beta"]');
  await until(`document.querySelector('[aria-label^="Model:"]').title === 'fake/beta' && document.querySelector('input[value="off"]')?.checked`);
  if (evaluate(`document.querySelectorAll('[aria-label="Effort"] input').length`) !== 1) throw new Error('Non-reasoning model exposed unsupported efforts');
  const shortAction = evaluate(geometry).controls.find(c => c.label === 'Send');
  if (longAction.x !== shortAction.x || longAction.y !== shortAction.y) throw new Error('Changing the model label moved Send');
  ab('click', option);
  ab('click', 'label:has(input[value="xhigh"])');
  await until(`document.querySelector('[aria-label^="Model:"]').getAttribute('aria-label').endsWith('effort: xhigh')`);
  ab('screenshot', join(evidence, 'new-model-effort-320.png'));
  ab('click', 'label:has(input[value="medium"])');
  ab('press', 'Escape');
  if (!evaluate(`document.activeElement.matches('[aria-label^="Model:"]') && draftInput === document.querySelector('textarea') && draftInput.value === 'mobile first\\n' && draftInput.selectionStart === 2 && draftInput.selectionEnd === 5`)) throw new Error('Settings lost the draft, selection, editor identity or return focus');
  if (evaluate(`sent.some(m=>m._tag==='create_session'||m.action?._tag==='prompt')`)) throw new Error('Settings sent a prompt');
  ab('click', '[aria-label="Send"]');
  await until(`!!document.querySelector('[aria-label="Message"]') && !document.querySelector('[aria-label="Stop"]')`);
  ab('fill', '[aria-label="Message"]', 'idle draft');
  expectAction('Send');
  await capture('idle');
  for (const [w,h] of [[390,400],[844,390]]) {
    ab('set', 'viewport', String(w), String(h));
    ab('fill', '[aria-label="Message"]', Array.from({length:24},(_,i)=>`Draft line ${i+1}`).join('\n'));
    const multiline = evaluate(geometry);
    writeFileSync(join(evidence, `multiline-${w}x${h}.json`), JSON.stringify(multiline,null,2));
    if (multiline.problems.length || multiline.textarea.height > h * 0.3 + 1) throw new Error('Multiline input displaced the controls in a short viewport');
    if (!evaluate(`document.querySelector('textarea').scrollHeight > document.querySelector('textarea').clientHeight`)) throw new Error('Long draft did not scroll within the input');
    ab('screenshot', join(evidence, `multiline-${w}x${h}.png`));
  }
  ab('fill', '[aria-label="Message"]', 'idle draft');
  ab('set', 'viewport', '320', '640');
  const idleAction = evaluate(geometry).controls.find(c => c.label === 'Send');
  ab('click', '[aria-label^="Model:"]');
  ab('click', 'label:has(input[value="xhigh"])');
  await until(`document.querySelector('[aria-label^="Model:"]').getAttribute('aria-label').endsWith('effort: xhigh')`);
  ab('press', 'Escape');
  const changedAction = evaluate(geometry).controls.find(c => c.label === 'Send');
  if (idleAction.x !== changedAction.x || idleAction.y !== changedAction.y) throw new Error('Changing effort moved Send');
  if (evaluate(`document.querySelector('textarea').value`) !== 'idle draft') throw new Error('Changing effort discarded the active session draft');
  ab('screenshot', join(evidence, 'idle-xhigh-320.png'));
  if (evaluate(`document.querySelector('[aria-label="Context usage"]').textContent.trim()`) !== '1% context') throw new Error('Settled context must show percentage used');
  if (evaluate(`document.querySelector('[aria-label="Session usage"]').textContent.trim().replace(/\\s+/g, ' ')`) !== '1% context·$0.02') throw new Error('Usage footer must show session cost alongside context');
  ab('click', '[aria-label="Context usage"]');
  ab('wait', '--text', '2,400 tokens');
  ab('press', 'Escape');
  ab('fill', '[aria-label="Message"]', 'live context');
  ab('click', '[aria-label="Send"]');
  await until(`!!document.querySelector('[aria-label="Stop"]') && document.querySelector('[aria-label="Context usage"]')?.textContent.trim() === '21% context'`);
  expectAction('Stop');
  ab('fill', '[aria-label="Message"]', ' \n  ');
  expectAction('Stop');
  ab('fill', '[aria-label="Message"]', 'queued draft');
  expectAction('Queue message');
  await capture('streaming');
  // Exercise the actual actions at the narrowest phone width, not just their geometry.
  ab('set', 'viewport', '320', '640');
  ab('click', '[aria-label="Queue message"]');
  await until(`document.querySelector('[aria-label="Message"]').value === ''`);
  expectAction('Stop');
  ab('wait', '--text', 'Queued messages (1)');
  ab('fill', '[aria-label="Message"]', `queued second ${'x'.repeat(80)}`);
  expectAction('Queue message');
  ab('click', '[aria-label="Queue message"]');
  ab('wait', '--text', 'Queued messages (2)');
  const queueText = () => evaluate(`[...document.querySelectorAll('[aria-label="Queued messages"] li')].map(li=>li.lastElementChild.textContent)`);
  const followUps = ['queued draft', `queued second ${'x'.repeat(80)}`];
  if (JSON.stringify(queueText()) !== JSON.stringify(followUps)) throw new Error('Accepted queued messages are missing or reordered');
  if (evaluate(`document.querySelector('[aria-label="Queued messages"]').textContent.includes('Follow-up')`)) throw new Error('All-follow-up queue has redundant labels');
  ab('fill', '[aria-label="Message"]', 'mobile steering');
  ab('press', 'Enter');
  if (!evaluate(`document.querySelector('textarea').value === 'mobile steering\\n'`)) throw new Error('Mobile Enter submitted instead of inserting a newline');
  ab('click', '[aria-label="Steer"]');
  ab('wait', '--text', 'Queued messages (3)');
  const mixedQueue = ['mobile steering', ...followUps];
  if (JSON.stringify(queueText()) !== JSON.stringify(mixedQueue)) throw new Error('Mobile Steer did not enter the authoritative steering queue');
  if (evaluate(`[...document.querySelectorAll('[aria-label="Queued messages"] li')].map(li=>li.firstElementChild.textContent).join(',')`) !== 'Steering,Follow-up,Follow-up') throw new Error('Mixed queue does not distinguish message kinds');
  if (evaluate(`sent.filter(m=>m.action?._tag==='steer').length`) !== 1) throw new Error('Mobile Steer did not submit exactly once');
  if (evaluate(`[...document.querySelectorAll('article')].some(article=>article.textContent.includes('queued draft'))`)) throw new Error('Pending input was incorrectly added to completed history');
  await capture('queued');
  if (!evaluate(`(() => { const q=document.querySelector('[aria-label="Queued messages"]'); return q.scrollWidth<=q.clientWidth; })()`)) throw new Error('Queue text overflows');
  ab('reload');
  ab('wait', '--text', 'Queued messages (3)');
  if (JSON.stringify(queueText()) !== JSON.stringify(mixedQueue)) throw new Error('Reload lost the authoritative queue snapshot');
  ab('set', 'viewport', '320', '640');
  ab('screenshot', join(evidence, 'queued-after-reload.png'));
  expectAction('Stop');
  ab('fill', '[aria-label="Message"]', 'unsent draft');
  expectAction('Queue message');
  ab('focus', '[aria-label="Message"]');
  ab('press', 'Control+a');
  ab('press', 'Backspace');
  expectAction('Stop');
  ab('click', '[aria-label="Stop"]');
  await until(`!document.querySelector('[aria-label="Stop"]')`);
  expectAction('Send');
  ab('wait', '--text', 'Paused queue (3)');
  if (JSON.stringify(queueText()) !== JSON.stringify(mixedQueue)) throw new Error('Stop consumed the queue instead of pausing it');
  if (evaluate(`[...document.querySelectorAll('article')].some(article=>article.textContent.includes('queued draft'))`)) throw new Error('Stop automatically resent a pending message');
  ab('screenshot', join(evidence, 'paused-queue.png'));
  const originalTab = JSON.parse(ab('tab', 'list', '--json')).data.tabs.find(tab => tab.active).tabId;
  ab('tab', 'new', '--label', 'peer', ab('get', 'url'));
  ab('wait', '--text', 'Paused queue (3)');
  ab('fill', '[aria-label="Message"]', 'other tab draft');
  ab('tab', originalTab);
  ab('fill', '[aria-label="Message"]', 'my unsent draft');
  const promptsBeforeRestore = evaluate(`sent.filter(m=>m._tag==='create_session'||m.action?._tag==='prompt').length`);
  ab('click', '[aria-label="Restore queued messages to draft"]');
  const restoredText = `my unsent draft\n\nmobile steering\n\nqueued draft\n\nqueued second ${'x'.repeat(80)}`;
  await until(`document.querySelector('[aria-label="Message"]').value === ${JSON.stringify(restoredText)} && !document.querySelector('[aria-label="Queued messages"]')`);
  expectAction('Send');
  if (evaluate(`sent.filter(m=>m._tag==='create_session'||m.action?._tag==='prompt').length`) !== promptsBeforeRestore) throw new Error('Restore automatically sent a prompt');
  ab('screenshot', join(evidence, 'restored-draft.png'));
  ab('tab', 'peer');
  await until(`!document.querySelector('[aria-label="Queued messages"]')`);
  if (evaluate(`document.querySelector('[aria-label="Message"]').value`) !== 'other tab draft') throw new Error('Restoring in one tab changed another tab draft');
  ab('tab', 'close', 'peer');
  ab('tab', originalTab);
  // Explicit Send, not restore, starts the next prompt; the mobile control remains reachable.
  ab('click', '[aria-label="Send"]');
  ab('wait', '--text', 'echo: my unsent draft');
  if (evaluate(`sent.filter(m=>m.action?._tag==='prompt').at(-1).action.text`) !== restoredText) throw new Error('Manual Send did not submit the recovered draft');
  if (evaluate(`document.querySelector('[aria-label="Context usage"]').textContent.trim()`) !== '21% context') throw new Error('Context percentage disappeared after settlement');
  ab('click', '[aria-label="Context usage"]');
  ab('wait', '--text', '42,000 tokens');
  ab('wait', '--text', 'Cache read');
  ab('wait', '--text', 'Cache write');
  ab('wait', '--text', '$0.0033');
  ab('click', '[aria-label="Show cost history"]');
  if (!evaluate(`document.querySelector('svg[aria-label^="Cost history"]') !== null`)) throw new Error('Cost history did not switch');
  ab('focus', '[aria-label="Inspect response"]');
  ab('press', 'Home');
  if (evaluate(`document.querySelector('[aria-label="Inspect response"]').value`) !== '1') throw new Error('Response history is not keyboard inspectable');
  if (!evaluate(`(() => { const r = document.querySelector('[aria-label="Context usage details"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`)) throw new Error('Context popup escapes mobile viewport');
  ab('screenshot', join(evidence, 'settled-context-details.png'));
  ab('press', 'Escape');
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
  ab('click', '[aria-label^="Model:"]');
  if (evaluate(`document.activeElement.getAttribute('aria-label')`) !== 'Search models') throw new Error('Desktop settings did not focus search');
  ab('focus', 'input[value="xhigh"]');
  ab('press', 'ArrowLeft');
  await until(`document.querySelector('input[value="high"]')?.checked && document.querySelector('[aria-label^="Model:"]').getAttribute('aria-label').endsWith('effort: high')`);
  ab('screenshot', join(evidence, 'desktop-keyboard-effort.png'));
  ab('press', 'Escape');
  await until(`document.activeElement.matches('[aria-label^="Model:"]')`);
  // Moving keyboard focus or clicking outside dismisses without stealing it back.
  ab('click', '[aria-label^="Model:"]');
  ab('focus', '[aria-label="Message"]');
  await until(`!document.querySelector('[aria-label="Model and effort"]')`);
  if (!evaluate(`document.activeElement.matches('[aria-label="Message"]')`)) throw new Error('Focus-out dismissal stole editor focus');
  ab('click', '[aria-label^="Model:"]');
  // The settings popup can cover the editor's centre; click its exposed left edge.
  const editorPoint = evaluate(`(() => { const r = document.querySelector('[aria-label="Message"]').getBoundingClientRect(); return {x:r.left+8,y:r.top+8}; })()`);
  ab('mouse', 'move', String(editorPoint.x), String(editorPoint.y));
  ab('mouse', 'down'); ab('mouse', 'up');
  await until(`!document.querySelector('[aria-label="Model and effort"]')`);
  ab('click', '[aria-label^="Model:"]');
  const focusedTab = JSON.parse(ab('tab', 'list', '--json')).data.tabs.find(tab => tab.active).tabId;
  ab('tab', 'new', '--label', 'focus-away', 'about:blank');
  ab('tab', focusedTab);
  await until(`!document.querySelector('[aria-label="Model and effort"]')`);
  ab('tab', 'close', 'focus-away'); ab('tab', focusedTab);
  ab('fill', '[aria-label="Message"]', 'desktop');
  ab('press', 'Shift+Enter');
  if (!evaluate(`document.querySelector('textarea').value === 'desktop\\n'`)) throw new Error('Shift+Enter did not insert newline');
  ab('press', 'Alt+Enter');
  await until(`document.querySelector('textarea').value === ''`);
  ab('fill', '[aria-label="Message"]', 'live context');
  ab('press', 'Enter');
  await until(`!!document.querySelector('[aria-label="Stop"]')`);
  ab('fill', '[aria-label="Message"]', 'desktop follow-up');
  ab('press', 'Enter');
  ab('wait', '--text', 'Queued messages (1)');
  if (evaluate(`document.querySelector('[aria-label="Queued messages"]').textContent.includes('Follow-up')`)) throw new Error('Desktop all-follow-up queue has redundant labels');
  ab('fill', '[aria-label="Message"]', 'desktop steering');
  ab('press', 'Alt+Enter');
  ab('wait', '--text', 'Queued messages (2)');
  if (JSON.stringify(queueText()) !== JSON.stringify(['desktop steering', 'desktop follow-up'])) throw new Error('Alt+Enter did not steer or Enter did not follow up');
  if (evaluate(`sent.filter(m=>m.action?._tag==='steer').length`) !== 2) throw new Error('Alt+Enter did not submit exactly once per use (idle and busy)');
  ab('screenshot', join(evidence, 'desktop-steering.png'));
  ab('click', '[aria-label="Stop"]');
  ab('wait', '--text', 'Paused queue (2)');
  ab('errors');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ failures }, null, 2));
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: single-row toolbars and full accessible model names; model/effort selection, no mobile autofocus, stable actions, context, queue/reload/pause/native restore, peer-tab isolation, keyboard and in-place mobile reconnect');
  process.exitCode = failures.length ? 1 : 0;
}
try { await run(); }
catch (e) { console.error(e); process.exitCode = 1; }
finally {
  try { ab('close'); } catch {}
  for (const proc of [server, frontend]) proc.kill('SIGTERM');
  await Promise.all([server, frontend].map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(r => proc.once('exit', r))));
  writeFileSync(join(evidence, 'browser-commands.json'), JSON.stringify(log, null, 2));
  writeFileSync(join(evidence, 'server.log'), serverLog);
  rmSync(scratch, { recursive: true, force: true });
}
