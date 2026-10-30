import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { outcomeFailed, type PreviewOutcome } from "../scripts/PreviewOutcome.ts";

const cases = [
  { name: "clean exit", script: "process.exit(0)", reason: "app-exit", exitCode: 0, status: 0 },
  { name: "exit 42", script: "process.exit(42)", reason: "app-exit", exitCode: 42, status: 42 },
  {
    name: "signal",
    script: "process.kill(process.pid, 'SIGTERM')",
    reason: "app-exit",
    signal: "SIGTERM",
    status: 143,
  },
  { name: "spawn error", reason: "spawn-error", status: 1 },
  { name: "explicit stop", reason: "stop", status: 0 },
  { name: "owner disconnect", reason: "owner-disconnect", status: 0 },
];
for (const scenario of cases) {
  test(`runner distinguishes ${scenario.name}`, { timeout: 10000 }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "preview-runner-"));
    const endpoint = join(root, "owner.sock");
    const outcome = join(root, "terminal.outcome");
    let connection: Socket | undefined;
    const owner = createServer((socket) => {
      connection = socket;
      socket.once("data", (data) => {
        assert.deepEqual(JSON.parse(data.toString()), {
          lease: "instance",
          generation: "generation",
        });
        socket.write("owned\n");
      });
    });
    owner.listen(endpoint);
    await once(owner, "listening");
    t.after(async () => {
      connection?.destroy();
      owner.close();
      await rm(root, { recursive: true, force: true });
    });
    const command =
      scenario.reason === "spawn-error"
        ? [join(root, "missing-executable")]
        : [
            process.execPath,
            "-e",
            scenario.script ?? "setInterval(() => {}, 1000); console.log('ready')",
          ];
    const runner = spawn(
      process.execPath,
      [
        new URL("../scripts/preview-runner.ts", import.meta.url).pathname,
        endpoint,
        "generation",
        "instance",
        outcome,
        ...command,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => {
      // There is no native supervisor in this test: on Linux its test-owned group is the
      // cleanup boundary. macOS's runner must already have killed this group itself.
      try {
        process.kill(-runner.pid!, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    });
    const exited = once(runner, "exit");
    if (scenario.reason === "stop" || scenario.reason === "owner-disconnect") {
      await once(runner.stdout, "data");
      if (scenario.reason === "stop") runner.kill("SIGTERM");
      else connection!.end();
    }
    const [status, signal] = await exited;
    if (process.platform === "darwin")
      assert.equal(signal, "SIGKILL", "runner kills its own group");
    else assert.equal(status, scenario.status);
    const written: PreviewOutcome = JSON.parse(await readFile(outcome, "utf8"));
    assert.deepEqual(written, {
      instanceId: "instance",
      generation: "generation",
      reason: scenario.reason,
      exitCode: scenario.exitCode ?? null,
      signal: scenario.signal ?? null,
    });
    // systemd reads the status; the adapter reads the outcome. Both must call it the same.
    if (process.platform !== "darwin")
      assert.equal(outcomeFailed(written), status !== 0, "status and outcome agree on failure");
  });
}
