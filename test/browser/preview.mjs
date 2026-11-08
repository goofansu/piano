// Opt-in critical path on Linux/systemd or macOS/launchd. Real installed Pi + scripted loopback
// model (no credentials).
// node test/browser/preview.mjs [evidence-directory]
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
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
import { promisify } from "node:util";
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
const externalLocal = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
if (!externalLocal)
  console.warn(
    `External-link app interaction skipped: ${origin} is not loopback. Set PIANO_PREVIEW_CONFIG to a JSON file with {"origin":"http://127.0.0.1"} to prove it.`,
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
    externalLocal,
    authenticatedHttps:
      "unverified — requires a signed-in browser; no credentials or access policy changed",
  },
];
let app;
let held;
let repo;
let canonicalRepo;
const env = { PIANO_PREVIEW_CONFIG: config, PIANO_PREVIEW_STATE: state };
const helper = (ownerPreview) => ({
  env: {
    PATH: "/usr/bin:/bin",
    ...env,
    ...(ownerPreview && { PIANO_PREVIEW_OWNER: piFor(ownerPreview).endpoint }),
  },
  encoding: "utf8",
  timeout: 120_000,
});
const request = (args, ownerPreview) =>
  JSON.parse(
    execFileSync(process.execPath, [join(ROOT, "scripts/preview.ts")], {
      ...helper(ownerPreview),
      input: JSON.stringify({ ...args, workspace: repo }),
    }),
  );
/** The same request, without blocking the journey while the owner works on it. */
const requestLater = async (args, ownerPreview) => {
  const pending = promisify(execFile)(
    process.execPath,
    [join(ROOT, "scripts/preview.ts")],
    helper(ownerPreview),
  );
  pending.child.stdin.end(JSON.stringify({ ...args, workspace: repo }));
  return JSON.parse((await pending).stdout);
};
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
    const mode = readFileSync(${JSON.stringify(browserMode)}, 'utf8');
    if (mode === 'warming') {
      // A replacement still warming up on the reused port: local readiness fails too.
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end('Replacement warming up');
    }
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
        const externalLink = 'a[aria-label="Open preview in new tab"]';
        const headerLink = `header ${externalLink}`;
        const railLink = `[data-slot=session-rail] ${externalLink}`;
        const railPreview = () =>
          page.evaluate(
            "!!document.querySelector('[data-slot=session-rail] [aria-label=\"More preview actions\"]')",
          );
        const showRail = async () => {
          if (await page.evaluate("!!document.querySelector('[aria-label=\"Show session rail\"]')"))
            await page.click("button", "Show session rail");
          await page.until(
            "!!document.querySelector('[data-slot=session-rail] [aria-label=\"More preview actions\"]')",
          );
        };
        const noEmbeddedPreview = () =>
          page.until(
            "!document.querySelector('iframe[title=\"App preview\"], [data-slot=surface-area] section[aria-label=Preview], button[aria-label=\"Show preview\"]') && ![...document.querySelectorAll('[role=tab]')].some(t => t.textContent.trim().startsWith('Preview'))",
          );
        // A closing dialog hides the rest of the page from accessibility until it has closed.
        const dialogClosed = () =>
          page.until(
            "!document.querySelector('[role=dialog],[role=alertdialog],[data-aria-hidden]')",
          );
        const more = async () => {
          await page.until("!document.querySelector('[data-sonner-toast]')");
          await showRail();
          await page.click("button", "More preview actions");
        };
        const detailsReady = async () => {
          await page.see("Output");
          await page.until(
            "document.querySelector('[role=dialog] button[aria-busy]')?.getAttribute('aria-busy') === 'false'",
          );
          assert.equal(
            await page.evaluate("document.querySelector('[role=dialog] h2')?.textContent"),
            "Preview",
          );
        };
        const refreshDetails = async () => {
          await detailsReady();
          await page.click("button", "Refresh");
          await detailsReady();
        };
        // Opening the actual UI link proves the tab destination. Only loopback runs can also
        // prove interaction: exe.dev authentication is intentionally not bypassed.
        const externalAnswer = async (name, heading = "Preview journey v1") => {
          if (externalLocal) {
            await page.see(heading);
            assert.equal(new URL(await page.ab("get", "url")).origin, new URL(app.url).origin);
            await page.click("button", "Count: 0");
            await page.see("Count: 1");
            await page.ab("fill", '[aria-label="App draft"]', "Saved");
            await page.click("button", "Save draft");
            await page.see("Route: ?draft=Saved");
          }
          await page.capture(name);
          observations.push({
            externalPath: name,
            interacted: externalLocal,
            tabs: await page.ab("tab", "list"),
          });
          await page.ab("tab", "close");
        };
        await noEmbeddedPreview();
        await page.until(`!!document.querySelector(${JSON.stringify(headerLink)})`);
        assert.equal(
          await page.evaluate(
            `document.querySelector(${JSON.stringify(headerLink)}).textContent.trim()`,
          ),
          "",
          "header preview link is icon-only",
        );
        assert.equal(
          await page.evaluate(`document.querySelector(${JSON.stringify(headerLink)}).target`),
          "_blank",
        );
        await page.ab("click", headerLink);
        await externalAnswer("1a-header-external-answer");
        assert.equal(new URL(await page.ab("get", "url")).pathname, sessionPath);
        await page.click("button", "Session information and actions");
        await page.until(
          "!!document.querySelector('[role=menu]') && !document.querySelector('[role=dialog]')",
        );
        await page.press("Escape");
        await showRail();
        await page.until(
          "document.querySelector('[data-slot=session-rail]').textContent.includes('Running')",
        );
        assert.equal(
          await page.evaluate(`document.querySelector(${JSON.stringify(railLink)}).target`),
          "_blank",
        );
        assert.ok(
          (
            await page.evaluate(`document.querySelector(${JSON.stringify(railLink)}).textContent`)
          ).includes(new URL(app.url).hostname),
        );
        await page.ab("fill", '[aria-label="Message"]', "Keep my draft");
        await page.ab("upload", 'input[type="file"]', join(evidence, "1-settled-preview-link.png"));
        await page.capture("1b-rail-preview");
        await page.ab("focus", railLink);
        await page.press("Enter");
        await externalAnswer("1b-rail-external-answer");
        assert.equal(new URL(await page.ab("get", "url")).pathname, sessionPath);
        await noEmbeddedPreview();
        assert.equal(
          await page.evaluate("!!document.querySelector('[data-slot=surface-area]:not([inert])')"),
          false,
          "rail link never opens a Surface",
        );
        await page.click("button", "App");
        await page.capture("1b-app-folded");
        await page.click("button", "App");
        // File/Changes inspection remains independent of external preview and composer state.
        await page.click("button", "Changes");
        await page.click("button", "App source");
        await page.until("!!document.querySelector('[aria-label=\"Close app.mjs\"]')");
        await page.capture("1c-changes-and-source");
        await noEmbeddedPreview();
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
        await more();
        await page.capture("1c-preview-menu");
        await page.click("menuitem", "Preview details");
        await detailsReady();
        await page.until(
          "/VITE|ready in/i.test(document.querySelector('[role=dialog] pre')?.textContent ?? '')",
        );
        await refreshDetails();
        await page.capture("1d-preview-details");
        await page.click("link", "Open preview in new tab");
        await externalAnswer("1d-details-external-answer");
        await page.press("Escape");
        await dialogClosed();
        await more();
        await page.click("menuitem", "Stop preview");
        await page.see("Stop preview?");
        await page.capture("1f-stop-confirmation");
        await page.click("button", "Cancel");
        await dialogClosed();
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.press("Mod+K");
        await page.ab("fill", "[cmdk-input]", "preview");
        await page.until(
          "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
        );
        for (const label of ["Open preview in new tab", "Preview details", "Stop preview"])
          await page.until(
            `[...document.querySelectorAll('[cmdk-item]')].some(o => o.textContent.includes(${JSON.stringify(label)}))`,
          );
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('[cmdk-item]')].some(o => o.textContent.includes('Show preview'))",
          ),
          false,
        );
        await page.capture("1g-palette-preview-commands");
        await page.click("option", "Preview details");
        await detailsReady();
        await page.capture("1g-palette-details-answer");
        await page.press("Escape");
        await dialogClosed();
        const previewCommand = async (label) => {
          await page.press("Mod+K");
          await page.ab("fill", "[cmdk-input]", label);
          await page.until(
            "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
          );
          await page.ab("find", "role", "option", "click", "--name", label);
        };
        await previewCommand("Open preview in new tab");
        await externalAnswer("1g-palette-external-answer");
        await previewCommand("Stop preview");
        await page.see("Stop preview?");
        await page.capture("1g-palette-stop-answer");
        await page.click("button", "Cancel");
        await dialogClosed();

        const openPreviewPane = async () => {
          await page.click("button", "Session information and actions");
          await page.until("!!document.querySelector('[role=dialog] button[aria-label=Preview]')");
          await page.evaluate("window.previewSheet = document.querySelector('[role=dialog]')");
          await page.click("button", "Preview");
          await page.until("!!document.querySelector('[role=dialog] button[aria-label=Back]')");
          assert.equal(
            await page.evaluate(
              "window.previewSheet === document.querySelector('[role=dialog]') && document.querySelectorAll('[role=dialog]').length === 1",
            ),
            true,
            "Preview pushes within the same sheet",
          );
          await noEmbeddedPreview();
        };
        const paneUnavailable = async () => {
          await page.see("Preview unavailable");
          await page.until("!!document.querySelector('[role=dialog] button[aria-label=Back]')");
          assert.equal(
            await page.evaluate(
              "[...document.querySelectorAll('[role=dialog] a, [role=dialog] button:not(:disabled)')].some(e => e.tagName === 'A' || ['Preview details', 'Stop preview'].includes(e.textContent.trim()))",
            ),
            false,
            "an invalidated pane has no live app actions",
          );
          await noEmbeddedPreview();
        };
        const sheetJourney = async (width, name) => {
          await page.ab("set", "viewport", String(width), "844");
          if (
            width > 849 &&
            (await page.evaluate("!!document.querySelector('[aria-label=\"Show sidebar\"]')"))
          )
            await page.click("button", "Show sidebar");
          if (width > 849) {
            const sessionWidth = await page.evaluate(
              "document.querySelector('[data-slot=layout-view]').getBoundingClientRect().width",
            );
            assert.ok(
              sessionWidth > 0 && sessionWidth < 849,
              `wide viewport's session is single-area: ${sessionWidth}`,
            );
            observations.push({ singleArea: name, viewport: width, sessionWidth });
          }
          await openPreviewPane();
          await page.until(
            "document.querySelector('[role=dialog]').textContent.includes('Running')",
          );
          await page.see(new URL(app.url).hostname);
          await page.capture(`2b-${name}-preview-pane`);
          await page.click("button", "Back");
          await page.until("!!document.querySelector('[role=dialog] button[aria-label=Preview]')");
          assert.equal(
            await page.evaluate("window.previewSheet === document.querySelector('[role=dialog]')"),
            true,
          );
          await page.capture(`2b-${name}-back`);
          await page.click("button", "Preview");
          await page.click("button", "Preview details");
          await detailsReady();
          await page.until(
            "!document.querySelector('[role=dialog] button[aria-label=Back]') && document.querySelectorAll('[role=dialog]').length === 1",
          );
          await refreshDetails();
          await page.capture(`2b-${name}-details`);
          await page.press("Escape");
          await dialogClosed();
          await openPreviewPane();
          await page.click("link", "Open preview in new tab");
          await externalAnswer(`2b-${name}-external-answer`, "Preview journey v2 HMR");
          await dialogClosed();
          await openPreviewPane();
          await page.click("button", "Stop preview");
          await page.see("Stop preview?");
          await page.until("!document.querySelector('[role=dialog] button[aria-label=Back]')");
          await page.capture(`2b-${name}-stop-confirmation`);
          await page.click("button", "Cancel");
          await dialogClosed();
          assert.equal(request({ action: "status" }).instanceId, identity);
          await noEmbeddedPreview();
        };

        // An unreadable scratch intent is an observation/stop error, not absence. The service
        // still belongs to its live owner. Restore the external boundary before any cleanup.
        const intentPath = join(state, first.serviceId + ".json");
        const intent = readFileSync(intentPath, "utf8");
        try {
          writeFileSync(intentPath, "unreadable scratch intent");
          await more();
          await page.click("menuitem", "Preview details");
          await page.see("Status unavailable");
          await noEmbeddedPreview();
          await page.until("!document.querySelector('[role=dialog] a[target=_blank]')");
          await refreshDetails();
          await page.capture("1h-unknown-details");
          await page.press("Escape");
          await dialogClosed();
          await page.capture("1h-status-refresh");
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
        await more();
        await page.click("menuitem", "Preview details");
        await refreshDetails();
        await page.press("Escape");
        await dialogClosed();
        await page.until(`!!document.querySelector(${JSON.stringify(headerLink)})`);

        // Another session in this same checkout cannot discover or adopt the owner's app.
        await page.open("/new");
        await noEmbeddedPreview();
        await page.ab("fill", '[aria-label="First message"]', "status");
        await page.until("document.querySelector('[aria-label=Send]')?.disabled === false");
        await page.click("button", "Send");
        await page.see("PREVIEW_READY");
        // The transcript can link the workspace app; it is still not this session's live row.
        assert.equal(await railPreview(), false);
        assert.equal(
          await page.evaluate(`!!document.querySelector(${JSON.stringify(headerLink)})`),
          false,
        );
        await page.capture("1i-non-owning-session");
        const otherSessionPath = new URL(await page.ab("get", "url")).pathname;
        // Select through the sidebar, then use browser Back while the pane is open. This is
        // same-document navigation: a full reload would discard the claim rather than fence it.
        const ownerRow = `li[data-session-key*=${JSON.stringify(sessionPath.split("/").at(-1))}] > button`;
        await page.until(`!!document.querySelector(${JSON.stringify(ownerRow)})`);
        await page.ab("click", ownerRow);
        await page.until(`location.pathname === ${JSON.stringify(sessionPath)}`);
        await page.ab("set", "viewport", "1000", "844");
        await openPreviewPane();
        await page.ab("back");
        await page.until(`location.pathname === ${JSON.stringify(otherSessionPath)}`);
        await paneUnavailable();
        await page.capture("1i-selection-fences-preview-pane");
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.click("button", "Back");
        await page.until("!document.querySelector('[role=dialog] button[aria-label=Preview]')");
        await page.press("Escape");
        await dialogClosed();
        await page.ab("click", ownerRow);
        await page.until(`location.pathname === ${JSON.stringify(sessionPath)}`);
        await page.ab("set", "viewport", "1280", "900");
        await showRail();
        app = first;

        // Keep the external app tab alive while the ordinary composer deterministically edits
        // its source. The counter proves HMR, rather than a fresh navigation to revised output.
        const pianoUrl = await page.ab("get", "url");
        const pianoTarget = await page.cdp(async (call) => {
          const { targetInfos } = await call("Target.getTargets");
          return targetInfos.find((target) => target.type === "page" && target.url === pianoUrl)
            .targetId;
        });
        await page.ab("tab", "new", externalLocal ? app.url : `http://127.0.0.1:${app.port}/`);
        await page.see("Preview journey v1");
        await page.click("button", "Count: 0");
        await page.capture("2-app-load");
        await page.ab("tab", pianoTarget);
        const appTarget = await page.cdp(async (call) => {
          const { targetInfos } = await call("Target.getTargets");
          return targetInfos.find(
            (target) => target.type === "page" && new URL(target.url).port === String(app.port),
          ).targetId;
        });
        await page.ab("fill", '[aria-label="Message"]', "Revise the app heading");
        await page.click("button", "Send");
        await page.see("APP_UPDATED");
        await page.ab("tab", appTarget);
        await page.see("Preview journey v2 HMR");
        await page.see("Count: 1");
        await page.capture("3-external-hot-reload");
        await page.ab("tab", "close");
        observations.push({ externalHmr: true, openedObservedUrl: externalLocal });
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
        await showRail();
        assert.equal(request({ action: "status" }).instanceId, identity);
        await page.capture("2b-reload-same-preview");
        await sheetJourney(1000, "wide-single-area");
        await sheetJourney(390, "narrow");
        await openPreviewPane();
        await page.click("button", "Stop preview");
        await page.see("Stop preview?");
        await page.click("button", "Stop preview");
        await page.see("Preview stopped");
        await gone(first, "confirmed Stop preview from narrow sheet");
        await dialogClosed();
        await noEmbeddedPreview();
        await page.until(`!document.querySelector(${JSON.stringify(headerLink)})`);
        await page.capture("2b-narrow-stopped");
        await page.until("!document.querySelector('[data-sonner-toast]')");
        await page.ab("set", "viewport", "1280", "900");
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
          // A reopened page may restore its saved draft over an early fill; fill until it holds.
          for (let i = 0; ; i++) {
            await page.ab("fill", '[aria-label="Message"]', "Run again");
            if (
              await page.evaluate("document.querySelector('[aria-label=Send]')?.disabled === false")
            )
              break;
            assert.ok(i < 50, "the composer accepts the message");
            await delay(100);
          }
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
        await showRail();
        await more();
        await page.click("menuitem", "Stop preview");
        await page.see("Stop preview?");
        // A concurrent owner request replaces the app while confirmation is open. Its 503
        // keeps readiness pending: neither the old confirmation nor a stale URL may act on it.
        writeFileSync(browserMode, "warming");
        let replacementSettled = false;
        const pendingReplacement = requestLater(
          {
            action: "start",
            replace: replacing.instanceId,
            command,
            env: appEnv,
            timeoutSeconds: 30,
          },
          replacing,
        ).finally(() => {
          replacementSettled = true;
        });
        await page.until(
          "[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Stop preview')?.disabled === true",
        );
        await page.until(
          "document.querySelector('[data-slot=session-rail]')?.textContent.includes('Starting')",
        );
        await page.until(
          `!document.querySelector(${JSON.stringify(headerLink + ", " + railLink)})`,
        );
        await noEmbeddedPreview();
        assert.equal(replacementSettled, false, "replacement still waits for readiness");
        await page.capture("3a-replacement-starting-unready");
        writeFileSync(browserMode, "normal");
        let replacement = await pendingReplacement;
        replacement.testPids = JSON.parse(readFileSync(join(repo, "app-processes.json"), "utf8"));
        assert.equal(replacement.ready, true);
        assert.notEqual(replacement.instanceId, replacing.instanceId);
        await page.capture("3a-replacement-fences-confirmation");
        assert.equal(request({ action: "status" }).instanceId, replacement.instanceId);
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Stop preview')?.disabled",
          ),
          true,
          "stale confirmation stays fenced after replacement is ready",
        );
        await page.click("button", "Cancel");
        await dialogClosed();
        observations.push({
          replacement: replacement.instanceId,
          replaced: replacing.instanceId,
          ports: [replacing.port, replacement.port],
        });

        // The pushed pane has its own exact-instance fence, not just the stop confirmation's.
        await page.ab("set", "viewport", "390", "844");
        await openPreviewPane();
        const paneOld = replacement;
        writeFileSync(browserMode, "warming");
        let paneReplacementSettled = false;
        const pendingPaneReplacement = requestLater(
          {
            action: "start",
            replace: paneOld.instanceId,
            command,
            env: appEnv,
            timeoutSeconds: 30,
          },
          paneOld,
        ).finally(() => {
          paneReplacementSettled = true;
        });
        await paneUnavailable();
        await page.until(`!document.querySelector(${JSON.stringify(headerLink)})`);
        assert.equal(paneReplacementSettled, false);
        await page.capture("3b-pane-replacement-unavailable");
        writeFileSync(browserMode, "normal");
        replacement = await pendingPaneReplacement;
        replacement.testPids = JSON.parse(readFileSync(join(repo, "app-processes.json"), "utf8"));
        assert.equal(replacement.ready, true);
        assert.notEqual(replacement.instanceId, paneOld.instanceId);
        await paneUnavailable();
        await page.capture("3b-pane-stays-fenced-after-ready");
        assert.equal(request({ action: "status" }).instanceId, replacement.instanceId);
        await page.click("button", "Back");
        await page.click("button", "Preview");
        await page.until("document.querySelector('[role=dialog]').textContent.includes('Running')");
        await page.capture("3b-pane-explicitly-observes-replacement");
        await page.press("Escape");
        await dialogClosed();
        await page.ab("set", "viewport", "1280", "900");
        await showRail();
        observations.push({
          replacement: replacement.instanceId,
          replaced: paneOld.instanceId,
          paneFenced: true,
        });
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
        await noEmbeddedPreview();
        await page.until(`!document.querySelector(${JSON.stringify(headerLink)})`);
        await page.capture("3c-failed-preview");
        await more();
        await page.click("menuitem", "Preview details");
        await refreshDetails();
        await page.capture("3d-failed-details");
        await page.press("Escape");
        await dialogClosed();
        await more();
        await page.click("menuitem", "Stop preview");
        await page.click("button", "Stop preview");
        await page.see("Preview stopped");
        await dialogClosed();
        await noEmbeddedPreview();
        await page.capture("3e-desktop-stopped");
        await page.click("button", "Stop");
        held?.end();
        const ended = await launch();
        await page.ab("set", "viewport", "390", "844");
        await openPreviewPane();
        process.kill(piFor(ended).pid, "SIGKILL");
        await gone(ended, "owner exit while Preview pane stays open");
        await paneUnavailable();
        await page.until(`!document.querySelector(${JSON.stringify(headerLink)})`);
        await page.capture("3f-owner-ended-open-pane");
        await page.click("button", "Back");
        await page.until("!document.querySelector('[role=dialog] button[aria-label=Preview]')");
        await page.press("Escape");
        await dialogClosed();
        await page.ab("set", "viewport", "1280", "900");
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
