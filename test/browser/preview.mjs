// Opt-in Linux/systemd critical path. Real installed Pi + scripted loopback model (no credentials).
// node test/browser/preview.mjs [evidence-directory]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const evidence = resolve(process.argv[2] ?? ".scratch/browser/preview");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "piano-preview-model-"));
const config = join(scratch, "config.json");
const state = join(scratch, "state");
writeFileSync(
  config,
  JSON.stringify({
    origin: "https://yejun-dev.exe.xyz",
    ports: Array.from({ length: 80 }, (_, i) => 9400 + i),
  }),
);
const command = [
  process.execPath,
  join(ROOT, "node_modules/vite/bin/vite.js"),
  "--host",
  "127.0.0.1",
  "--port",
  "{port}",
  "--strictPort",
];
const observations = [];
let app;
let held;
let repo;
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
                : {
                    action: "start",
                    command,
                    env: { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "yejun-dev.exe.xyz" },
                  },
            ),
          },
        },
      ],
    };
  } else {
    app = JSON.parse(tool.content);
    observations.push(app);
    delta = {
      role: "assistant",
      content: app.ready
        ? `PREVIEW_READY: [Open preview](${app.url})\nInstance ${app.instanceId}`
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
const keep = new Set(['PATH','HOME','PI_CODING_AGENT_DIR','PI_CODING_AGENT_SESSION_DIR','PIANO_SESSION_WS_URL','PIANO_SESSION_ORIGIN','PIANO_PREVIEW_CONFIG','PIANO_PREVIEW_STATE']);
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
      writeFileSync(join(repo, "index.html"), "<h1>Preview journey v1</h1>");
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
        await page.click("button", "Send");
        await page.see("PREVIEW_READY");
        await page.until(
          "!!document.querySelector('[aria-label=Message]') && !document.querySelector('[aria-label=Stop]')",
        );
        assert.equal(app.workspace, repo);
        const identity = app.instanceId;
        await page.capture("1-settled-preview-link");
        const link = await page.evaluate(
          "[...document.querySelectorAll('a')].find(a => a.textContent === 'Open preview')?.outerHTML",
        );
        assert.ok(link.includes(app.url), link);
        assert.ok(link.includes('target="_blank"'), link);

        // External exe.dev login is intentionally not bypassed: local browser load is a separate claim.
        await page.ab("tab", "new", `http://127.0.0.1:${app.port}/`);
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
        await page.restartBackend(); // releases real Pi, then starts a new isolated Piano on the same DB
        const status = request({ action: "status" });
        assert.equal(status.instanceId, identity);
        assert.equal(status.invocation, app.invocation);
        assert.equal(status.ready, true);
        observations.push({
          after: "settlement, abort, browser disconnect, Pi release, Piano restart",
          ...status,
        });
        assert.equal(
          request({
            action: "start",
            command,
            env: { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "yejun-dev.exe.xyz" },
          }).instanceId,
          identity,
        );
        await page.open("/new");
        await page.capture("4-scratch-piano-restarted");
      } finally {
        // Clean up even when a launch succeeded but its reply never reached the scripted model.
        for (const file of existsSync(state)
          ? readdirSync(state).filter((file) => file.endsWith(".json"))
          : []) {
          const record = JSON.parse(readFileSync(join(state, file), "utf8"));
          assert.equal(record.workspace, repo);
          observations.push(request({ action: "stop", instanceId: record.instanceId }));
          assert.equal(request({ action: "stop", instanceId: record.instanceId }).stopped, false);
        }
        writeFileSync(join(evidence, "observations.json"), JSON.stringify(observations, null, 2));
      }
    },
    {
      backendEnv: {
        ...env,
        PIANO_PI_CLI: shim,
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
