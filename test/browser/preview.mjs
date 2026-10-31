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
const embeddedLocal = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
if (!embeddedLocal)
  console.warn(
    `Embedded-page checks skipped: ${origin} is not loopback. See docs/testing.md to enable them.`,
  );
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
const browserMode = join(scratch, "browser-mode");
writeFileSync(browserMode, "normal");
let command;
const observations = [
  {
    origin,
    platform: process.platform,
    embeddedLocal,
    authenticatedHttps:
      "unverified — requires a signed-in browser; no credentials or access policy changed",
  },
];
let app;
let held;
let repo;
let canonicalRepo;
const env = { PIANO_PREVIEW_CONFIG: config, PIANO_PREVIEW_STATE: state };
const request = (args, ownerPreview) =>
  JSON.parse(
    execFileSync(process.execPath, [join(ROOT, "scripts/preview.ts")], {
      env: {
        PATH: "/usr/bin:/bin",
        ...env,
        ...(ownerPreview && { PIANO_PREVIEW_OWNER: piFor(ownerPreview).endpoint }),
      },
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
  if (prompt === "Revise the app heading") {
    // Deterministic revision through the ordinary composer; no paid model or new feedback path.
    writeFileSync(join(repo, "heading.js"), 'export default "Preview journey v2 HMR";');
    delta = { role: "assistant", content: "APP_UPDATED" };
  } else if (!tool) {
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
        ? `PREVIEW_READY: [Open preview](${app.url})\nInstance ${app.instanceId}\n[App source](app.mjs)`
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
      // A checkout-native frontend application with an inspected dev entry point, not a
      // generated report hosted just to obtain a URL. The scripted model tests tool plumbing,
      // not whether an arbitrary model follows launch guidance.
      writeFileSync(
        join(repo, "package.json"),
        JSON.stringify({
          name: "preview-journey-app",
          private: true,
          type: "module",
          scripts: { dev: "node app.mjs" },
        }),
      );
      writeFileSync(
        join(repo, "index.html"),
        '<h1>Preview journey v1</h1><button id="count">Count: 0</button><form><label>App draft<input name="draft" aria-label="App draft"></label><button>Save draft</button></form><a href="#route">App route</a><p id="route">Route: entry</p><p id="scroll">Scroll: top</p><p style="margin-top:1200px">End of app</p><script type="module" src="/src.js"></script>',
      );
      writeFileSync(
        join(repo, "src.js"),
        `import heading from './heading.js';
const update = text => document.querySelector('h1').textContent = text;
update(heading);
if (import.meta.hot) import.meta.hot.accept('./heading.js', m => update(m.default));
if (location.search) document.querySelector('#route').textContent = 'Route: ' + location.search;
addEventListener('hashchange', () => document.querySelector('#route').textContent = 'Route: ' + location.hash);
addEventListener('scroll', () => document.querySelector('#scroll').textContent = scrollY > 0 ? 'Scroll: moved' : 'Scroll: top');
let count=0; document.querySelector('#count').onclick = e => { e.target.textContent = 'Count: ' + ++count; };`,
      );
      writeFileSync(join(repo, "heading.js"), 'export default "Preview journey v1";');
      writeFileSync(
        join(repo, "vite.config.mjs"),
        `import { readFileSync } from 'node:fs';
export default { plugins: [{ name: 'browser-boundary-fixture', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.headers['sec-fetch-dest'] !== 'iframe') return next();
    const mode = readFileSync(${JSON.stringify(browserMode)}, 'utf8');
    if (mode === 'pending') return; // browser-only stall; local readiness still answers
    if (mode === 'denied') {
      res.writeHead(200, { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'Cache-Control': 'no-store', 'Content-Type': 'text/html' });
      return res.end('<h1>Framing denied fixture</h1>');
    }
    if (mode === 'login') { res.writeHead(401, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return res.end('<h1>Sign in required</h1>'); }
    next();
  });
} }] };`,
      );
      assert.equal(
        JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts.dev,
        "node app.mjs",
      );
      command = [process.execPath, "app.mjs", "{port}"];
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
        const railPreview = () =>
          page.evaluate(
            "!!document.querySelector('[data-slot=session-rail] button[aria-label=\"Show preview\"]')",
          );
        const showRail = async () => {
          if (!(await railPreview())) await page.click("button", "Show session rail");
          await page.until(
            "!!document.querySelector('[data-slot=session-rail] button[aria-label=\"Show preview\"]')",
          );
        };
        const showPreview = async () => {
          await showRail();
          await page.click("button", "Show preview");
          await page.until(
            "!!document.querySelector('[data-slot=surface-area]:not([inert]) section[aria-label=Preview]')",
          );
        };
        // Cross-origin content is observed through the browser's accessibility tree, not a
        // production DOM bridge. CLI frame-scoped CSS/eval is not supported by this release.
        const appSee = async (text) => {
          const deadline = Date.now() + 15000;
          while (!(await page.ab("snapshot")).includes(text)) {
            assert.ok(Date.now() < deadline, `app did not show ${text}`);
            await delay(100);
          }
        };
        const appAct = async (name, action, ...args) => {
          const snapshot = await page.ab("snapshot");
          const line = snapshot
            .split("\n")
            .find((line) => line.includes(`"${name}"`) && line.includes("[ref="));
          const ref = line?.match(/ref=(e\d+)/)?.[1];
          assert.ok(ref, `${name} is accessible in the app`);
          if (action === "click") {
            // Native CLI pointer hit-testing double-counts some iframe offsets; keyboard
            // activation still exercises the app control without a DOM .click().
            await page.ab("focus", `@${ref}`);
            await page.press("Enter");
          } else await page.ab(action, `@${ref}`, ...args);
        };
        const frameReady = () => appSee("Count: 0");
        const rememberFrame = () =>
          page.evaluate(
            "!!(window.previousPreviewFrame = document.querySelector('iframe[title=\"App preview\"]'))",
          );
        const sameFrame = () =>
          page.evaluate(
            "window.previousPreviewFrame === document.querySelector('iframe[title=\"App preview\"]')",
          );
        const noFrame = () =>
          page.until("!document.querySelector('iframe[title=\"App preview\"]')");
        const more = async () => {
          await page.until("!document.querySelector('[data-sonner-toast]')");
          await page.click("button", "More preview actions");
        };
        assert.equal(
          await page.evaluate(
            "!!document.querySelector('header button[aria-label^=\"Preview:\"]')",
          ),
          false,
        );
        assert.equal(
          await page.evaluate("!!document.querySelector('[data-slot=surface-area]:not([inert])')"),
          false,
          "appearing app never opens Surface",
        );
        await showRail();
        assert.equal(
          await page.evaluate(
            "document.querySelector('[data-slot=session-rail] a[aria-label=\"Open preview in new tab\"]')?.target",
          ),
          "_blank",
        );
        await page.ab("fill", '[aria-label="Message"]', "Keep my draft");
        await page.ab("upload", 'input[type="file"]', join(evidence, "1-settled-preview-link.png"));
        await page.capture("1b-rail-preview");
        // Sibling keyboard targets: the row inspects, its link only opens a browser tab.
        await page.ab("focus", '[data-slot=session-rail] button[aria-label="Show preview"]');
        await page.press("Tab");
        assert.equal(
          await page.evaluate("document.activeElement?.getAttribute('aria-label')"),
          "Open preview in new tab",
        );
        await page.press("Enter");
        await page.capture("1b-external-row-answer");
        observations.push({ externalRowTabs: await page.ab("tab", "list") });
        await page.ab("tab", "close");
        assert.equal(
          await page.evaluate("!!document.querySelector('[data-slot=surface-area]:not([inert])')"),
          false,
          "external row action never selects Preview",
        );
        await page.click("button", "App");
        await page.capture("1b-app-folded");
        await page.click("button", "App");
        // PIN-125: Space activates the focused row once; the draft is not typed into.
        await page.ab("focus", '[data-slot=session-rail] button[aria-label="Show preview"]');
        await page.press("Space");
        await page.until(
          "!!document.querySelector('[data-slot=surface-area]:not([inert]) section[aria-label=Preview]')",
        );
        assert.equal(
          await page.evaluate("document.querySelector('[aria-label=Message]').value"),
          "Keep my draft",
          "Space on Show preview leaves the draft alone",
        );
        if (embeddedLocal) {
          await frameReady();
          await appAct("Count: 0", "click");
          await appAct("App draft", "fill", "Keep app state");
          await appAct("App route", "click");
          await rememberFrame();
        }
        await page.capture("1c-preview-surface");
        await page.click("link", "Open in new tab");
        await page.capture("1c-toolbar-external-answer");
        await page.ab("tab", "close");
        await page.click("button", "Changes");
        await page.click("button", "App source");
        await page.press("Mod+K");
        await page.ab("fill", "[cmdk-input]", "Show preview");
        await page.until(
          "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
        );
        await page.click("option", "Show preview");
        await page.capture("1c-preview-and-changes");
        await page.click("button", "Show session rail");
        await page.capture("1c-rail-covers-tabs");
        await page.click("button", "Show preview");
        if (embeddedLocal) {
          assert.equal(
            await sameFrame(),
            true,
            "Changes, file and rail switches preserve the frame node",
          );
          await appSee("Count: 1");
          await appSee("Keep app state");
          await appSee("Route: #route");
          await page.capture("1c-preserved-page");
          await page.click("button", "Reload preview");
          await frameReady();
          assert.equal(await sameFrame(), false, "Reload replaces only the browsing context");
          assert.equal(request({ action: "status" }).instanceId, identity);
          await appSee("Route: entry");
          assert.ok(!(await page.ab("snapshot")).includes("Keep app state"));
          await page.capture("1c-reload-answer");
          await rememberFrame();
        }
        assert.equal(
          await page.evaluate("document.querySelector('[aria-label=Message]').value"),
          "Keep my draft",
        );
        assert.ok(
          await page.evaluate(
            "!!document.querySelector('[aria-label=\"Remove 1-settled-preview-link.png\"]')",
          ),
        );
        await page.click("button", "Remove 1-settled-preview-link.png");
        await page.ab("fill", '[aria-label="Message"]', "");
        await page.click("button", "Close app.mjs");
        await page.click("button", "Hide changes");
        await page.until(
          "document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.textContent.includes('Preview')",
        );
        await more();
        await page.capture("1c-preview-menu");
        await page.click("menuitem", "Details");
        await page.see("Output");
        await page.until(
          "document.activeElement?.tagName === 'A' && document.activeElement.textContent.includes('Open in new tab')",
        );
        await page.until(
          "/VITE|ready in/i.test(document.querySelector('[role=dialog] pre')?.textContent ?? '')",
        );
        await page.click("button", "Refresh");
        await page.until(
          "document.querySelector('[role=dialog] button[aria-busy]')?.getAttribute('aria-busy') === 'false'",
        );
        await page.capture("1d-preview-details");
        if (embeddedLocal)
          assert.equal(await sameFrame(), true, "Details/status refresh does not reload");
        await page.click("link", "Open in new tab");
        await page.capture("1d-details-external-answer");
        await page.ab("tab", "close");
        await page.press("Escape");
        await page.until("!document.querySelector('[role=dialog]')");
        await more();
        await page.click("menuitem", "Copy link");
        await page.see("Preview link copied");
        await page.capture("1e-copy-feedback");
        await more();
        await page.click("menuitem", "Stop preview");
        await page.see("Stop preview?");
        await page.capture("1f-stop-confirmation");
        await page.click("button", "Cancel");
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.press("Mod+K");
        await page.ab("fill", "[cmdk-input]", "preview");
        await page.until(
          "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
        );
        for (const label of [
          "Show preview",
          "Open preview in new tab",
          "Preview details",
          "Stop preview",
        ])
          await page.until(
            `[...document.querySelectorAll('[cmdk-item]')].some(o => o.textContent.includes(${JSON.stringify(label)}))`,
          );
        await page.capture("1g-palette-preview-commands");
        await page.click("option", "Preview details");
        await page.see("Output");
        await page.capture("1g-palette-details-answer");
        await page.press("Escape");
        const previewCommand = async (label) => {
          await page.press("Mod+K");
          await page.ab("fill", "[cmdk-input]", label);
          await page.until(
            "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
          );
          await page.ab("find", "role", "option", "click", "--name", label);
        };
        await previewCommand("Open preview in new tab");
        await page.capture("1g-palette-external-answer");
        await page.ab("tab", "close");
        await previewCommand("Stop preview");
        await page.see("Stop preview?");
        await page.capture("1g-palette-stop-answer");
        await page.click("button", "Cancel");

        if (embeddedLocal) {
          // Browser failures are independent of local readiness. The fixture changes only its
          // iframe response, never Piano's headers, credentials or allowed control origins.
          writeFileSync(browserMode, "pending");
          await page.click("button", "Reload preview");
          await page.until(
            "document.querySelector('[aria-label=\"Reload preview\"]')?.getAttribute('aria-busy') === 'true'",
          );
          await page.capture("1g-frame-loading");
          await page.click("link", "Open in new tab");
          await page.see("Preview journey v1");
          await page.capture("1g-open-while-loading");
          await page.ab("tab", "close");
          await page.until(
            "document.querySelector('[aria-label=\"Reload preview\"]')?.getAttribute('aria-busy') === 'false'",
          );
          assert.equal(request({ action: "status" }).instanceId, identity);
          await page.click("button", "Preview not appearing?");
          await page.capture("1g-recovery-answer");
          await page.ab("click", "[data-slot=popover-content] button");
          await page.until("!document.querySelector('[data-radix-popper-content-wrapper]')");
          await rememberFrame();
          await page.click("button", "Reload preview");
          // The old page's load handler goes with its detached frame; only the new page can
          // finish this reload. (An event dispatched on a detached node reaches no React handler.)
          assert.equal(
            await page.evaluate(
              "window.previousPreviewFrame.isConnected === false && !!document.querySelector('iframe[title=\"App preview\"]')",
            ),
            true,
            "reload detaches the old page",
          );
          assert.equal(
            await page.evaluate(
              "document.querySelector('[aria-label=\"Reload preview\"]').getAttribute('aria-busy')",
            ),
            "true",
            "a pending new page keeps the reload busy",
          );
          await page.until(
            "document.querySelector('[aria-label=\"Reload preview\"]')?.getAttribute('aria-busy') === 'false'",
          );
          await page.capture("1g-bounded-loading");
          writeFileSync(browserMode, "denied");
          await page.click("button", "Reload preview");
          const denied = await fetch(app.url, { headers: { "sec-fetch-dest": "iframe" } });
          assert.equal(denied.headers.get("x-frame-options"), "DENY");
          assert.equal(denied.headers.get("content-security-policy"), "frame-ancestors 'none'");
          await page.until(
            "document.querySelector('[aria-label=\"Reload preview\"]')?.getAttribute('aria-busy') === 'false'",
          );
          await page.click("button", "Preview not appearing?");
          await page.capture("1g-framing-denied-recovery");
          await page.ab("click", "[data-slot=popover-content] a");
          await page.see("Preview journey v1");
          await page.capture("1g-recovery-external-answer");
          await page.ab("tab", "close");
          await page.press("Escape");
          writeFileSync(browserMode, "login");
          await page.click("button", "Reload preview");
          await appSee("Sign in required");
          await page.capture("1g-login-gated-frame");
          assert.equal(
            request({ action: "status" }).ready,
            true,
            "browser login is not service readiness",
          );
          writeFileSync(browserMode, "normal");
          await page.click("button", "Reload preview");
          await frameReady();
          // Native keyboard traversal enters and leaves the frame; no bridge intercepts keys.
          await page.ab("focus", '[aria-label="More preview actions"]');
          await page.press("Tab");
          await page.until("document.activeElement?.tagName === 'IFRAME'");
          await page.press("Shift+Tab");
          await page.until(
            "document.activeElement?.getAttribute('aria-label') === 'More preview actions'",
          );
          await page.press("Shift+Tab");
          await page.until("document.activeElement?.textContent.includes('Open in new tab')");
          await page.press("Shift+Tab");
          await page.until(
            "document.activeElement?.getAttribute('aria-label') === 'Reload preview'",
          );
          await page.capture("1g-keyboard-frame-return");
          observations.push({
            frameFallbacks: ["bounded pending", "DENY + frame-ancestors", "401 login"],
            keyboardFrameTraversal: true,
          });
        }

        // An unreadable scratch intent is an observation/stop error, not absence. The service
        // still belongs to its live owner. Restore the external boundary before any cleanup.
        const intentPath = join(state, first.serviceId + ".json");
        const intent = readFileSync(intentPath, "utf8");
        try {
          writeFileSync(intentPath, "unreadable scratch intent");
          await more();
          await page.click("menuitem", "Details");
          await page.see("Status unavailable");
          await noFrame();
          await page.capture("1h-unknown-details");
          await page.press("Escape");
          await page.click("button", "Check status");
          await page.capture("1h-check-status");
          await more();
          await page.click("menuitem", "Stop preview");
          await page.click("button", "Stop preview");
          await page.until("!!document.querySelector('[data-sonner-toast][data-type=error]')");
          await page.capture("1h-failed-stop");
          await page.until("!document.querySelector('[data-sonner-toast]')");
          assert.ok(running(first.testPids[0]), "failed stop keeps app inspectable and alive");
        } finally {
          writeFileSync(intentPath, intent);
        }
        await page.click("button", "Check status");
        await page.until("!!document.querySelector('section[aria-label=Preview] a')");

        // Another session in this same checkout cannot discover or adopt the owner's app.
        await page.open("/new");
        await noFrame();
        await page.ab("fill", '[aria-label="First message"]', "status");
        await page.until("document.querySelector('[aria-label=Send]')?.disabled === false");
        await page.click("button", "Send");
        await page.see("PREVIEW_READY");
        // The transcript can link the workspace app; it is still not this session's live row.
        assert.equal(await railPreview(), false);
        await page.capture("1i-non-owning-session");
        await page.open(sessionPath);
        await showPreview();
        app = first;

        // On a Mac the link itself is opened. External exe.dev login is intentionally not bypassed:
        // there, local browser load is a separate claim.
        await page.ab("tab", "new", local ? app.url : `http://127.0.0.1:${app.port}/`);
        await page.see("Preview journey v1");
        await page.capture("2-app-load");
        await page.ab("tab", "close");
        if (embeddedLocal) {
          await appAct("Count: 0", "click");
          await rememberFrame();
        }
        await page.ab("fill", '[aria-label="Message"]', "Revise the app heading");
        await page.click("button", "Send");
        await page.see("APP_UPDATED");
        if (embeddedLocal) {
          await appSee("Preview journey v2 HMR");
          await appSee("Count: 1");
          assert.equal(await sameFrame(), true, "HMR updates the app without reloading it");
          await page.capture("3-embedded-hot-reload");
        }
        await page.ab("tab", "new", local ? app.url : `http://127.0.0.1:${app.port}/`);
        await page.see("Preview journey v2 HMR");
        await page.capture("3-revised-app-load");
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
        await showPreview();
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.capture("2b-reload-same-preview");
        await page.ab("set", "viewport", "390", "844");
        await page.click("button", "Close preview");
        await showRail();
        await page.capture("2b-narrow-rail");
        await page.click("button", "Show preview");
        await page.until("!document.querySelector('[role=dialog]')");
        await page.capture("2b-narrow-preview");
        if (embeddedLocal) {
          await frameReady();
          await appAct("Count: 0", "click");
          await appAct("App draft", "fill", "Narrow draft");
          await rememberFrame();
          await page.click("tab", "Agent");
          await page.click("button", "Changes");
          await page.click("tab", "Preview");
          await showRail();
          await page.click("button", "Show preview");
          assert.equal(await sameFrame(), true, "narrow Agent/Changes/rail preserve the page");
          await appSee("Count: 1");
          await appSee("Narrow draft");
          await page.capture("2b-narrow-preserved-page");
          await page.click("button", "Reload preview");
          await frameReady();
          assert.equal(request({ action: "status" }).instanceId, identity);
          await page.capture("2b-narrow-reload-answer");
          await appAct("App draft", "fill", "Saved");
          await appAct("Save draft", "click");
          await appSee("Route: ?draft=Saved");
          await page.capture("2b-narrow-form-submit");
          // Native browser input only: no device emulation or app-side scrolling helper.
          const socket = new WebSocket(await page.ab("get", "cdp-url"));
          let id = 0;
          const cdp = (method, params = {}, sessionId) =>
            new Promise((resolve, reject) => {
              const request = ++id;
              const timer = setTimeout(() => {
                socket.removeEventListener("message", receive);
                reject(new Error(`CDP ${method} timed out`));
              }, 10000);
              const receive = ({ data }) => {
                const m = JSON.parse(data);
                if (m.id !== request) return;
                clearTimeout(timer);
                socket.removeEventListener("message", receive);
                if (m.error) reject(new Error(JSON.stringify(m.error)));
                else resolve(m.result);
              };
              socket.addEventListener("message", receive);
              socket.send(JSON.stringify({ id: request, method, params, sessionId }));
            });
          try {
            await new Promise((resolve, reject) => {
              socket.addEventListener("open", resolve, { once: true });
              socket.addEventListener("error", reject, { once: true });
            });
            const url = await page.ab("get", "url");
            const { targetInfos } = await cdp("Target.getTargets");
            const target = targetInfos.find((t) => t.type === "page" && t.url === url);
            assert.ok(target);
            const { sessionId } = await cdp("Target.attachToTarget", {
              targetId: target.targetId,
              flatten: true,
            });
            await cdp(
              "Input.dispatchTouchEvent",
              { type: "touchStart", touchPoints: [{ x: 190, y: 600 }] },
              sessionId,
            );
            for (let y = 580; y >= 200; y -= 20) {
              await cdp(
                "Input.dispatchTouchEvent",
                { type: "touchMove", touchPoints: [{ x: 190, y }] },
                sessionId,
              );
              await delay(16);
            }
            await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId);
            await appSee("Scroll: moved");
            await page.capture("2b-narrow-touch-scroll");
            observations.push({
              touch: "Chromium synthetic touch scroll at 390×844; not real phone evidence",
            });
          } finally {
            socket.close();
          }
          await page.click("tab", "Changes");
          await page.click("button", "Hide changes");
        }
        await page.click("link", "Open in new tab");
        await page.capture("2b-narrow-external-answer");
        await page.ab("tab", "close");
        await more();
        await page.click("menuitem", "Details");
        await page.capture("2b-narrow-details");
        await page.press("Escape");
        await more();
        await page.click("menuitem", "Copy link");
        await page.see("Preview link copied");
        await page.capture("2b-narrow-copy");
        await more();
        await page.capture("2b-narrow-menu");
        await page.click("menuitem", "Stop preview");
        await page.see("Stop preview?");
        await page.capture("2b-narrow-stop-confirmation");
        await page.click("button", "Stop preview");
        await page.see("Preview stopped");
        await gone(first, "confirmed Stop preview in narrow Surface");
        await page.until(
          "document.querySelector('section[aria-label=Preview]')?.textContent.includes('Preview stopped')",
        );
        await noFrame();
        await page.capture("2b-narrow-stopped");
        await page.until("!document.querySelector('[data-sonner-toast]')");
        await page.click("button", "Close preview");
        await page.until("document.activeElement?.hasAttribute('data-rail-trigger')");
        await page.capture("2b-narrow-agent");
        await page.ab("set", "viewport", "1280", "900");
        await page.until("!document.querySelector('section[aria-label=Preview] a')");
        assert.equal(
          new Set(observations.filter((o) => o.ready).map((o) => o.instanceId)).size,
          1,
          "Stop never relaunches",
        );
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
        const replacing = await launch();
        await showPreview();
        if (embeddedLocal) {
          await frameReady();
          await rememberFrame();
        }
        await more();
        await page.click("menuitem", "Stop preview");
        await page.see("Stop preview?");
        // A concurrent owner request replaces the app while the browser confirmation is open.
        if (embeddedLocal) writeFileSync(browserMode, "pending");
        const replacement = request(
          { action: "start", replace: replacing.instanceId, command, env: appEnv },
          replacing,
        );
        replacement.testPids = JSON.parse(readFileSync(join(repo, "app-processes.json"), "utf8"));
        assert.notEqual(replacement.instanceId, replacing.instanceId);
        await page.until(
          "[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Stop preview')?.disabled === true",
        );
        await page.capture("3a-replacement-fences-confirmation");
        assert.equal(request({ action: "status" }).instanceId, replacement.instanceId);
        await page.click("button", "Cancel");
        if (embeddedLocal) {
          assert.equal(await sameFrame(), false, "a replacement must dispose the old page");
          // The new frame is still pending; the old instance's frame, and its load handler, are gone.
          assert.equal(
            await page.evaluate("window.previousPreviewFrame.isConnected"),
            false,
            "a replacement detaches the old page",
          );
          assert.equal(
            await page.evaluate(
              "document.querySelector('[aria-label=\"Reload preview\"]').getAttribute('aria-busy')",
            ),
            "true",
          );
          await page.capture("3b-replacement-pending-old-load-ignored");
          writeFileSync(browserMode, "normal");
          await page.click("button", "Reload preview");
          await frameReady();
        }
        await page.capture("3b-replacement-current-view");
        observations.push({ replacement: replacement.instanceId, replaced: replacing.instanceId });
        // Keep this owner active while inspecting a terminal app: this scratch instance's
        // two-second idle retirement deliberately releases failed/exited apps as well.
        await page.ab("fill", '[aria-label="Message"]', "hold");
        await page.click("button", "Send");
        await page.until("!!document.querySelector('[aria-label=Stop]')");
        // Native nonzero app termination remains inspectable rather than disappearing.
        process.kill(replacement.testPids[0], "SIGKILL");
        await gone(replacement, "application failure cleans its children");
        request({ action: "status" }, replacement);
        await page.see("Failed");
        await noFrame();
        await page.capture("3c-failed-preview");
        await page.click("button", "Check status");
        await more();
        await page.click("menuitem", "Details");
        await page.capture("3d-failed-details");
        await page.press("Escape");
        await more();
        await page.click("menuitem", "Stop preview");
        await page.click("button", "Stop preview");
        await page.until(
          "document.querySelector('section[aria-label=Preview]')?.textContent.includes('Preview stopped')",
        );
        await page.capture("3e-desktop-stopped");
        await page.click("button", "Stop");
        held?.end();
        const ended = await launch();
        await showPreview();
        if (embeddedLocal) {
          await frameReady();
          await appAct("Count: 0", "click");
          await page.until("document.activeElement?.tagName === 'IFRAME'");
        }
        process.kill(piFor(ended).pid, "SIGKILL");
        await gone(ended, "owner exit while Preview stays open");
        await page.see("Preview unavailable");
        await noFrame();
        if (embeddedLocal)
          await page.until("document.activeElement?.getAttribute('role') === 'tabpanel'");
        await page.capture("3f-owner-ended-open-view");
        assert.equal(await railPreview(), false);
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
        assert.equal(await railPreview(), false, "a restarted Piano shows no stale preview");
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
      agentBrowser: "agent-browser@0.39.1",
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
