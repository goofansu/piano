// Loaded only by performance-folder-registry.mjs in its scratch backend.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

// Synthetic metadata latency, scoped to the scratch listing only. Not a claim about NFS.
const slowPath = process.env.PIANO_BENCH_SLOW_PATH;
const pause = new Int32Array(new SharedArrayBuffer(4));
if (slowPath) {
  for (const name of ['statSync', 'existsSync', 'readdirSync']) {
    const original = fs[name];
    fs[name] = (...args) => {
      if (String(args[0]).startsWith(slowPath)) Atomics.wait(pause, 0, 0, 1);
      return original(...args);
    };
  }
  for (const name of ['stat', 'access', 'readdir']) {
    const original = promises[name];
    promises[name] = async (...args) => {
      if (String(args[0]).startsWith(slowPath)) await sleep(1);
      return original(...args);
    };
  }
  syncBuiltinESMExports();
}

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
process.on('message', message => {
  if (message === 'reset') {
    delay.reset();
    process.send({ reset: true });
  } else if (message === 'measure') {
    process.send({ eventLoopMs: {
      p50: delay.percentile(50) / 1e6,
      p95: delay.percentile(95) / 1e6,
      p99: delay.percentile(99) / 1e6,
      max: delay.max / 1e6,
    } });
  }
});
