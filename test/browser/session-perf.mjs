// Opt-in diagnostic, not a timing gate. See docs/session-performance.md.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { run } from "./harness.mjs";

const sizes = (process.env.PERF_SIZES ?? "100,500,1000").split(",").map(Number);
const repeats = Number(process.env.PERF_REPEATS ?? 3);
assert.ok(sizes.every((n) => Number.isInteger(n) && n > 0 && n % 2 === 0));
assert.ok(Number.isInteger(repeats) && repeats > 0);
const evidence = resolve(process.argv[2] ?? ".scratch/browser/session-perf");
mkdirSync(evidence, { recursive: true });
const cases = ["short", "long"].flatMap((shape) => sizes.map((n) => ({ shape, n })));
const timestamp = 1700000000000;
const usage = {
  input: 1000,
  output: 250,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1250,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const paragraph =
  "A deterministic paragraph with **bold text**, `inline code`, and a [public link](https://example.com). The session keeps its history while the reader scrolls.\n\n";
const body = (shape, i) =>
  `Message ${i}.\n\n${shape === "short" ? "A short synthetic reply." : paragraph.repeat(12) + "```js\nconst answer = 42;\nconsole.log(answer);\n```"}`;
const results = [];
const report = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model,
    cpus: cpus().length,
  },
  sizes,
  repeats,
  results,
};
const save = () => writeFileSync(`${evidence}/results.json`, JSON.stringify(report, null, 2));

// A fresh browser and backend per sample prevents previous transcripts/GC from biasing it.
for (let repeat = 0; repeat < repeats; repeat++)
  for (const { shape, n } of cases)
    await run(
      "session-perf",
      ({ repository, history }) => {
        const cwd = repository("perf");
        const sessions = [{ shape, n }].map(({ shape, n }) => {
          const sessionId = `perf-${shape}-${n}`;
          const messages = Array.from({ length: n }, (_, i) =>
            i % 2 === 0
              ? { role: "user", content: body(shape, i), timestamp }
              : {
                  role: "assistant",
                  content: [{ type: "text", text: body(shape, i) }],
                  api: "fake",
                  provider: "fake",
                  model: "alpha",
                  usage,
                  stopReason: "stop",
                  timestamp,
                },
          );
          history({ sessionId, cwd, messages });
          return {
            sessionId,
            title: sessionId,
            cwd,
            createdAt: new Date(timestamp).toISOString(),
            updatedAt: new Date(timestamp).toISOString(),
          };
        });
        return { folders: [cwd], sessions };
      },
      async (page) => {
        await page.open("/"); // Warm Vite's module transforms, not the measured page's HTTP cache.
        const socket = new WebSocket(await page.ab("get", "cdp-url"));
        await new Promise((done, fail) => {
          socket.addEventListener("open", done, { once: true });
          socket.addEventListener("error", fail, { once: true });
        });
        let id = 0;
        const call = (method, params = {}, sessionId) =>
          new Promise((done, fail) => {
            const requestId = ++id;
            const timer = setTimeout(() => {
              socket.removeEventListener("message", receive);
              fail(new Error(`CDP timeout: ${method}`));
            }, 120000);
            const receive = ({ data }) => {
              const message = JSON.parse(data);
              if (message.id !== requestId) return;
              clearTimeout(timer);
              socket.removeEventListener("message", receive);
              if (message.error) fail(new Error(JSON.stringify(message.error)));
              else done(message.result);
            };
            socket.addEventListener("message", receive);
            socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
          });
        try {
          report.browser = await call("Browser.getVersion");
          const { targetInfos } = await call("Target.getTargets");
          const target = targetInfos.find(
            (t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:"),
          );
          assert.ok(target);
          const origin = new URL(target.url).origin;
          const { sessionId } = await call("Target.attachToTarget", {
            targetId: target.targetId,
            flatten: true,
          });
          const cdp = (method, params) => call(method, params, sessionId);
          const evaluate = async (expression) => {
            const result = await cdp("Runtime.evaluate", {
              expression,
              awaitPromise: true,
              returnByValue: true,
            });
            assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            return result.result.value;
          };
          await cdp("Page.enable");
          await cdp("Network.enable");
          await cdp("Network.setCacheDisabled", { cacheDisabled: true });
          await cdp("Page.addScriptToEvaluateOnNewDocument", {
            source: `
      window.perfTasks = [];
      new PerformanceObserver(list => window.perfTasks.push(...list.getEntries().map(e => ({start: e.startTime, duration: e.duration})))).observe({type: 'longtask', buffered: true});
      const n = Number(location.pathname.split('-').at(-1));
      function ready() {
        const rows = document.querySelectorAll('[data-slot="transcript"] article[id]');
        const composer = document.querySelector('[aria-label="Message"]');
        if (rows.length === n && composer && !composer.disabled) {
          requestAnimationFrame(() => requestAnimationFrame(() => { window.perfReady = performance.now(); }));
        } else requestAnimationFrame(ready);
      }
      requestAnimationFrame(ready);
    `,
          });
          {
            await cdp("Page.navigate", { url: "about:blank" });
            await page.until("location.href === 'about:blank'");
            await cdp("HeapProfiler.collectGarbage");
            await cdp("Page.navigate", { url: `${origin}/s/perf-${shape}-${n}` });
            await page.until("window.perfReady > 0");
            const opening = await evaluate(
              `({ readyMs: window.perfReady, fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, longTasks: window.perfTasks.filter(t => t.start < window.perfReady), articles: document.querySelectorAll('[data-slot="transcript"] article[id]').length, nodes: document.querySelectorAll('*').length })`,
            );
            assert.equal(opening.articles, n);
            const memory = await cdp("Runtime.getHeapUsage"); // No forced GC; not a retained-heap/leak claim.
            const scroll = await evaluate(`new Promise(resolve => {
        const el = document.querySelector('[data-slot="transcript"]');
        el.scrollTop = 0;
        const frames = []; let start, last;
        function tick(now) {
          start ??= now;
          if (last !== undefined) frames.push(now - last);
          last = now;
          el.scrollTop = (el.scrollHeight - el.clientHeight) * Math.min(1, (now - start) / 2000);
          if (now - start < 2000) requestAnimationFrame(tick);
          else requestAnimationFrame(() => resolve({ frames, height: el.scrollHeight, bottomGap: el.scrollHeight - el.clientHeight - el.scrollTop }));
        }
        requestAnimationFrame(tick);
      })`);
            assert.ok(Math.abs(scroll.bottomGap) < 2);
            // Measure the actual button click, not npx command startup; the fake Pi adds a user/reply pair.
            await page.ab("fill", '[aria-label="Message"]', `perf-append-${repeat}`);
            await evaluate(`(() => {
        const button = document.querySelector('[aria-label="Send"]');
        if (!button) throw new Error('Send control missing');
        button.addEventListener('click', () => {
          window.perfAppendStart = performance.now();
          function check() {
            if ([...document.querySelectorAll('[data-slot="transcript"] article')].some(a => a.textContent.includes('echo: perf-append-${repeat}'))) {
              requestAnimationFrame(() => requestAnimationFrame(() => { window.perfAppendMs = performance.now() - window.perfAppendStart; }));
            } else requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        }, {once: true});
      })()`);
            await page.click("button", "Send");
            await page.until("window.perfAppendMs > 0");
            const appendMs = await evaluate("window.perfAppendMs");
            await cdp("HeapProfiler.collectGarbage");
            const retained = await cdp("Runtime.getHeapUsage");
            const sorted = [...scroll.frames].sort((a, b) => a - b);
            const result = {
              shape,
              n,
              repeat,
              ...opening,
              heapMiB: memory.usedSize / 2 ** 20,
              retainedAfterAppendMiB: retained.usedSize / 2 ** 20,
              scroll: {
                height: scroll.height,
                frames: scroll.frames.length,
                p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
                maxMs: sorted.at(-1),
                over33ms: sorted.filter((x) => x > 33.4).length,
              },
              appendMs,
            };
            results.push(result);
            save();
            console.log(JSON.stringify(result));
            if (repeat === 0) await page.capture(`${shape}-${n}`);
          }
        } finally {
          socket.close();
          save();
        }
      },
      { agentBrowser: "agent-browser@0.38.1" },
    );
