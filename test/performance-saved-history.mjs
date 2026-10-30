/** Opt-in CPU/latency evidence, not a wall-clock CI gate. Run uncontended with Node 24. */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime } from "effect";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { largeHistory } from "./fixtures/large-history.ts";

const output = resolve(process.argv[2] ?? ".scratch/saved-history.json");
const root = mkdtempSync(join(tmpdir(), "piano-history-benchmark-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
const runtime = ManagedRuntime.make(PiSessionsLive.pipe(Layer.provide(NodeServices.layer)));
try {
  const file = join(root, "history.jsonl");
  largeHistory(file, "benchmark", root);
  const history = await runtime.runPromise(Effect.map(PiSessions, (s) => s.history));
  const measure = async (readers) => {
    let ticks = 0;
    let last = performance.now();
    let maxGapMs = 0;
    const tick = () => {
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, now - last);
      last = now;
      ticks++;
    };
    const timer = setInterval(tick, 1);
    const cpu = process.cpuUsage();
    const thread = process.threadCpuUsage();
    const start = performance.now();
    try {
      const snapshots = await Promise.all(
        Array.from({ length: readers }, () => runtime.runPromise(history.peek("benchmark", file))),
      );
      const latencyMs = performance.now() - start;
      const total = process.cpuUsage(cpu);
      const main = process.threadCpuUsage(thread);
      tick();
      if (
        snapshots.some(
          (s) => s.messages.length !== 1 || s.messages[0].text !== "tiny active branch",
        )
      )
        throw new Error("Fixture did not project its tiny active context");
      return {
        readers,
        latencyMs,
        mainCpuMs: (main.user + main.system) / 1000,
        totalCpuMs: (total.user + total.system) / 1000,
        timerTicksDuringRead: ticks - 1,
        maxTimerGapMs: maxGapMs,
      };
    } finally {
      clearInterval(timer);
    }
  };
  const cold = await measure(1);
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push(await measure(1));
  const concurrent = await measure(16);
  const result = {
    node: process.version,
    platform: process.platform,
    bytes: statSync(file).size,
    cold,
    warm,
    concurrent,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await runtime.dispose();
  rmSync(root, { recursive: true, force: true });
}
