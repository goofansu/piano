// Opt-in native evidence: PIANO_TEST_NATIVE_PREVIEW=1 node --test test/PreviewNative.test.ts
// Needs a lingering systemd user manager or a logged-in launchd GUI domain. Never uses real
// Piano state: each case owns a temporary workspace, owner socket, state root and unique unit.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PreviewAdapter } from "../scripts/PreviewAdapter.ts";
import { PreviewOwner } from "../scripts/PreviewOwner.ts";

for (const scenario of ["clean", "crash", "signal", "stop", "disconnect"] as const) {
  test(`native preview: ${scenario}`, {
    skip: process.env.PIANO_TEST_NATIVE_PREVIEW !== "1",
    timeout: 30000,
  }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "preview-native-"));
    const adapter = new PreviewAdapter();
    const config = {
      origin: "http://localhost",
      ports: Array.from({ length: 40 }, (_, i) => 9480 + i),
    };
    const owner = await PreviewOwner.open({ cwd: root, sessionId: "native-test" }, randomUUID(), {
      adapter,
      root: join(root, "state"),
      config: async () => config,
    });
    t.after(async () => {
      owner.disconnect();
      await adapter.retire(owner.identity, join(root, "state"));
      await owner.prepareRelease();
      await rm(root, { recursive: true, force: true });
    });
    const server =
      "require('node:http').createServer((q,s) => s.end('ready')).listen(Number(process.env.PORT), '127.0.0.1')";
    const script =
      scenario === "clean"
        ? "process.exit(0)"
        : scenario === "crash"
          ? "process.exit(42)"
          : scenario === "signal"
            ? "process.kill(process.pid, 'SIGTERM')"
            : server;
    const call = async (action: "start" | "status" | "stop", instanceId?: string) => {
      const result = await adapter.request(
        {
          action,
          workspace: root,
          instanceId,
          ...(action === "start"
            ? { command: [process.execPath, "-e", script], timeoutSeconds: 2 }
            : {}),
        },
        join(root, "state"),
        config,
        owner.identity,
      );
      return JSON.parse(JSON.stringify(result));
    };
    let app = await call("start");
    if (scenario === "stop" || scenario === "disconnect") {
      assert.equal(app.ready, true);
      if (scenario === "stop") {
        assert.equal((await call("stop", app.instanceId)).stopped, true);
        assert.equal((await call("status")).status, "absent");
        t.diagnostic("explicit stop completed and cleared only its exact instance");
        return;
      }
      owner.disconnect();
    }
    const deadline = Date.now() + 10000;
    while (!app.termination) {
      assert.ok(Date.now() < deadline, JSON.stringify(app));
      await delay(50);
      app = await call("status");
    }
    assert.equal(app.state, scenario === "crash" || scenario === "signal" ? "failed" : "exited");
    assert.equal(
      app.termination.reason,
      scenario === "disconnect" ? "owner-disconnect" : "app-exit",
    );
    if (scenario === "crash") {
      assert.equal(app.termination.exitCode, 42);
      if (process.platform === "linux") assert.equal(app.supervisor.Result, "exit-code");
    }
    if (scenario === "signal") assert.equal(app.termination.signal, "SIGTERM");
    t.diagnostic(
      JSON.stringify({
        state: app.state,
        termination: app.termination,
        supervisor: app.supervisor,
      }),
    );
    await call("stop", app.instanceId);
  });
}
