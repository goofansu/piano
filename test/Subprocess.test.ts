import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { run, runAsync, SubprocessError } from "../server/Subprocess.ts";

const node = (script: string, options: Partial<Parameters<typeof run>[0]> = {}) =>
  Effect.runPromise(
    run({ command: process.execPath, args: ["-e", script], ...options }).pipe(Effect.result),
  );
const failed = (result: Awaited<ReturnType<typeof node>>) => {
  assert.equal(result._tag, "Failure");
  if (result._tag !== "Failure") throw new Error("expected failure");
  assert.ok(result.failure instanceof SubprocessError);
  return result.failure;
};

// Real children record readiness/PIDs so deadlines exercise installed signal handlers.
async function stubborn(reason: "timeout" | "limit" | "aborted", group = false) {
  const directory = await mkdtemp(join(tmpdir(), "piano-subprocess-"));
  const ready = join(directory, "ready");
  const controller = new AbortController();
  let pid: number | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const script = `
      process.on('SIGTERM', () => {});
      require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid));
      ${reason === "limit" ? "process.stdout.write('x'.repeat(100000));" : ""}
      setInterval(() => {}, 1000);
    `;
    const pending = runAsync(
      {
        command: process.execPath,
        args: ["-e", script],
        group,
        limit: 1000,
        ...(reason === "timeout" ? { timeout: 1000 } : {}),
      },
      controller.signal,
    );
    // Attach rejection handling immediately, including before readiness is observed.
    const outcome = pending.catch((error) => error);
    for (let i = 0; i < 200; i++) {
      const value = await readFile(ready, "utf8").catch(() => "");
      if (value) {
        pid = Number(value);
        break;
      }
      await delay(10);
    }
    assert.ok(pid, "child became ready");
    if (reason === "aborted") controller.abort();
    const result = await Promise.race([
      outcome,
      new Promise((resolve) => {
        watchdog = setTimeout(() => resolve("still pending"), 2500);
      }),
    ]);
    assert.ok(result instanceof SubprocessError, `bounded settlement: ${result}`);
    assert.equal(result.reason, reason);
    const childPid = pid;
    assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  } finally {
    clearTimeout(watchdog);
    if (pid) {
      try {
        process.kill(group ? -pid : pid, "SIGKILL");
      } catch {
        /* exited */
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}

for (const reason of ["timeout", "limit", "aborted"] as const) {
  test(`uncooperative direct child: ${reason} settles and reaps`, () => stubborn(reason));
}
test("uncooperative process group: cancellation settles and reaps", () =>
  stubborn("aborted", true));

for (const group of [false, true]) {
  test(`descendant outlives leader: ${group ? "group cleanup" : "inherited pipes"} is bounded`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "piano-subprocess-tree-"));
    const ready = join(directory, "ready");
    const controller = new AbortController();
    let pids: number[] = [];
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const descendant = `process.on('SIGTERM', () => {});
        require('node:fs').writeFileSync(${JSON.stringify(ready)}, JSON.stringify([process.ppid, process.pid]));
        setInterval(() => {}, 1000);`;
      const leader = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' });
        process.on('SIGTERM', () => process.exit(0));`;
      const outcome = runAsync(
        { command: process.execPath, args: ["-e", leader], group },
        controller.signal,
      ).catch((error) => error);
      for (let i = 0; i < 200; i++) {
        const value = await readFile(ready, "utf8").catch(() => "");
        if (value) {
          pids = JSON.parse(value);
          break;
        }
        await delay(10);
      }
      assert.equal(pids.length, 2, "descendant became ready");
      controller.abort();
      const result = await Promise.race([
        outcome,
        new Promise((resolve) => {
          watchdog = setTimeout(() => resolve("still pending"), 2500);
        }),
      ]);
      assert.ok(result instanceof SubprocessError, `bounded settlement: ${result}`);
      assert.equal(result.reason, "aborted");
      assert.throws(() => process.kill(pids[0], 0), { code: "ESRCH" });
      if (group) {
        // Linux may retain a killed orphan as a zombie until PID 1 reaps it.
        let running = true;
        for (let i = 0; i < 100 && running; i++) {
          try {
            process.kill(pids[1], 0);
          } catch {
            running = false;
          }
          if (running && process.platform === "linux") {
            const stat = await readFile(`/proc/${pids[1]}/stat`, "utf8").catch(() => "");
            running = stat !== "" && !stat.includes(") Z ");
          }
          if (running) await delay(10);
        }
        assert.equal(running, false, "group descendant terminated");
      } else {
        // Direct-child mode deliberately does not claim ownership of descendants.
        process.kill(pids[1], 0);
      }
    } finally {
      clearTimeout(watchdog);
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* exited */
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("terminated runner releases inherited pipe handles so its host can exit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piano-subprocess-handles-"));
  const ready = join(directory, "ready");
  try {
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const leader = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' });`;
    const harness = `import { runAsync } from ${JSON.stringify(new URL("../server/Subprocess.ts", import.meta.url).href)};
      try { await runAsync({ command: process.execPath, args: ['-e', ${JSON.stringify(leader)}], timeout: 500 }); }
      catch (error) { if (error.reason !== 'timeout') throw error; console.log('settled'); }`;
    const result = await runAsync({
      command: process.execPath,
      args: ["--input-type=module", "-e", harness],
      timeout: 3000,
    });
    assert.equal(result.stdout.toString(), "settled\n");
  } finally {
    const pid = Number(await readFile(ready, "utf8").catch(() => ""));
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* exited */
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized output fails closed unless the caller asks for a truncated head", async () => {
  const script = "process.stdout.write('x'.repeat(100000))";
  assert.equal(failed(await node(script, { limit: 1000 })).reason, "limit");
  const head = await node(script, { limit: 1000, truncate: true });
  assert.equal(head._tag, "Success");
  if (head._tag === "Success") {
    assert.equal(head.success.stdout.length, 1000);
    assert.equal(head.success.truncated, true);
  }
});

test("only accepted exit codes succeed; a rejected exit reports stderr", async () => {
  const script = "process.stderr.write('fatal: nope\\n'); process.exit(1)";
  const rejected = failed(await node(script));
  assert.equal(rejected.reason, "exit");
  assert.equal(rejected.code, 1);
  assert.equal(rejected.message, "fatal: nope");
  const accepted = await node(script, { okCodes: [0, 1] });
  assert.equal(accepted._tag === "Success" && accepted.success.code, 1);
});

test("a child waiting on input sees closed stdin, and a hung child is killed at its timeout", async () => {
  const echoed = await node("process.stdin.pipe(process.stdout)", { input: "approve?" });
  assert.equal(echoed._tag === "Success" && echoed.success.stdout.toString(), "approve?");
  const started = Date.now();
  assert.equal(
    failed(await node("setInterval(() => {}, 1000)", { timeout: 200 })).reason,
    "timeout",
  );
  assert.ok(Date.now() - started < 5000);
});
