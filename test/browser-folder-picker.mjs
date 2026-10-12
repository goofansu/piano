// INV-01/07: folder observations and creation stay with their directory and picker opening.
// node test/browser-folder-picker.mjs [evidence-directory]; fake Pi, no paid model calls.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { registryEnv } from "./fixtures/registry.ts";

const evidence = resolve(process.argv[2] ?? ".scratch/folder-picker-browser");
const backendPort = "7171",
  webPort = "7172";
for (const port of [backendPort, webPort])
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(Number(port), "127.0.0.1", () => server.close(resolve));
  });
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "piano-folder-picker-"));
const repo = join(root, "repo"),
  a = join(repo, "A"),
  b = join(repo, "B");
for (const dir of ["repo/A/A-only", "repo/B/B-only", "agent", "sessions", "home", "config"])
  mkdirSync(join(root, dir), { recursive: true });
const env = {
  ...process.env,
  HOME: join(root, "home"),
  XDG_CONFIG_HOME: join(root, "config"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
execFileSync("git", ["init", "-q", "-b", "main", repo], { env });
writeFileSync(
  join(root, "registry.json"),
  JSON.stringify({ folders: [repo], worktrees: [], sessions: [] }),
);
const backend = spawn(process.execPath, ["server/main.ts"], {
  env: {
    ...env,
    HOST: "127.0.0.1",
    PORT: backendPort,
    PIANO_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    ...registryEnv(join(root, "registry.json")),
    PIANO_PI_CLI: resolve("test/fake-pi.mjs"),
    PIANO_PI_ARGS: "",
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
// Worktrees may share node_modules; never share Vite's mutable optimization cache.
const viteConfig = join(root, "vite.config.mjs");
writeFileSync(
  viteConfig,
  `import config from ${JSON.stringify(resolve("web/vite.config.ts"))}; export default { ...config, cacheDir: ${JSON.stringify(join(root, "vite-cache"))} };`,
);
const frontend = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "--config",
    viteConfig,
    "--host",
    "127.0.0.1",
    "--port",
    webPort,
    "--strictPort",
  ],
  {
    cwd: resolve("web"),
    env: { ...env, PIANO_DEV_BACKEND: `http://127.0.0.1:${backendPort}` },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let processLog = "";
for (const proc of [backend, frontend]) {
  proc.stdout.on("data", (d) => (processLog += d));
  proc.stderr.on("data", (d) => (processLog += d));
}
const session = `folder-picker-${process.pid}`,
  commands = [],
  observations = [];
async function ab(...args) {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(
      "npx",
      ["agent-browser", "--namespace", session, "--session", session, ...args],
      {
        env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
const button = (name) => ab("find", "role", "button", "click", "--name", name, "--exact");
const pathInput = '[role="dialog"] input[placeholder="/path/to/folder"]';
const dialogOpen = () => evaluate(`!!document.querySelector('[role="dialog"][data-state="open"]')`);
const listing = (name) =>
  ab(
    "wait",
    "--fn",
    `[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === ${JSON.stringify(name)})`,
  );
const browse = async () => {
  await ab("click", '[aria-label="Directory"]');
  await ab("click", '[cmdk-item][data-value="__browse"]');
  await ab("wait", pathInput);
};
const enterPath = (path) => ab("fill", pathInput, `${path}/`);
const ready = () =>
  ab(
    "wait",
    "--fn",
    `[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === 'Use this folder' && !b.disabled)`,
  );
const close = async () => {
  await ab("press", "Escape");
  await ab("wait", "--fn", `!document.querySelector('[role="dialog"]')`);
};
const mkdirCount = (path) =>
  evaluate(
    `window.folderFixture.calls.filter(c => c.route === '/api/mkdir' && c.path === ${JSON.stringify(path)}).length`,
  );
const assertPath = async (path) =>
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(pathInput)}).value`),
    `${path}/`,
  );
const assertDraft = async () =>
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="First message"]').value`),
    "KEEP_MY_DRAFT",
  );
const hold = (route, path) =>
  evaluate(`window.folderFixture.hold = ${JSON.stringify({ route, path })}`);
const held = () => ab("wait", "--fn", "!!window.folderFixture.release");
const release = () =>
  evaluate(
    `(async () => { window.folderFixture.release(); window.folderFixture.release = null; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()`,
  );
async function capture(name) {
  writeFileSync(join(evidence, `${name}.txt`), await ab("snapshot"));
  await ab("screenshot", join(evidence, `${name}.png`));
}
let outcome = "fail";
try {
  writeFileSync(
    join(evidence, "revision.txt"),
    execFileSync("git", ["rev-parse", "HEAD"]).toString() +
      execFileSync("git", ["status", "--short"]).toString(),
  );
  writeFileSync(join(evidence, "diff.patch"), execFileSync("git", ["diff"]));
  for (let n = 0; n < 150; n++) {
    assert.equal(backend.exitCode, null, processLog);
    assert.equal(frontend.exitCode, null, processLog);
    try {
      if (
        (await fetch(`http://127.0.0.1:${backendPort}/api/folders`)).ok &&
        (await fetch(`http://127.0.0.1:${webPort}`)).ok
      )
        break;
    } catch {}
    if (n === 149) throw new Error("Scratch startup deadline");
    await delay(100);
  }
  await ab("open", `http://127.0.0.1:${webPort}/new`);
  await ab("fill", '[aria-label="First message"]', "KEEP_MY_DRAFT");
  // Delay a real response AFTER it arrives, deliberately ignoring abort like an already-delivered response.
  // Everything else, including mkdir and listing errors, uses the scratch HTTP adapter unchanged.
  await evaluate(`(() => {
    const original = window.fetch.bind(window);
    const fixture = window.folderFixture = { hold: null, release: null, calls: [] };
    window.fetch = async (input, init = {}) => {
      const route = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      if (!['/api/ls', '/api/mkdir'].includes(route)) return original(input, init);
      const path = JSON.parse(init.body).path;
      fixture.calls.push({ route, path });
      const pause = fixture.hold?.route === route && fixture.hold?.path === path;
      if (pause) fixture.hold = null;
      const response = await original(input, init);
      // Detach the consumed body BEFORE holding: later abort cannot make response.json() reject.
      const delivered = new Response(await response.text(), { status: response.status, headers: response.headers });
      if (pause) await new Promise(resolve => { fixture.release = resolve; });
      return delivered;
    };
    return true;
  })()`);
  await browse();
  await enterPath(a);
  await listing("A-only");
  await hold("/api/ls", b);
  await enterPath(b);
  await held();
  await enterPath(a);
  await listing("A-only");
  await release();
  await capture("late-listing");
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(pathInput)}).value`),
    `${a}/`,
  );
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === 'B-only')`,
    ),
    false,
    "Late B must not replace the displayed A listing",
  );
  await listing("A-only");
  observations.push("A → held B → A retains A after B resolves");

  // A loading button and Enter must enforce the same rule, even with an older listing available.
  await hold("/api/ls", b);
  await enterPath(b);
  await held();
  await ab("press", "Enter");
  assert.equal(await dialogOpen(), true, "Enter cannot select an unresolved directory");
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"] button')].filter(b => ['Use this folder', 'New folder'].includes(b.textContent.trim())).every(b => b.disabled)`,
    ),
    true,
  );
  await release();
  await listing("B-only");
  await ready();
  const missing = join(repo, "missing");
  await enterPath(missing);
  await ab("wait", "--text", "No such directory:");
  await ab("press", "Enter");
  assert.equal(await dialogOpen(), true, "Enter cannot select an errored directory");
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Use this folder').disabled`,
    ),
    true,
  );
  observations.push(
    "Loading/error listings cannot be selected by Enter or used as creation parents",
  );

  // A late error from a closed opening must not poison the reopened picker, even at the same path.
  await enterPath(a);
  await listing("A-only");
  await hold("/api/ls", missing);
  await enterPath(missing);
  await held();
  await close();
  await browse();
  await enterPath(a);
  await listing("A-only");
  await release();
  await assertPath(a);
  assert.equal(
    await evaluate(
      `document.querySelector('[role="dialog"]').textContent.includes('No such directory:')`,
    ),
    false,
  );
  await ready();
  observations.push("Close/reopen drops the previous opening’s late listing error");

  // Prefix edits filter locally. A single match is selected by Enter, without losing the draft.
  const reads = await evaluate(
    `window.folderFixture.calls.filter(c => c.route === '/api/ls').length`,
  );
  await ab("fill", pathInput, `${a}/A-o`);
  await listing("A-only");
  assert.equal(
    await evaluate(`window.folderFixture.calls.filter(c => c.route === '/api/ls').length`),
    reads,
    "Prefix typing does not refetch",
  );
  await ab("press", "Enter");
  await ab("wait", "--fn", `!document.querySelector('[role="dialog"]')`);
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="Directory"]').title`),
    join(a, "A-only"),
  );
  await assertDraft();
  await browse();
  await ready();
  await button("..");
  await listing("A-only");
  await assertPath(a);
  observations.push("Prefix selection, parent navigation and the New message draft are preserved");

  // Both a normal click and back-to-back form submissions must create once, in the displayed parent.
  const movedCreation = join(a, "late-move");
  await button("New folder");
  await ab("fill", '[aria-label="New folder name"]', "late-move");
  await hold("/api/mkdir", movedCreation);
  await button("Create");
  await held();
  await evaluate(
    `(() => { const form = document.querySelector('[aria-label="New folder name"]').form; form.requestSubmit(); form.requestSubmit(); return true; })()`,
  );
  assert.equal(await mkdirCount(movedCreation), 1, "Creation is single-flight");
  assert.equal(existsSync(movedCreation), true, "The actual scratch mkdir completed");
  await ab("focus", pathInput);
  await ab("press", "Enter");
  assert.equal(await dialogOpen(), true, "Enter cannot select during creation");
  await enterPath(b);
  await listing("B-only");
  await release();
  await assertPath(b);
  observations.push("Creation targets A once; delayed mkdir success cannot navigate B");

  const closedCreation = join(b, "late-close");
  await ab("fill", '[aria-label="New folder name"]', "late-close");
  await hold("/api/mkdir", closedCreation);
  // Two submissions in one task cover the interval before React disables the control.
  await evaluate(
    `(() => { const form = document.querySelector('[aria-label="New folder name"]').form; form.requestSubmit(); form.requestSubmit(); return true; })()`,
  );
  await held();
  assert.equal(await mkdirCount(closedCreation), 1);
  await close();
  await browse();
  await enterPath(b);
  await listing("B-only");
  await release();
  await assertPath(b);
  await ready();
  assert.equal(
    existsSync(closedCreation),
    true,
    "Closing does not undo a submitted filesystem mutation",
  );
  assert.equal(
    await evaluate(`!!document.querySelector('[aria-label="New folder name"]')`),
    false,
    "Old creation cannot reopen or change the new opening’s form",
  );
  observations.push(
    "Reopening the same parent fences old creation; the created folder remains on disk",
  );

  // Current errors retain the form for correction; success navigates into the actual created directory.
  await button("New folder");
  await ab("fill", '[aria-label="New folder name"]', "bad/name");
  await button("Create");
  await ab("wait", "--text", "Folder name cannot contain slashes");
  assert.equal(await mkdirCount(join(b, "bad/name")), 0);
  writeFileSync(join(b, "blocked"), "not a directory");
  await ab("fill", '[aria-label="New folder name"]', "blocked");
  await button("Create");
  await ab("wait", "--fn", `!!document.querySelector('[aria-label="Create"]:not(:disabled)')`);
  assert.equal(await mkdirCount(join(b, "blocked")), 1);
  await assertPath(b);
  const created = join(b, "new-folder");
  await ab("fill", '[aria-label="New folder name"]', "new-folder");
  await button("Create");
  await ab(
    "wait",
    "--fn",
    `document.querySelector(${JSON.stringify(pathInput)})?.value === ${JSON.stringify(`${created}/`)}`,
  );
  await ready();
  assert.equal(existsSync(created), true);
  assert.equal(
    await evaluate(
      `window.folderFixture.calls.filter(c => c.route === '/api/ls' && c.path === ${JSON.stringify(created)}).length`,
    ),
    1,
    "Navigation reads the child once under its own identity",
  );
  await button("..");
  await listing("new-folder");
  await button("new-folder");
  await ready();
  await button("Use this folder");
  await ab("wait", "--fn", `!document.querySelector('[role="dialog"]')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Directory"]').title`), created);
  assert.equal(await evaluate(`localStorage.getItem('piano.pickerPath')`), created);
  await assertDraft();
  observations.push(
    "Validation, failed mkdir/retry, successful creation and last-directory preference work",
  );

  // Typed home aliases resolve to the listing’s canonical path, never a literal '~' selection.
  await browse();
  await enterPath("~");
  await ready();
  await button("Use this folder");
  await ab("wait", "--fn", `!document.querySelector('[role="dialog"]')`);
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="Directory"]').title`),
    join(root, "home"),
  );
  await assertDraft();
  await ab("set", "viewport", "390", "844");
  await browse();
  await enterPath(b);
  await listing("new-folder");
  await capture("verified-mobile");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  observations.push("Canonical home selection and mobile picker layout remain usable");
  outcome = "pass";
  console.log(
    "PASS: folder identity/read races, selection guards, create fencing/duplicates, prefix/home/navigation, draft and mobile preservation.",
  );
} catch (error) {
  try {
    await capture("failure");
    writeFileSync(join(evidence, "browser-errors.txt"), await ab("errors"));
  } catch {}
  throw error;
} finally {
  try {
    writeFileSync(
      join(evidence, "http-calls.json"),
      JSON.stringify(await evaluate("window.folderFixture?.calls ?? []"), null, 2),
    );
  } catch {}
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
  writeFileSync(
    join(evidence, "observations.json"),
    JSON.stringify({ outcome, observations, paidModelCalls: 0 }, null, 2),
  );
  writeFileSync(join(evidence, "process.log"), processLog);
  rmSync(root, { recursive: true, force: true });
}
