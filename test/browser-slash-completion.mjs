// Shared composer completion contract; fake Pi, scratch registry, no model calls.
// node test/browser-slash-completion.mjs /tmp/piano-slash-evidence
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-slash-evidence");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "piano-slash-"));
const cwd = join(root, "project");
mkdirSync(cwd);
spawnSync("git", ["init", "-q", cwd]);
writeFileSync(
  join(root, "registry.json"),
  JSON.stringify({
    folders: [cwd],
    worktrees: [],
    sessions: [
      {
        cwd,
        sessionId: "not-running",
        title: "Saved session",
        createdAt: "2026-10-07T00:00:00Z",
        updatedAt: "2026-10-07T00:00:00Z",
        archived: false,
      },
    ],
  }),
);
writeFileSync(
  join(root, "fake.mjs"),
  readFileSync("test/fake-pi.mjs", "utf8").replace(
    'out({ type: "extension_ui_request", id: "live1", method: "input", title: "Running after response" });',
    "// Hold the run without a modal over the composer.",
  ),
);
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? "7171";
const webPort = process.env.PIANO_TEST_WEB_PORT ?? "7172";
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: backendPort,
    ...registryEnv(join(root, "registry.json")),
    PIANO_PI_CLI: join(root, "fake.mjs"),
    PIANO_PI_ARGS: "",
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const frontend = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    webPort,
    "--strictPort",
  ],
  {
    cwd: resolve("web"),
    env: { ...process.env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let processLog = "";
for (const proc of [backend, frontend]) {
  proc.stdout.on("data", (d) => (processLog += d));
  proc.stderr.on("data", (d) => (processLog += d));
}
const session = `slash-${process.pid}`,
  commands = [];
function ab(...args) {
  const result = spawnSync("npx", ["agent-browser", "--session", session, ...args], {
    encoding: "utf8",
    timeout: 45000,
  });
  commands.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = (js) => JSON.parse(ab("eval", js));
async function until(js) {
  for (let n = 0; n < 25; n++) {
    if (evaluate(js)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${js}`);
}
const input = "textarea";
const menu = '[role="listbox"][aria-label="Slash commands"]';
const options = `${menu} [role="option"]`;
const draft = () => evaluate(`document.querySelector('textarea').value`);
async function fill(text) {
  // Refocus before replacement: after Tab, type-to-focus can otherwise append
  // the driver's inserted text to the old draft instead of replacing it.
  ab("click", input);
  ab("fill", input, text);
  assert.equal(draft(), text, "browser driver replaced the draft before testing completion");
}
async function suggestions(text) {
  await fill(text);
  ab("press", "End");
  await until(`!!document.querySelector('${options}')`);
}
function capture(name) {
  ab("screenshot", join(evidence, `${name}.png`));
  writeFileSync(join(evidence, `${name}.txt`), ab("snapshot"));
}
function assertFullPageSettings() {
  assert.ok(
    evaluate(`document.querySelector('[aria-label="Settings"]').checkVisibility()`),
    "Settings is the visible page",
  );
  assert.equal(
    evaluate('document.querySelectorAll("main").length'),
    1,
    "one shared content card serves every page",
  );
  assert.equal(
    evaluate(`!!document.querySelector('nav[aria-label="Sessions"]')?.checkVisibility()`),
    false,
    "session navigation is hidden in Settings",
  );
  assert.equal(
    evaluate("document.documentElement.scrollWidth > innerWidth"),
    false,
    "Settings fits without horizontal overflow",
  );
}
function navigationButtonBox(label) {
  return evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('aside button')).find(element =>
      element.checkVisibility({ visibilityProperty: true }) && (element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.trim() === ${JSON.stringify(label)}));
    const { x, y, width, height } = button.getBoundingClientRect();
    return { x, y, width, height };
  })()`);
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
  await until(`document.querySelector('main').getBoundingClientRect().x === ${sidebarWidth}`);
  assert.deepEqual(
    evaluate(`(() => {
    const { x, y, width, height } = document.querySelector('main').getBoundingClientRect();
    return { x, y, width, height };
  })()`),
    { x: sidebarWidth, y: 8, width: 1440 - sidebarWidth - 8, height: 984 },
    "Settings matches the session card geometry at 1440×1000",
  );
  assert.deepEqual(
    cardStyle("main"),
    sessionStyle,
    "Settings matches the session card radius, border, shadow and background",
  );
  assert.ok(
    evaluate(
      `Array.from(document.querySelectorAll('button')).some(button => button.checkVisibility() && (button.getAttribute('aria-label') === 'Providers' || button.textContent.trim() === 'Providers'))`,
    ),
    "Settings navigation remains available in both expanded and icon modes",
  );
  assertFullPageSettings();
}
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(backend.exitCode, null);
    assert.equal(frontend.exitCode, null);
    try {
      if (
        (await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).ok &&
        (await fetch(`http://127.0.0.1:${webPort}`)).ok
      )
        break;
    } catch {}
    if (n === 99) throw new Error("Scratch startup deadline");
    await delay(100);
  }
  const folders = (await (await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).json())
    .folders;
  const workspaceId = folders.find((f) => f.path === cwd).worktrees.find((w) => w.root)
    .workspace.id;
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${backendPort}/api/session/commands?${new URLSearchParams({ workspaceId, sessionId: "not-running" })}`,
      )
    ).status,
    409,
    "discovery does not open stopped sessions",
  );
  ab("open", `http://127.0.0.1:${webPort}/new`);
  ab("set", "viewport", "1440", "1000");
  await until(`document.querySelector('[aria-label^="Model:"]')?.title.includes('alpha')`);
  const sessionStyle = cardStyle("main");
  assert.equal(sessionStyle.radius, "16px");
  assert.equal(sessionStyle.border, "1px");
  assert.notEqual(sessionStyle.shadow, "none");
  await fill("Keep this draft");
  const settingsFooter = navigationButtonBox("Settings");
  evaluate(`(() => {
    window.layoutCard = document.querySelector('main');
    window.layoutDraft = document.querySelector('textarea');
    window.sessionNavigation = document.querySelector('nav[aria-label="Sessions"]');
    window.layoutMotion = { widths: [], views: [] };
    document.addEventListener('transitionrun', event => {
      if (event.target.matches('aside') && event.propertyName === 'width') {
        const style = getComputedStyle(event.target);
        layoutMotion.widths.push({ duration: style.transitionDuration, easing: style.transitionTimingFunction });
      }
    });
    document.addEventListener('animationstart', event => {
      if (event.animationName === 'view-enter' || event.animationName === 'sheet-enter') {
        const style = getComputedStyle(event.target);
        layoutMotion.views.push({ name: event.animationName, duration: style.animationDuration, easing: style.animationTimingFunction });
      }
    });
    return true;
  })()`);
  ab("find", "role", "button", "click", "--name", "Hide sidebar", "--exact");
  await until(`document.querySelector('main').getBoundingClientRect().x === 48`);
  const settingsRailFooter = navigationButtonBox("Settings");
  ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  await until(`document.querySelector('main').getBoundingClientRect().x === 288`);
  assert.ok(
    evaluate("sessionNavigation === document.querySelector('nav[aria-label=\"Sessions\"]')"),
    "collapse/expand keeps expanded navigation mounted",
  );
  const sessionMotion = evaluate("layoutMotion.widths");
  assert.equal(
    sessionMotion.length,
    2,
    "session collapse and expand each animate the shared width",
  );
  assert.notEqual(sessionMotion[0].duration, "0s");
  evaluate("layoutMotion.widths = []; true");
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  ab("wait", "--text", "Providers");
  assert.equal(evaluate("location.pathname"), "/settings/providers");
  await assertSettingsCard(288, sessionStyle);
  assert.ok(
    evaluate(
      'layoutCard === document.querySelector("main") && layoutDraft === document.querySelector("textarea")',
    ),
    "Settings does not replace the content card or session composer",
  );
  assert.deepEqual(
    navigationButtonBox("Home"),
    settingsFooter,
    "Home mirrors Settings in the expanded sidebar footer",
  );
  assert.ok(
    evaluate(
      `Array.from(document.querySelectorAll('aside h2')).some(heading => heading.textContent === 'Settings')`,
    ),
    "Settings title belongs to the navigation",
  );
  assert.equal(
    evaluate(
      `Array.from(document.querySelectorAll('main h1, main h2')).some(heading => heading.textContent === 'Settings')`,
    ),
    false,
    "content has no redundant Settings heading",
  );
  assert.equal(
    evaluate(`document.querySelector('main [aria-label="Settings"] h1').textContent`),
    "Providers",
  );
  capture("settings-desktop-expanded");
  ab("find", "role", "button", "click", "--name", "Hide sidebar", "--exact");
  await assertSettingsCard(48, sessionStyle);
  assert.deepEqual(
    navigationButtonBox("Home"),
    settingsRailFooter,
    "Home mirrors Settings above the Piano mark in the collapsed rail",
  );
  capture("settings-desktop-collapsed");
  ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  await assertSettingsCard(288, sessionStyle);
  assert.deepEqual(
    evaluate("layoutMotion.widths"),
    sessionMotion,
    "Settings collapse/expand uses identical transition timing and easing",
  );
  const interruptedAt = evaluate(`(async () => {
    // These are plain layout buttons, not Radix menu triggers. Reverse within a frame of visible travel.
    const button = label => Array.from(document.querySelectorAll('button')).find(element => element.getAttribute('aria-label') === label && element.checkVisibility());
    button('Hide sidebar').click();
    const deadline = performance.now() + 1000;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const width = document.querySelector('aside').getBoundingClientRect().width;
      if (width < 287 && width > 48) { button('Show sidebar').click(); return width; }
    }
    throw new Error('No intermediate sidebar width observed');
  })()`);
  assert.ok(interruptedAt > 48 && interruptedAt < 288, "collapse can reverse before it finishes");
  await assertSettingsCard(288, sessionStyle);
  ab("find", "role", "button", "click", "--name", "Home", "--exact");
  assert.equal(draft(), "Keep this draft");
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  await until("layoutMotion.views.length >= 3");
  const pageMotion = evaluate("layoutMotion.views");
  assert.equal(pageMotion.length, 3, "one content entrance per page switch, no card re-entrance");
  assert.equal(pageMotion[0].name, "view-enter");
  assert.deepEqual(
    pageMotion[1],
    pageMotion[0],
    "returning to the session uses the Settings entrance",
  );
  assert.deepEqual(pageMotion[2], pageMotion[0]);
  writeFileSync(
    join(evidence, "layout-motion.json"),
    JSON.stringify({ sessionMotion, pageMotion }, null, 2),
  );
  ab("mouse", "move", "288", "450");
  ab("mouse", "down");
  ab("mouse", "move", "400", "450");
  ab("mouse", "up");
  await assertSettingsCard(400, sessionStyle);
  ab("find", "role", "button", "click", "--name", "Home", "--exact");
  await until(`document.querySelector('main').getBoundingClientRect().x === 400`);
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  await assertSettingsCard(400, sessionStyle);
  ab("find", "role", "button", "click", "--name", "Sign in to Radius", "--exact");
  ab("wait", "--text", "Sign in to Radius");
  await until(`!!document.querySelector('#login-answer')`);
  ab("click", "#login-answer");
  ab("wait", "--text", "Sign in with device code (when signing in from another device)");
  capture("settings-radius");
  ab("press", "Escape"); // Close the method menu; reload preserves the running sign-in.
  ab("reload");
  ab("wait", "--text", "Providers");
  assert.equal(evaluate("location.pathname"), "/settings/providers");
  await assertSettingsCard(400, sessionStyle);
  ab("dblclick", '[aria-label="Resize sidebar"]');
  await assertSettingsCard(288, sessionStyle);
  ab("find", "role", "button", "click", "--name", "Sign in to Radius", "--exact");
  await until(`!!document.querySelector('#login-answer')`);
  ab("find", "role", "button", "click", "--name", "Cancel", "--exact");
  await until(`!document.querySelector('[role="dialog"]')`);
  assert.ok(
    evaluate(
      `fetch('/api/provider-login').then(response => response.json()).then(result => result.state?.status === 'cancelled')`,
    ),
    "Cancel resolves the running sign-in",
  );
  ab("find", "role", "button", "click", "--name", "Home", "--exact");
  await fill("Keep this draft");
  ab("press", process.platform === "darwin" ? "Meta+k" : "Control+k");
  ab("fill", '[placeholder="Search sessions and commands…"]', "Settings");
  ab("click", '[role="option"]');
  ab("wait", "--text", "Providers");
  // `keyboard type` sends one complete keystroke; `press` can replay the key after navigation.
  ab("keyboard", "type", "x");
  evaluate("history.back(); true");
  await until(`location.pathname === '/new'`);
  evaluate("history.forward(); true");
  await until(`location.pathname === '/settings/providers'`);
  ab("press", process.platform === "darwin" ? "Meta+k" : "Control+k");
  ab("fill", '[placeholder="Search sessions and commands…"]', "Home");
  ab("find", "role", "option", "click", "--name", "Home", "--exact");
  assert.equal(draft(), "Keep this draft", "Home command preserves the new-session draft");
  await fill("/login rad");
  assert.equal(
    evaluate(`!!document.querySelector('${menu}')`),
    false,
    "no provider completion remains",
  );
  await suggestions("/");
  assert.ok(evaluate(`document.querySelector('${menu}').textContent.includes('probe-only')`));
  assert.equal(
    evaluate(`document.querySelector('${menu}').textContent.includes('live-only')`),
    false,
  );
  assert.deepEqual(
    evaluate(
      `[...document.querySelectorAll('${options}')].map(e=>e.innerText.match(/\\/skill:[\\w-]+/)?.[0])`,
    ),
    ["/skill:probe-only", "/skill:research"],
    "only skills, never extensions or templates",
  );
  assert.ok(evaluate(`document.activeElement === document.querySelector('textarea')`));
  assert.ok(
    evaluate(
      `document.getElementById(document.querySelector('textarea').getAttribute('aria-activedescendant'))?.getAttribute('role') === 'option'`,
    ),
  );
  ab("press", "ArrowDown");
  ab("press", "Tab");
  assert.equal(draft(), "/skill:research ");
  assert.ok(evaluate(`location.pathname === '/new'`), "acceptance did not send");
  await suggestions("/re");
  ab("press", "Alt+Enter");
  assert.equal(draft(), "/skill:research ");
  await fill("/no-such-command");
  ab("wait", "--text", "No matching commands.");
  ab("press", "Escape");
  await fill("/resZZ keep this\nand this");
  evaluate(`document.querySelector('textarea').setSelectionRange(3,3); true`);
  ab("press", "ArrowRight");
  await until(`!!document.querySelector('${options}')`);
  ab("press", "Tab");
  assert.equal(
    draft(),
    "/skill:research keep this\nand this",
    "replace full token, not suffix prose",
  );
  assert.equal(evaluate(`document.querySelector('textarea').selectionStart`), 16);
  ab("press", "x");
  assert.equal(
    draft(),
    "/skill:research xkeep this\nand this",
    "continued typing starts the argument, not the command name",
  );
  for (const text of ["Prose /skill:re", "Prose\n/re", "/etc/pass", "`/re`"]) {
    await fill(text);
    assert.equal(
      evaluate(`!!document.querySelector('${menu}')`),
      false,
      `not a leading command: ${text}`,
    );
  }
  await suggestions("/re");
  ab("press", "Escape");
  await until(`!document.querySelector('${menu}')`);
  assert.equal(draft(), "/re");
  ab("press", "Tab");
  assert.notEqual(
    evaluate(`document.activeElement.tagName`),
    "TEXTAREA",
    "Tab without suggestions traverses focus",
  );
  await suggestions("/re");
  evaluate(
    `document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); true`,
  );
  await until(`!document.querySelector('${menu}')`);
  evaluate(
    `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})); true`,
  );
  assert.equal(draft(), "/re");
  assert.ok(evaluate(`location.pathname === '/new'`));
  evaluate(
    `document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})); true`,
  );
  await until(`!!document.querySelector('${options}')`);
  ab("press", "Enter");
  assert.equal(draft(), "/skill:research ");
  await fill("/handled");
  ab("wait", "--text", "No matching commands.");
  ab("press", "Enter");
  ab("wait", "--text", "Command handled.");
  assert.ok(
    evaluate(`!!document.querySelector('[aria-label="Send"]')`),
    "handled extension does not create a phantom run",
  );
  await suggestions("/");
  assert.ok(evaluate(`document.querySelector('${menu}').textContent.includes('live-only')`));
  assert.equal(
    evaluate(`document.querySelector('${menu}').textContent.includes('probe-only')`),
    false,
  );
  assert.deepEqual(
    evaluate(
      `[...document.querySelectorAll('${options}')].map(e=>e.innerText.match(/\\/skill:[\\w-]+/)?.[0])`,
    ),
    ["/skill:live-only", "/skill:research"],
    "live suggestions also contain only skills",
  );
  capture("active-desktop");
  ab("press", "Escape");
  await fill("Keep session draft");
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  ab("wait", "--text", "Providers");
  ab("find", "role", "button", "click", "--name", "Home", "--exact");
  assert.equal(
    draft(),
    "Keep session draft",
    "Home returns to the previous session and preserves its draft",
  );
  await fill("live context");
  ab("press", "Enter");
  ab("wait", '[aria-label="Stop"]');
  await fill("/handled");
  ab("wait", "--text", "No matching commands.");
  ab("press", "Enter");
  ab("wait", "--text", "Command handled.");
  assert.ok(
    evaluate(`!!document.querySelector('[aria-label="Stop"]')`),
    "extension command while busy preserves the active run",
  );
  await suggestions("/re");
  ab("press", "Escape");
  await until(`!document.querySelector('${menu}')`);
  assert.ok(
    evaluate(`!!document.querySelector('[aria-label="Delivery: steer"]')`),
    "Escape dismisses without aborting",
  );
  ab("press", "Escape");
  await until(`!document.querySelector('[aria-label="Delivery: steer"]')`);
  // Delay discovery to expose stale insertion after editing the draft.
  evaluate(
    `window.originalFetch=window.fetch;window.fetch=(...args)=>/\\/api\\/(session\\/)?commands/.test(String(args[0]))?new Promise(resolve=>setTimeout(()=>resolve(originalFetch(...args)),700)):originalFetch(...args);true`,
  );
  await fill("/");
  await fill("ordinary prose");
  await delay(800);
  assert.equal(evaluate(`!!document.querySelector('${menu}')`), false);
  assert.equal(draft(), "ordinary prose");
  evaluate(
    `window.fetch=(...args)=>/\\/api\\/(session\\/)?commands/.test(String(args[0]))?Promise.resolve(new Response(JSON.stringify({error:'unavailable'}),{status:502})):originalFetch(...args);true`,
  );
  await fill("/");
  ab("wait", "--text", "Could not load commands. Close and reopen to retry.");
  ab("press", "Escape");
  evaluate(`window.fetch=window.originalFetch;true`);
  // Real pointer selection through agent-browser, with a coarse-pointer viewport.
  const activeUrl = evaluate("location.href");
  ab("close");
  ab("--args", "--blink-settings=primaryPointerType=2", "open", activeUrl);
  ab("set", "device", "iPhone 16");
  assert.ok(evaluate(`matchMedia('(pointer: coarse)').matches`));
  await suggestions("/skill:re");
  capture("active-mobile");
  ab("click", `${options}`);
  assert.equal(draft(), "/skill:research ");
  assert.ok(evaluate(`document.activeElement === document.querySelector('textarea')`));
  ab("press", "Enter");
  assert.equal(draft(), "/skill:research \n", "mobile Enter remains a newline without a target");
  ab("open", `http://127.0.0.1:${webPort}/new`);
  await suggestions("/re");
  ab("click", options);
  assert.equal(draft(), "/skill:research ");
  await suggestions("/");
  ab("set", "viewport", "320", "640");
  capture("new-mobile");
  assert.ok(
    evaluate(
      `(() => {const r=document.querySelector('${menu}').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`,
    ),
    "suggestions fit phone viewport",
  );
  ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  const mobileSheetStyle = cardStyle('[role="dialog"]');
  ab("press", "Escape");
  await until(`document.activeElement?.getAttribute('aria-label') === 'Show sidebar'`);
  ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  ab("wait", "--text", "Providers");
  capture("settings-mobile");
  assertFullPageSettings();
  assert.equal(
    evaluate(`!!document.querySelector('[role="dialog"]')`),
    false,
    "mobile settings closes the sidebar",
  );
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  ab("wait", '[role="dialog"]');
  assert.deepEqual(
    cardStyle('[role="dialog"]'),
    mobileSheetStyle,
    "both pages use the same mobile sheet style",
  );
  assert.equal(
    evaluate(`document.querySelector('[role="dialog"]').getBoundingClientRect().width`),
    320,
    "Settings uses the same full-width mobile sheet",
  );
  ab("press", "Escape");
  await until(`document.activeElement?.getAttribute('aria-label') === 'Settings'`);
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  assert.ok(
    evaluate(
      `document.querySelector('[role="dialog"] nav[aria-label="Settings sections"]').checkVisibility()`,
    ),
    "mobile Settings exposes its own navigation",
  );
  ab("find", "role", "button", "click", "--name", "Providers", "--exact");
  await until(`!document.querySelector('[role="dialog"]')`);
  assertFullPageSettings();
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  ab("find", "role", "button", "click", "--name", "Home", "--exact");
  await until(`location.pathname === '/new' && !document.querySelector('[role="dialog"]')`);
  ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  ab("find", "role", "button", "click", "--name", "Settings", "--exact");
  ab("wait", "--text", "Providers");
  assertFullPageSettings();
  ab("set", "viewport", "1440", "1000");
  ab("set", "media", "light", "reduced-motion");
  ab("find", "role", "button", "click", "--name", "Hide sidebar", "--exact");
  await assertSettingsCard(48, sessionStyle);
  assert.equal(
    evaluate(`getComputedStyle(document.querySelector('aside')).transitionDuration`),
    "0s",
  );
  ab("find", "role", "button", "click", "--name", "Home", "--exact");
  ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  await until(`document.querySelector('main').getBoundingClientRect().x === 288`);
  assert.equal(
    evaluate(`getComputedStyle(document.querySelector('aside')).transitionDuration`),
    "0s",
  );
  assert.equal(
    evaluate(
      'document.getAnimations().filter(animation => animation.playState === "running").length',
    ),
    0,
    "reduced motion suppresses layout and page entrances",
  );
  console.log(
    "PASS: reciprocal Home/Settings footers and palette, sidebar title without content header, shared card/motion, retained DOM/drafts, resize persistence, reduced motion, mobile navigation/focus, OAuth resume/cancel, composer completion, keyboard/pointer/IME, stale responses and bounds",
  );
} finally {
  try {
    capture("final");
    ab("close");
  } catch {}
  backend.kill("SIGTERM");
  frontend.kill("SIGTERM");
  await Promise.all(
    [backend, frontend].map((proc) =>
      proc.exitCode !== null ? Promise.resolve() : new Promise((done) => proc.once("exit", done)),
    ),
  );
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "processes.log"), processLog);
  rmSync(root, { recursive: true, force: true });
}
