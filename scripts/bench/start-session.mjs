// Credential-free real Pi startup benchmark. Run: node scripts/bench/start-session.mjs /tmp/start-bench
// BENCH_FAKE=1 selects the browser fixture; BENCH_SAMPLES defaults to 10.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../../test/browser/harness.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const fake = process.env.BENCH_FAKE === "1";
const scratch = mkdtempSync(join(tmpdir(), "piano-bench-cli-"));
const shim = join(scratch, "cli.mjs");
// Keep only scratch configuration and this child's Piano capabilities, never provider credentials.
writeFileSync(
  shim,
  `const keep = /^(PATH|HOME|TMPDIR|XDG_.*|PI_CODING_AGENT_.*|PIANO_.*|PI_OFFLINE|NODE_COMPILE_CACHE|NODE_DISABLE_COMPILE_CACHE)$/;
for (const key of Object.keys(process.env)) if (!keep.test(key)) delete process.env[key];
await import(${JSON.stringify(join(root, "server/PiRpcCli.ts"))});\n`,
);
const modelTools = new Set();
let modelCalls = 0;
const model = createServer(async (req, res) => {
  let input = "";
  for await (const part of req) input += part;
  const body = JSON.parse(input);
  modelCalls++;
  for (const tool of body.tools ?? []) modelTools.add(tool.function.name);
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [delta, finish_reason] of [
    [{ role: "assistant", content: "BENCH_OK" }, null],
    [{}, "stop"],
  ])
    res.write(
      `data: ${JSON.stringify({ id: "bench", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  res.end("data: [DONE]\n\n");
});
await new Promise((done) => model.listen(0, "127.0.0.1", done));
const samples = [];
const evidence = resolve(process.argv[2] ?? ".scratch/browser/start-latency");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const provenance = {
  revision: git("rev-parse", "HEAD"),
  trackedDiffSha256: createHash("sha256").update(git("diff", "HEAD")).digest("hex"),
  benchmarkSha256: createHash("sha256")
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .digest("hex"),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  pi: JSON.parse(
    readFileSync(join(root, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8"),
  ).version,
  fake,
  offline: true,
  compileCache: "fresh isolated directory per run; composer probe can warm it",
  disabledCache: process.env.NODE_DISABLE_COMPILE_CACHE === "1",
};
try {
  await run(
    "start-latency",
    ({ repository, root: fixture }) => {
      if (!fake) {
        writeFileSync(
          join(fixture, "agent/models.json"),
          JSON.stringify({
            providers: {
              benchmark: {
                baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
                api: "openai-completions",
                apiKey: "dummy",
                models: [
                  {
                    id: "local",
                    name: "Benchmark",
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
          join(fixture, "agent/settings.json"),
          JSON.stringify({ defaultProvider: "benchmark", defaultModel: "local" }),
        );
      }
      return { folders: [repository("bench")] };
    },
    async (page) => {
      for (let i = 0; i < Number(process.env.BENCH_SAMPLES ?? 10); i++) {
        await page.open("/new");
        if (i === 0) await page.choose("Directory", "bench");
        await page.until("!document.querySelector('[aria-label^=\"Model:\"]')?.disabled");
        await page.ab("fill", '[aria-label="First message"]', "Reply with exactly: BENCH_OK");
        await page.evaluate(`(() => {
    window.bench={};
    document.addEventListener('click',e=>{if(e.target.closest('[aria-label="Send"]')) window.bench.click=performance.now()},true);
    const original=WebSocket.prototype.send;
    WebSocket.prototype.send=function(data){
     const msg=JSON.parse(data);
     if(msg._tag==='create_session'){
      window.bench.send=performance.now(); window.bench.sendEpoch=Date.now();
      this.addEventListener('message',e=>{
       const message=JSON.parse(e.data);
       if(message._tag==='session' && message.event?._tag==='state' && message.event.state.isStreaming && window.bench.processing===undefined) window.bench.processing=performance.now();
      });
     }
     return original.call(this,data);
    };
   })()`);
        await page.click("button", "Send");
        if (fake) await page.see("echo: Reply with exactly: BENCH_OK");
        else
          await page.until(
            `[...document.querySelectorAll('[data-slot="transcript"] p')].some(p => p.textContent === 'BENCH_OK')`,
          );
        await page.until("window.bench.processing !== undefined");
        const b = await page.evaluate("window.bench");
        assert.ok(Number.isFinite(b.processing));
        const sample = {
          sample: i,
          clickToProcessingMs: b.processing - b.click,
          sendToProcessingMs: b.processing - b.send,
          ...b,
        };
        samples.push(sample);
        console.log(JSON.stringify(sample));
      }
      if (!fake) {
        assert.equal(modelCalls, samples.length);
        for (const name of ["piano_start_session", "ask_user", "piano_save_skill"])
          assert.ok(modelTools.has(name), `Pi loaded ${name}`);
      }
      writeFileSync(
        join(page.evidence, "samples.json"),
        JSON.stringify({ fake, node: process.version, samples }, null, 2),
      );
    },
    {
      backendEnv: {
        PIANO_DEBUG: "1",
        TMPDIR: scratch,
        NODE_COMPILE_CACHE: undefined,
        ...(!fake ? { PIANO_PI_CLI: shim } : {}),
      },
    },
  );
  const records = readFileSync(join(evidence, "backend.log"), "utf8")
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/\[PiTransport\] (\d+) (.*)/);
      return match ? [{ at: Number(match[1]), label: match[2] }] : [];
    });
  const probeSpawn = records.find((r) => r.label.startsWith("spawning"));
  const probeReady = records.find((r) => r.label === "record response get_available_models");
  const coldProbeReadyMs = probeReady.at - probeSpawn.at;
  const stages = samples.map((s, i) => {
    const window = records.filter(
      (r) => r.at >= s.sendEpoch && r.at < (samples[i + 1]?.sendEpoch ?? Infinity),
    );
    const at = (pattern) => {
      const r = window.find((r) => pattern.test(r.label));
      assert.ok(r, `missing ${pattern}`);
      return r.at;
    };
    const spawn = at(/^spawning/),
      ready = at(/^record response get_state/),
      prompt = at(/^request \S+ prompt$/),
      start = at(/^record agent_start/);
    return {
      sample: i,
      sendToSpawnMs: spawn - s.sendEpoch,
      spawnToReadyMs: ready - spawn,
      readyToPromptMs: prompt - ready,
      promptToAgentStartMs: start - prompt,
      sendToAgentStartMs: start - s.sendEpoch,
      agentStartToBrowserMs: s.sendEpoch + s.sendToProcessingMs - start,
    };
  });
  const distribution = (values) => {
    const sorted = values.toSorted((a, b) => a - b);
    return {
      min: sorted[0],
      median:
        sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
      p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
      max: sorted.at(-1),
    };
  };
  const summary = {
    clickToBrowserMs: distribution(samples.map((s) => s.clickToProcessingMs)),
    ...Object.fromEntries(
      Object.keys(stages[0])
        .filter((k) => k !== "sample")
        .map((key) => [key, distribution(stages.map((s) => s[key]))]),
    ),
  };
  writeFileSync(
    join(evidence, "benchmark.json"),
    JSON.stringify(
      { provenance, coldProbeReadyMs, modelCalls, modelTools: [...modelTools], stages, summary },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  model.closeAllConnections();
  await new Promise((done) => model.close(done));
  rmSync(scratch, { recursive: true, force: true });
}
