// Run against scratch servers only:
// node test/browser-theme.mjs http://127.0.0.1:7172 /tmp/piano-theme-evidence
// INV-09: verifies browser metadata, not native iOS Safari chrome rendering.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:7172';
const evidence = resolve(process.argv[3] ?? '/tmp/piano-theme-evidence');
mkdirSync(evidence, { recursive: true });
const session = `theme-${process.pid}`;
const commands = [];
function ab(...args) {
  try {
    const output = execFileSync('npx', ['agent-browser', '--session', session, ...args], { encoding: 'utf8', timeout: 30000 });
    commands.push({ args, output });
    return output.trim();
  } catch (error) {
    commands.push({ args, error: error.message, stdout: error.stdout, stderr: error.stderr });
    throw error;
  }
}
function check(mode) {
  const color = mode === 'dark' ? '#0b0c0f' : '#f6f4f0';
  ab('wait', '--fn', `document.documentElement.classList.contains('${mode}') && document.querySelector('meta[name="theme-color"]')?.content === '${color}'`);
  const state = JSON.parse(ab('eval', `(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const probe = document.createElement('div');
    probe.style.backgroundColor = meta.content;
    document.body.append(probe);
    const state = { color: meta.content, scheme: getComputedStyle(document.documentElement).colorScheme,
      matchesCanvas: getComputedStyle(probe).backgroundColor === getComputedStyle(document.body).backgroundColor,
      matchesRoot: getComputedStyle(probe).backgroundColor === getComputedStyle(document.documentElement).backgroundColor };
    probe.remove(); return state;
  })()`));
  assert.deepEqual(state, { color, scheme: mode, matchesCanvas: true, matchesRoot: true });
}
function select(mode) {
  ab('find', 'role', 'button', 'click', '--name', 'Appearance', '--exact');
  ab('find', 'role', 'menuitemradio', 'click', '--name', mode, '--exact');
}
try {
  ab('set', 'media', 'light');
  ab('open', url);
  ab('wait', '[aria-label="Appearance"]');
  select('Dark'); check('dark');
  ab('reload'); check('dark'); // persisted dark choice with a light OS preference
  select('Light'); check('light');
  ab('set', 'media', 'dark'); check('light'); // explicit choice overrides the OS
  select('System'); check('dark');
  ab('set', 'media', 'light'); check('light');
  ab('set', 'media', 'dark'); check('dark');
  ab('press', 'Control+k');
  ab('fill', '[aria-label="Search sessions and commands"]', 'appearance light');
  ab('click', '[cmdk-item][data-value="appearance light"]'); check('light'); // palette uses the same applied theme
  ab('set', 'viewport', '390', '844');
  ab('find', 'role', 'button', 'click', '--name', 'Show sidebar', '--exact');
  select('Dark'); check('dark');
  ab('screenshot', join(evidence, 'mobile-dark.png'));
  assert.equal(ab('errors'), '');
  console.log('PASS: browser theme color and canvas agree for explicit, persisted, system, palette and mobile theme changes');
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: true, url, node: process.version, nativeSafariVerified: false, modelCalls: 0 }, null, 2));
} finally {
  try { ab('close'); } catch {}
  writeFileSync(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2));
}
