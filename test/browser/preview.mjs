// Opt-in critical path on Linux/systemd or macOS/launchd. Real installed Pi + scripted loopback
// model (no credentials).
// node test/browser/preview.mjs [evidence-directory]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PreviewAdapter } from "../../scripts/PreviewAdapter.ts";
import { run } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
// Reuse the deployment origin override, but keep ports and state isolated for this journey.
const previewConfig = process.env.PIANO_PREVIEW_CONFIG
  ? JSON.parse(readFileSync(process.env.PIANO_PREVIEW_CONFIG, "utf8"))
  : {};
// A Mac previews on localhost; a Linux VM on its private exe.dev origin.
const local = process.platform === "darwin";
const origin =
  previewConfig.origin ?? (local ? "http://localhost" : `https://${hostname()}.exe.xyz`);
// Vite allows localhost already; a remote origin's hostname must be allowed explicitly.
const appEnv = local ? {} : { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: new URL(origin).hostname };
const evidence = resolve(process.argv[2] ?? ".scratch/browser/preview");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "piano-preview-model-"));
const config = join(scratch, "config.json");
const state = join(scratch, "state");
writeFileSync(
  config,
  JSON.stringify({
    origin,
    ports: Array.from({ length: 80 }, (_, i) => 9400 + i),
  }),
);
let command;
const observations = [];
let app;
let held;
let repo;
let canonicalRepo;
const env = { PIANO_PREVIEW_CONFIG: config, PIANO_PREVIEW_STATE: state };
const request = (args) =>
  JSON.parse(
    execFileSync(process.execPath, [join(ROOT, "scripts/preview.ts")], {
      env: { PATH: "/usr/bin:/bin", ...env },
      input: JSON.stringify({ ...args, workspace: repo }),
      encoding: "utf8",
      timeout: 120_000,
    }),
  );
const running = (pid) => {
  try {
    if (process.platform === "linux")
      return !/^[ZX]/.test(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]);
    return !execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
      .trim()
      .startsWith("Z");
  } catch {
    return false;
  }
};
const piProcesses = () =>
  existsSync(join(scratch, "pi.jsonl"))
    ? readFileSync(join(scratch, "pi.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
    : [];
const piFor = (preview) =>
  piProcesses().findLast((p) => p.endpoint.endsWith(`/${preview.owner.generation}`));
const gone = async (preview, after) => {
  const began = Date.now();
  while (preview.testPids.some(running)) {
    assert.ok(Date.now() - began < 15000, `${after}: app/children survived owner death`);
    await delay(100);
  }
  observations.push({
    after,
    cleanupMs: Date.now() - began,
    instanceId: preview.instanceId,
    pids: preview.testPids,
  });
};
const model = createServer(async (req, res) => {
  let input = "";
  for await (const part of req) input += part;
  const body = JSON.parse(input);
  const lastUser = body.messages.findLastIndex((message) => message.role === "user");
  const content = body.messages[lastUser].content;
  const prompt =
    typeof content === "string" ? content : content.map((part) => part.text ?? "").join("");
  if (prompt === "hold") {
    held = res;
    return;
  }
  const tool = body.messages.slice(lastUser).find((message) => message.role === "tool");
  let delta;
  if (!tool) {
    assert.ok(body.tools.some((tool) => tool.function.name === "piano_preview"));
    delta = {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: `preview-${observations.length}`,
          type: "function",
          function: {
            name: "piano_preview",
            arguments: JSON.stringify(
              prompt === "status"
                ? { action: "status" }
                : prompt === "stop"
                  ? { action: "stop", instanceId: app.instanceId }
                  : { action: "start", command, env: appEnv },
            ),
          },
        },
      ],
    };
  } else {
    app = JSON.parse(tool.content);
    if (app.ready)
      app.testPids = JSON.parse(readFileSync(join(repo, "app-processes.json"), "utf8"));
    observations.push(app);
    delta = {
      role: "assistant",
      content: app.ready
        ? `PREVIEW_READY: [Open preview](${app.url})\nInstance ${app.instanceId}`
        : app.stopped
          ? "PREVIEW_STOPPED"
          : `PREVIEW_FAILED: ${tool.content}`,
    };
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [value, finish] of [
    [delta, null],
    [{}, tool ? "stop" : "tool_calls"],
  ])
    res.write(
      `data: ${JSON.stringify({ id: "preview", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`,
    );
  res.end("data: [DONE]\n\n");
});
await new Promise((done) => model.listen(0, "127.0.0.1", done));
const shim = join(scratch, "pi.mjs");
writeFileSync(
  shim,
  `
import { appendFileSync } from 'node:fs';
if (process.env.PIANO_PREVIEW_OWNER) appendFileSync(${JSON.stringify(join(scratch, "pi.jsonl"))}, JSON.stringify({ pid: process.pid, endpoint: process.env.PIANO_PREVIEW_OWNER })+'\\n');
const keep = new Set(['PATH','HOME','PI_CODING_AGENT_DIR','PI_CODING_AGENT_SESSION_DIR','PIANO_SESSION_WS_URL','PIANO_SESSION_ORIGIN','PIANO_PREVIEW_CONFIG','PIANO_PREVIEW_STATE','PIANO_PREVIEW_OWNER']);
for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
process.env.PI_OFFLINE='1';
await import(${JSON.stringify(join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"))});
`,
);
try {
  await run(
    "preview",
    ({ repository, root }) => {
      repo = repository("app");
      canonicalRepo = realpathSync(repo);
      writeFileSync(join(repo, "index.html"), "<h1>Preview journey v1</h1>");
      command = [process.execPath, join(repo, "app.mjs"), "{port}"];
      writeFileSync(
        join(repo, "app.mjs"),
        `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const vite = spawn(process.execPath, [${JSON.stringify(join(ROOT, "node_modules/vite/bin/vite.js"))}, '--host', '127.0.0.1', '--port', process.argv[2], '--strictPort'], { stdio: 'inherit' });
const stubborn = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' });
writeFileSync('app-processes.json', JSON.stringify([process.pid, vite.pid, stubborn.pid]));
`,
      );
      writeFileSync(
        join(root, "agent/models.json"),
        JSON.stringify({
          providers: {
            "preview-test": {
              baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
              api: "openai-completions",
              apiKey: "dummy",
              models: [
                {
                  id: "local",
                  name: "Preview fixture",
                  reasoning: false,
                  input: ["text"],
                  contextWindow: 200000,
                  maxTokens: 1024,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        }),
      );
      writeFileSync(
        join(root, "agent/settings.json"),
        JSON.stringify({
          defaultProvider: "preview-test",
          defaultModel: "local",
          cacheWarming: "off",
        }),
      );
      return { folders: [repo] };
    },
    async (page) => {
      try {
        await page.open("/new");
        await page.ab("fill", '[aria-label="First message"]', "Run this app so I can try it.");
        // Send enables once real Pi has reported its models; a click before that is ignored.
        await page.until("document.querySelector('[aria-label=Send]')?.disabled === false");
        await page.click("button", "Send");
        await page.see("PREVIEW_READY");
        await page.until(
          "!!document.querySelector('[aria-label=Message]') && !document.querySelector('[aria-label=Stop]')",
        );
        // The helper records the canonical path (macOS's /var is /private/var).
        assert.equal(app.workspace, realpathSync(repo));
        assert.equal(app.url, `${origin}:${app.port}/`);
        const identity = app.instanceId;
        const sessionPath = new URL(await page.ab("get", "url")).pathname;
        const first = app;
        const firstPi = piFor(first);
        assert.ok(firstPi && running(firstPi.pid));
        await page.capture("1-settled-preview-link");
        const link = await page.evaluate(
          "[...document.querySelectorAll('a')].find(a => a.textContent === 'Open preview')?.outerHTML",
        );
        assert.ok(link.includes(app.url), link);
        assert.ok(link.includes('target="_blank"'), link);
        // The session header names the app's state and offers it without reading the transcript.
        const RUNNING = "Preview: Running. Status and actions";
        const headerPreview = () =>
          page.evaluate(
            "document.querySelector('header button[aria-label^=\"Preview:\"]')?.getAttribute('aria-label') ?? null",
          );
        const menuLink = () =>
          page.evaluate(
            "(a => a && { href: a.href, target: a.target })([...document.querySelectorAll('[role=menu] a')].find(a => a.textContent.includes('Open preview')))",
          );
        await page.until("!!document.querySelector('header button[aria-label^=\"Preview:\"]')");
        assert.equal(await headerPreview(), RUNNING);
        await page.capture("1b-header-preview");
        await page.click("button", RUNNING);
        await page.see("Details");
        assert.deepEqual(await menuLink(), { href: app.url, target: "_blank" });
        await page.capture("1c-preview-menu");
        await page.click("menuitem", "Details");
        await page.see("Output");
        // Enter in the details opens the app; it never stops it.
        await page.until(
          "document.activeElement?.tagName === 'A' && document.activeElement.textContent.includes('Open preview')",
        );
        // Re-observed on opening: the app's own output, not the agent's transcript.
        await page.until(
          "/VITE|ready in/i.test(document.querySelector('[role=dialog] pre')?.textContent ?? '')",
        );
        await page.capture("1d-preview-details");
        await page.press("Escape");
        await page.until("!document.querySelector('[role=dialog]')");
        await page.press("Mod+K");
        await page.ab("fill", "[cmdk-input]", "preview");
        await page.until(
          "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
        );
        for (const label of ["Open preview", "Preview details", "Stop preview"])
          await page.until(
            `[...document.querySelectorAll('[cmdk-item]')].some(o => o.textContent.includes(${JSON.stringify(label)}))`,
          );
        await page.capture("1e-palette-preview-commands");
        await page.press("Escape");

        // On a Mac the link itself is opened. External exe.dev login is intentionally not bypassed:
        // there, local browser load is a separate claim.
        await page.ab("tab", "new", local ? app.url : `http://127.0.0.1:${app.port}/`);
        await page.see("Preview journey v1");
        await page.capture("2-app-load");
        writeFileSync(join(repo, "index.html"), "<h1>Preview journey v2 HMR</h1>");
        await page.see("Preview journey v2 HMR");
        await page.capture("3-hot-reload");
        await page.ab("tab", "close");
        await page.ab("fill", '[aria-label="Message"]', "hold");
        await page.click("button", "Send");
        await page.until("!!document.querySelector('[aria-label=Stop]')");
        await page.click("button", "Stop");
        held?.end();
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.ab("close");
        assert.equal(request({ action: "status" }).ready, true);
        // Wait beyond the scratch idle deadline with no browser attached.
        await delay(4000);
        assert.ok(running(firstPi.pid), "preview pins an otherwise idle Pi");
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.open("/new"); // switching away does not release the owner
        assert.equal(request({ action: "status" }).ready, true);
        await page.open(sessionPath);
        await page.until("!!document.querySelector('[aria-label=Message]')");
        // A reload while the owner lives finds the same instance, without launching another.
        await page.until("!!document.querySelector('header button[aria-label^=\"Preview:\"]')");
        assert.equal(await headerPreview(), RUNNING);
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.click("button", RUNNING);
        await page.see("Details");
        assert.deepEqual(await menuLink(), { href: first.url, target: "_blank" });
        await page.capture("2b-reload-same-preview");
        await page.click("menuitem", "Stop preview");
        await page.see("Preview stopped");
        await gone(first, "explicit Stop preview in the session header");
        await page.until("!document.querySelector('header button[aria-label^=\"Preview:\"]')");
        assert.equal(observations.filter((o) => o.ready).length, 1, "Stop never relaunches");
        // Pi stays available: the composer is still live and the session still answers.
        await page.ab("fill", '[aria-label="Message"]', "status");
        await page.click("button", "Send");
        await page.see("PREVIEW_FAILED");
        await page.capture("2c-stopped-session-usable");
        const idleDeadline = Date.now() + 15000;
        while (running(firstPi.pid)) {
          assert.ok(Date.now() < idleDeadline, "stopped preview permits idle retirement");
          await delay(100);
        }
        observations.push({ after: "explicit stop permits idle retirement", pid: firstPi.pid });

        const launch = async () => {
          const before = observations.length;
          await page.open(sessionPath);
          await page.until("!!document.querySelector('[aria-label=Message]')");
          await page.ab("fill", '[aria-label="Message"]', "Run again");
          await page.click("button", "Send");
          for (let i = 0; observations.length === before || !app.ready; i++) {
            assert.ok(i < 300, "new preview ready");
            await delay(100);
          }
          await page.until(
            "!!document.querySelector('[aria-label=Message]') && !document.querySelector('[aria-label=Stop]')",
          );
          return app;
        };
        const killed = await launch();
        assert.notEqual(killed.owner.generation, first.owner.generation);
        await page.ab("close");
        process.kill(piFor(killed).pid, "SIGKILL");
        await gone(killed, "owning Pi SIGKILL, no browser or reopen");

        const shutdown = await launch();
        await page.ab("close");
        await page.restartBackend({
          beforeRestart: () => gone(shutdown, "Piano SIGTERM before restart"),
        });
        assert.notEqual(request({ action: "status" }).ready, true);
        const crashed = await launch();
        await page.ab("close");
        await page.restartBackend({
          signal: "SIGKILL",
          beforeRestart: () => gone(crashed, "Piano SIGKILL before restart"),
        });
        const dead = request({ action: "status" });
        assert.notEqual(dead.ready, true);
        await page.open(sessionPath);
        await page.until("!!document.querySelector('[aria-label=Message]')");
        assert.notEqual(
          request({ action: "status" }).ready,
          true,
          "reopen never adopts/relaunches",
        );
        assert.equal(await headerPreview(), null, "a restarted Piano shows no stale preview");
        await page.capture("4-reopened-without-preview");

        const chooseCommand = async (label) => {
          await page.press("Mod+K");
          await page.ab("fill", "[cmdk-input]", label);
          await page.until(
            "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
          );
          await page.click("option", label);
        };
        const archived = await launch();
        await chooseCommand("Archive");
        await page.see("Stop and archive this session?");
        await page.see("the app");
        await page.capture("5a-archive-confirms-app");
        await page.click("button", "Stop and archive");
        await gone(archived, "Archive through command palette");
        await page.capture("5-archived");
        const create = async () => {
          const count = observations.length;
          await page.open("/new");
          await page.ab("fill", '[aria-label="First message"]', "Run this app");
          await page.until("document.querySelector('[aria-label=Send]')?.disabled === false");
          await page.click("button", "Send");
          for (let i = 0; observations.length === count || !app.ready; i++) {
            assert.ok(i < 300, "fresh session preview ready");
            await delay(100);
          }
          await page.until(
            "!!document.querySelector('[aria-label=Message]') && !document.querySelector('[aria-label=Stop]')",
          );
          return app;
        };
        const deleted = await create();
        await chooseCommand("Delete");
        await page.see("Delete session?");
        await page.see("This will stop the app the session started.");
        await page.click("button", "Stop and delete");
        await gone(deleted, "Delete through command palette and confirmation");
        await page.capture("6-deleted");
        const missing = await create();
        rmSync(repo, { recursive: true, force: true });
        await chooseCommand("Archive");
        await page.click("button", "Stop and archive");
        await gone(missing, "Archive after checkout removal uses retained ownership");
      } finally {
        // Clean up even when a launch succeeded but its reply never reached the scripted model.
        for (const file of existsSync(state)
          ? readdirSync(state).filter((file) => file.endsWith(".json"))
          : []) {
          // Stop first: an assertion must never leave a scratch app running.
          const record = JSON.parse(readFileSync(join(state, file), "utf8"));
          await new PreviewAdapter().retire(record.owner, state);
          observations.push({ cleanup: record.instanceId });
          assert.equal(record.workspace, canonicalRepo);
        }
        writeFileSync(join(evidence, "observations.json"), JSON.stringify(observations, null, 2));
      }
    },
    {
      backendEnv: {
        ...env,
        PIANO_PI_CLI: shim,
        PIANO_IDLE_MINUTES: "0.0333333333",
        PIANO_PI_ARGS:
          "--offline --no-builtin-tools --no-skills --no-prompt-templates --no-context-files",
      },
    },
  );
} finally {
  held?.end();
  model.closeAllConnections();
  await new Promise((done) => model.close(done));
  rmSync(scratch, { recursive: true, force: true });
}
