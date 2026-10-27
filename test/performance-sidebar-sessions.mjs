// Opt-in sidebar baseline, not a timing gate. Uses the real app and isolated browser harness.
// node test/performance-sidebar-sessions.mjs <evidence-directory> [100 500 1000 2000]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { run } from "./browser/harness.mjs";

const evidence = resolve(process.argv[2] ?? ".scratch/sidebar-performance");
process.argv[2] = evidence;
mkdirSync(evidence, { recursive: true });
const sizes = process.argv.slice(3).map(Number);
if (!sizes.length) sizes.push(100, 500, 1000, 2000);
assert.ok(sizes.every((n) => Number.isSafeInteger(n) && n > 0));
const report = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim(),
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    mode: "Vite development; 1280x900; no CPU/network throttling",
    agentBrowser: execFileSync("npx", ["agent-browser", "--version"], {
      encoding: "utf8",
    }).trim(),
  },
  results: [],
};
const rows = '[data-slot="session-sidebar"] li[data-row]';

// CDP is already exposed by agent-browser; no extra browser framework/dependency.
async function connect(page) {
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
        fail(new Error(`CDP ${method} timed out`));
      }, 30000);
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
    const { targetInfos } = await call("Target.getTargets");
    const target = targetInfos.find(
      (t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:"),
    );
    assert.ok(target, "scratch browser page exists");
    const { sessionId } = await call("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    return {
      call: (method, params) => call(method, params, sessionId),
      close: () => socket.close(),
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}

for (const n of sizes) {
  await run(
    `sidebar-${n}`,
    ({ repository, history }) => {
      const cwd = repository("sidebar-benchmark");
      const now = new Date().toISOString();
      const sessions = Array.from({ length: n }, (_, i) => {
        const sessionId = `sidebar-${String(i).padStart(6, "0")}`;
        history({ sessionId, cwd, messages: [] });
        return { sessionId, cwd, title: `Benchmark session ${i}`, createdAt: now, updatedAt: now };
      });
      return { folders: [cwd], sessions };
    },
    async (page) => {
      await page.open("/new");
      await page.until(`document.querySelectorAll('${rows}').length === ${n}`);
      const cdp = await connect(page);
      try {
        // Run before application code. No automation-process/CLI startup time in these clocks.
        await cdp.call("Page.enable");
        await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
          source: `(() => {
            window.sidebarBench = { longTasks: [] };
            new PerformanceObserver(list => {
              window.sidebarBench.longTasks.push(...list.getEntries().map(e => ({start: e.startTime, duration: e.duration})));
            }).observe({type: 'longtask', buffered: true});
            const observer = new MutationObserver(() => {
              if (document.querySelectorAll(${JSON.stringify(rows)}).length !== ${n}) return;
              observer.disconnect();
              window.sidebarBench.rowsCommittedMs = performance.now();
              requestAnimationFrame(() => requestAnimationFrame(() => {
                window.sidebarBench.readyMs = performance.now();
              }));
            });
            observer.observe(document, {childList: true, subtree: true});
          })()`,
        });
        const result = { n, navigation: [], reopen: [] };
        for (let repeat = 0; repeat < 3; repeat++) {
          if (repeat === 0) await cdp.call("Network.clearBrowserCache");
          await page.evaluate("window.sidebarBench && (window.sidebarBench.readyMs = 0)");
          await cdp.call("Page.reload");
          try {
            await page.until("window.sidebarBench?.readyMs > 0");
          } catch (error) {
            console.error(
              await page.evaluate(
                `({bench: window.sidebarBench, rows: document.querySelectorAll('${rows}').length, url: location.href})`,
              ),
            );
            throw error;
          }
          result.navigation.push(await page.evaluate("window.sidebarBench"));
          assert.equal(await page.evaluate(`document.querySelectorAll('${rows}').length`), n);
        }
        report.environment.browser = await page.evaluate("navigator.userAgent");
        // Default Date grouping: every fixture is Today. Closing must unmount all N rows.
        for (let repeat = 0; repeat < 3; repeat++) {
          await page.click("button", "Today");
          await page.until(`document.querySelectorAll('${rows}').length === 0`);
          await page.evaluate(`(() => {
            window.sidebarOpen = null;
            document.addEventListener('click', () => {
              const start = performance.now();
              const observer = new MutationObserver(() => {
                if (document.querySelectorAll('${rows}').length !== ${n}) return;
                observer.disconnect();
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  window.sidebarOpen = performance.now() - start;
                }));
              });
              observer.observe(document.querySelector('[data-slot="session-sidebar"]'), {childList: true, subtree: true});
            }, {once: true, capture: true});
            return true;
          })()`);
          await page.click("button", "Today");
          await page.until("window.sidebarOpen !== null");
          result.reopen.push(await page.evaluate("window.sidebarOpen"));
        }
        // Main-thread frame cadence during a deterministic scroll sweep, NOT compositor FPS
        // or wheel-to-pixel latency. Each frame advances 120px; enough to exercise new rows.
        result.scroll = [];
        for (let repeat = 0; repeat < 3; repeat++) {
          const scroll = await page.evaluate(`new Promise(resolve => {
          const viewport = document.querySelector('[data-slot="session-sidebar"] [data-radix-scroll-area-viewport]');
          const intervals = [];
          let last, start, direction = 1, travelled = 0;
          viewport.scrollTop = 0;
          function tick(now) {
            start ??= now;
            if (last !== undefined) intervals.push(now - last);
            last = now;
            const before = viewport.scrollTop;
            viewport.scrollTop += direction * 120;
            travelled += Math.abs(viewport.scrollTop - before);
            if (viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight) direction = -1;
            if (viewport.scrollTop <= 0) direction = 1;
            if (now - start < 3000) return requestAnimationFrame(tick);
            const sorted = [...intervals].sort((a,b) => a-b);
            resolve({ durationMs: now-start, frames: intervals.length,
              effectiveFps: intervals.length * 1000 / (now-start),
              p95Ms: sorted[Math.ceil(sorted.length * .95)-1], maxMs: Math.max(...intervals),
              over34Ms: intervals.filter(x => x > 34).length, travelledPx: travelled,
              scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight });
          }
          requestAnimationFrame(tick);
        })`);
          assert.ok(scroll.travelledPx > 0, "sidebar actually scrolled");
          result.scroll.push(scroll);
        }
        result.domRows = await page.evaluate(`document.querySelectorAll('${rows}').length`);
        assert.equal(result.domRows, n, "all rows stay mounted after scrolling");
        result.sidebarElements = await page.evaluate(
          "document.querySelector('[data-slot=\"session-sidebar\"]').querySelectorAll('*').length",
        );
        // Whole-page retained JS heap after explicit GC; not browser RSS or sidebar-only memory.
        await cdp.call("HeapProfiler.collectGarbage");
        result.heap = await cdp.call("Runtime.getHeapUsage");
        result.dom = await cdp.call("Memory.getDOMCounters");
        await page.capture(`sidebar-${n}`);
        assert.equal(page.prompts().length, 0, "no prompts sent");
        report.results.push(result);
        writeFileSync(`${evidence}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify(result));
      } finally {
        cdp.close();
      }
    },
    { backendEnv: { PI_OFFLINE: "1" } },
  );
}
