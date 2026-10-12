// Scratch-only palette and shared UI regressions (INV-01: projection only; INV-11: loopback).
// node test/browser-command-palette.mjs <evidence-directory>
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? "/tmp/piano-palette-evidence");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "piano-palette-"));
const repos = [join(root, "piano"), join(root, "other-project")];
const sessions = join(root, "sessions");
for (const path of [
  ...repos,
  sessions,
  join(root, "agent"),
  join(root, "home"),
  join(root, "config"),
])
  mkdirSync(path);
const env = {
  ...process.env,
  HOME: join(root, "home"),
  XDG_CONFIG_HOME: join(root, "config"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
for (const repo of repos) {
  const git = (...args) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      { env },
    );
  git("init", "-q", "-b", "main");
  git("commit", "--allow-empty", "-qm", "Initial");
}
const entries = Array.from({ length: 13 }, (_, i) => ({
  cwd: repos[i % 2],
  sessionId: `palette-${i}`,
  title:
    i === 12
      ? "Archived needle"
      : i === 0
        ? "Historical lighthouse"
        : `Session ${String(i).padStart(2, "0")}`,
  createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  // Deliberately opposite to creation order; recent activity must not determine this list.
  updatedAt: new Date(Date.UTC(2026, 1, 20 - i)).toISOString(),
  archived: i === 12,
}));
for (const entry of entries)
  writeFileSync(
    join(sessions, `${entry.sessionId}.jsonl`),
    [
      {
        type: "session",
        version: 3,
        id: entry.sessionId,
        cwd: entry.cwd,
        timestamp: entry.createdAt,
      },
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: entry.createdAt,
        message: { role: "user", content: `History for ${entry.title}`, timestamp: 0 },
      },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n",
  );
writeFileSync(
  join(root, "registry.json"),
  JSON.stringify({ folders: repos, worktrees: [], sessions: entries }),
);
const backendPort = process.env.PIANO_TEST_BACKEND_PORT ?? "7171",
  webPort = process.env.PIANO_TEST_WEB_PORT ?? "7172";
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...env,
    HOST: "127.0.0.1",
    PORT: backendPort,
    PIANO_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
    ...registryEnv(join(root, "registry.json")),
    PIANO_PI_CLI: resolve("test/fake-host-pi.mjs"),
    PIANO_PI_ARGS: "",
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: sessions,
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
const browser = `palette-${process.pid}`,
  commands = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn("npx", ["agent-browser", "--session", browser, ...args], {
      env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => proc.kill("SIGTERM"), 25000);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
  commands.push({ args, ...result });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
const evaluate = async (js) => JSON.parse(await ab("eval", js));
const input = '[aria-label="Search sessions and commands"]';
// Headless Chromium on macOS ignores select-all shortcuts, so the field is cleared the way React observes it.
const clear = () =>
  evaluate(
    `(() => { const i = document.querySelector('[aria-label="Search sessions and commands"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
const recent = [
  "Session 11",
  "Session 10",
  "Session 09",
  "Session 08",
  "Session 07",
  "Session 06",
  "Session 05",
  "Session 04",
];
const titles = () =>
  evaluate(`(() => {
  const group = [...document.querySelectorAll('[cmdk-group]')].find(e => ['Sessions', 'Recent sessions'].includes(e.querySelector('[cmdk-group-heading]')?.textContent));
  return [...(group?.querySelectorAll('[cmdk-item]') ?? [])].filter(e => e.getBoundingClientRect().height > 0).map(e => e.children[0].textContent);
})()`);
async function capture(name) {
  await ab("screenshot", join(evidence, `${name}.png`));
  writeFileSync(join(evidence, `${name}.txt`), await ab("snapshot"));
}
const ui = [];
async function checkRowHeights(expected) {
  const heights = await evaluate(`(() => {
    const input = document.querySelector('[data-slot="command-input-wrapper"]');
    const rows = [...document.querySelectorAll('[cmdk-item]')].filter(el => el.checkVisibility());
    return [input.getBoundingClientRect().height, ...rows.map(el => el.getBoundingClientRect().height)];
  })()`);
  ui.push({ expected, heights });
  assert.ok(
    heights.length > 1 && heights.every((h) => Math.abs(h - expected) < 1),
    "search and option rows share a height",
  );
}
// These are app interactions, not assertions about where wrappers/classes happen to live.
async function checkPianoControls() {
  await ab("set", "viewport", "1440", "1000");
  const view = '[aria-label="View options"]';
  const directory = '[role="combobox"][aria-label="Directory"]';
  await ab("press", process.platform === "darwin" ? "Meta+b" : "Control+b");
  assert.equal(
    await evaluate(`document.querySelector('[data-slot="layout-sidebar"]').dataset.state`),
    "expanded",
    "Mod+B remains unassigned",
  );
  for (const theme of ["Dark", "Light"]) {
    await ab("click", view);
    await ab("find", "role", "menuitem", "hover", "--name", "Appearance");
    await ab(
      "wait",
      "--fn",
      `!!document.querySelector('[role="menuitemradio"][data-state="checked"]')`,
    );
    const choice = await evaluate(`(() => {
      const row = document.querySelector('[role="menuitemradio"][data-state="checked"]');
      const check = row.querySelector('svg.lucide-check');
      const label = row.getBoundingClientRect(), mark = check?.getBoundingClientRect();
      return { trailingCheck: !!mark && mark.left > label.left + label.width / 2,
        z: getComputedStyle(row.closest('[role="menu"]')).zIndex };
    })()`);
    ui.push({ theme, ...choice });
    assert.equal(
      choice.trailingCheck,
      true,
      "selected radio item has a trailing check, not a leading dot",
    );
    assert.equal(choice.z, "60", "submenu stays above toasts");
    await ab("find", "role", "menuitemradio", "click", "--name", theme, "--exact");
    await ab("mouse", "move", "0", "0");
    await ab("wait", "--fn", `!document.querySelector('[role="menu"]')`);
    assert.notEqual(
      await evaluate(`document.activeElement.getAttribute('aria-label')`),
      "View options",
      "pointer close does not restore trigger focus",
    );
    assert.equal(
      await evaluate(`!!document.querySelector('[role="tooltip"]')`),
      false,
      "pointer close does not reopen tooltip",
    );

    await ab("click", directory);
    await ab("wait", '[aria-label="Search folders"]');
    await checkRowHeights(36);
    const overlay = await evaluate(`(() => {
      const el = document.querySelector('[data-slot="popover-content"]'), style = getComputedStyle(el);
      return { z: style.zIndex, duration: style.animationDuration, radius: style.borderRadius };
    })()`);
    ui.push({ theme, overlay });
    assert.deepEqual(overlay, { z: "60", duration: "0.16s", radius: "10px" });
    await capture(`picker-${theme.toLowerCase()}`);
    await ab("click", `[cmdk-item][data-value="${repos[0]}"]`);
    await ab("wait", "--fn", `!document.querySelector('[data-slot="popover-content"]')`);
    assert.notEqual(
      await evaluate(`document.activeElement.getAttribute('aria-label')`),
      "Directory",
      "pointer picker selection leaves focus alone",
    );
  }
  // Keyboard users still get a tooltip and focus returned to the trigger on Escape.
  await ab("press", "Tab");
  await ab("focus", view);
  await ab("wait", "--fn", `!!document.querySelector('[role="tooltip"]')`);
  await ab("press", "Enter");
  await ab("wait", "--fn", `!!document.querySelector('[role="menu"]')`);
  await ab("press", "Escape");
  await ab("wait", "--fn", `!document.querySelector('[role="menu"]')`);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "View options");
  await ab("focus", directory);
  await ab("press", "Enter");
  await ab("wait", '[aria-label="Search folders"]');
  await ab("press", "Escape");
  await ab("wait", "--fn", `!document.querySelector('[data-slot="popover-content"]')`);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "Directory");
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
  await ab("set", "viewport", "1440", "1000");
  await ab("open", `http://127.0.0.1:${webPort}/new`);
  await ab("wait", "--text", "What should we work on?");
  await ab("press", process.platform === "darwin" ? "Meta+k" : "Control+k");
  await ab("wait", input);
  assert.deepEqual(await titles(), recent, "eight newest by creation across both projects");
  await checkRowHeights(48);
  await capture("desktop-recent");
  await ab("fill", input, "Session");
  await capture("desktop-search-top");
  assert.equal(
    await evaluate(`document.querySelector('[cmdk-list]').scrollTop`),
    0,
    "new search starts at the top, including its group heading",
  );
  await evaluate(`document.querySelector('[cmdk-list]').scrollTop = 200`);
  await ab("fill", input, "Sess");
  assert.equal(
    await evaluate(`document.querySelector('[cmdk-list]').scrollTop`),
    0,
    "changing a scrolled search resets the viewport",
  );
  for (let i = 0; i < 9; i++) await ab("press", "ArrowDown");
  assert.ok(
    await evaluate(`document.querySelector('[cmdk-list]').scrollTop > 0`),
    "keyboard navigation still scrolls down through results",
  );
  await ab("fill", input, "Historical lighthouse");
  assert.deepEqual(
    await titles(),
    ["Historical lighthouse"],
    "search includes older, non-hosted sessions",
  );
  await ab("press", "Enter");
  await ab("wait", "--text", "History for Historical lighthouse");
  assert.ok(
    (await evaluate("location.pathname")).endsWith("/s/palette-0"),
    "keyboard selection opens the matched session",
  );
  await ab("press", process.platform === "darwin" ? "Meta+k" : "Control+k");
  await ab("wait", input);
  assert.equal(
    await evaluate(`document.querySelector('${input}').value`),
    "",
    "reopening resets search",
  );
  assert.deepEqual(await titles(), recent);
  await ab("fill", input, "other-project");
  assert.deepEqual(
    await titles(),
    ["Session 11", "Session 09", "Session 07", "Session 05", "Session 03", "Session 01"],
    "project search includes older sessions",
  );
  await clear();
  assert.deepEqual(await titles(), recent, "clearing matches restores creation order");
  await ab("fill", input, "Session 05");
  assert.equal((await titles())[0], "Session 05", "best search match ranks first");
  await clear();
  assert.deepEqual(await titles(), recent, "clearing a ranked search restores creation order");
  await ab("fill", input, "Archived needle");
  assert.deepEqual(await titles(), [], "archived sessions remain excluded");
  await ab("wait", "--text", "No sessions or commands match.");
  await clear();
  await capture("cleared-search");
  assert.deepEqual(await titles(), recent, "clearing restores creation order and the limit");
  await ab("press", "Escape");
  await ab("set", "viewport", "390", "844");
  await ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  await ab("find", "role", "button", "click", "--name", "Search sessions", "--exact");
  await ab("wait", input);
  assert.deepEqual(await titles(), recent, "mobile opens the same recent list");
  await checkRowHeights(48);
  await ab("fill", input, "new session");
  await capture("mobile-new-session-actions");
  const newActions = await evaluate(`(() => {
    return [...document.querySelectorAll('[cmdk-item]')].filter(e => e.getBoundingClientRect().height > 0).map(e => ({ value: e.getAttribute('data-value'), icon: e.querySelector('svg')?.outerHTML, fits: e.scrollWidth <= e.clientWidth }));
  })()`);
  assert.deepEqual(
    newActions.map((a) => a.value),
    ["New session", "New session here"],
    "no directory-specific actions",
  );
  assert.ok(
    newActions.every((a) => a.fits),
    "new session actions fit mobile width",
  );
  assert.ok(newActions[0].icon.includes("lucide-plus"));
  assert.equal(newActions[0].icon, newActions[1].icon, "new session actions use the same icon");
  await ab("click", '[cmdk-item][data-value="New session here"]');
  await ab("wait", "--text", "What should we work on?");
  assert.equal(
    await evaluate(`!!document.querySelector('${input}')`),
    false,
    "here action closes palette",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[role="combobox"][aria-label="Directory"]').getAttribute('title') === ${JSON.stringify(repos[0])}`,
    ),
    true,
    "here action selects current project",
  );
  await ab("press", process.platform === "darwin" ? "Meta+k" : "Control+k");
  await ab("wait", input);
  await ab("fill", input, "new session");
  await ab("press", "Enter");
  assert.equal(
    await evaluate(`!!document.querySelector('${input}')`),
    false,
    "generic action closes palette",
  );
  await checkPianoControls();
  assert.equal(await ab("errors"), "");
  // A narrow desktop viewport is not a touch device: relaunch with a real coarse pointer.
  await ab("close");
  await ab(
    "--args",
    "--blink-settings=primaryPointerType=2",
    "open",
    `http://127.0.0.1:${webPort}/new`,
  );
  await ab("wait", "--text", "What should we work on?");
  await ab("set", "viewport", "390", "844");
  assert.equal(await evaluate(`matchMedia('(pointer: coarse)').matches`), true);
  await ab("click", '[role="combobox"][aria-label="Directory"]');
  await ab("wait", '[aria-label="Search folders"]');
  await checkRowHeights(44);
  assert.notEqual(
    await evaluate(`document.activeElement.getAttribute('aria-label')`),
    "Search folders",
    "touch opening does not summon the software keyboard",
  );
  await capture("touch-picker");
  await ab("press", "Escape");
  await ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  await ab("wait", '[data-slot="sheet-content"]');
  const sheet = await evaluate(`(() => {
    const content = getComputedStyle(document.querySelector('[data-slot="sheet-content"]'));
    const overlay = getComputedStyle(document.querySelector('[data-slot="sheet-overlay"]'));
    return { duration: content.animationDuration, overlayDuration: overlay.animationDuration, scrim: overlay.backgroundColor };
  })()`);
  ui.push({ sheet });
  assert.equal(sheet.duration, "0.3s");
  assert.equal(sheet.overlayDuration, "0.3s");
  await capture("touch-sidebar");
  await ab("press", "Escape");
  await ab("wait", "--fn", `document.activeElement?.getAttribute('aria-label') === 'Show sidebar'`);
  await ab("set", "media", "light", "reduced-motion");
  await ab("find", "role", "button", "click", "--name", "Show sidebar", "--exact");
  await ab("wait", '[data-slot="sheet-content"]');
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('[data-slot="sheet-content"]')).animationName`,
    ),
    "none",
    "reduced-motion beats app overlay styling",
  );
  assert.equal(await ab("errors"), "");
  console.log(
    "PASS: search viewport resets; keyboard scrolling; eight newest across projects; full active-session search; archive exclusion; clear/reopen reset; keyboard selection; mobile new session actions; equal row heights; light/dark pickers; trailing checks; pointer and keyboard focus; no Mod+B; touch sizing/focus; sheet timing and reduced motion",
  );
  writeFileSync(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        dirty: true,
        node: process.version,
        cli: "test/fake-host-pi.mjs",
        modelCalls: 0,
        newActions,
        ui,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await ab("close");
  } catch {}
  for (const proc of [backend, frontend])
    if (proc.exitCode === null) {
      const stopped = new Promise((resolve) => proc.once("exit", resolve));
      proc.kill("SIGTERM");
      await stopped;
    }
  writeFileSync(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(evidence, "process.log"), processLog);
  rmSync(root, { recursive: true, force: true });
}
