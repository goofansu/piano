import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { registerPreview } from "../extensions/piano-sessions/Preview.ts";
import {
  PreviewAdapter,
  type PreviewConfig,
  type PreviewRequest,
} from "../scripts/PreviewAdapter.ts";
import { type FakeHost, fakeAdapter, type Platform } from "./fixtures/preview-host.ts";

type Result = Awaited<ReturnType<PreviewAdapter["request"]>>;
function stopped(result: Result) {
  assert.ok("stopped" in result);
  return result.stopped;
}
function observation(result: Result) {
  assert.ok("ready" in result);
  return result;
}

/** One supervisor per host OS; each runs where its real ownership checks work. */
const supervisors: [Platform, string][] = [
  ["linux", "systemd"],
  ["darwin", "launchd"],
];

for (const [platform, name] of supervisors) {
  const only = { skip: process.platform !== platform };
  const contract = (title: string, body: (t: TestContext) => Promise<void>) =>
    test(`[${name}] ${title}`, only, body);
  // A Mac serves previews on localhost by default; Linux needs its configured exe.dev origin.
  const origin = platform === "darwin" ? "http://localhost" : "https://test.exe.xyz";

  async function fixture(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "piano-preview-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const workspace = join(root, "workspace");
    const stateRoot = join(root, "state");
    await mkdir(workspace);
    const config: PreviewConfig = platform === "darwin" ? {} : { origin };
    const request: PreviewRequest = { action: "start", workspace, command: ["/bin/false"] };
    const host: FakeHost = {
      phase: "failed",
      runs: 1,
      owner: "self",
      journal: "failed command",
      unavailable: false,
      lostReply: false,
      hangOnSubmit: false,
    };
    const { adapter, launched, stops } = fakeAdapter(platform, stateRoot, host);
    const call = (changes: Partial<PreviewRequest> = {}) =>
      adapter.request({ ...request, ...changes }, stateRoot, config);
    return { root, workspace, stateRoot, config, request, adapter, host, launched, stops, call };
  }

  /** Points the saved preview at a listener this test owns, as if the app had bound it. */
  async function bindTo(f: Awaited<ReturnType<typeof fixture>>, serviceId: string, port: number) {
    const path = join(f.stateRoot, `${serviceId}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...record, port }));
  }

  contract("identity, reuse, changed spec and stale/repeated stop", async (t) => {
    const f = await fixture(t);
    const first = observation(await f.call());
    assert.equal(first.ready, false);
    assert.equal(first.state, "failed");
    const second = observation(await f.call());
    assert.equal(second.instanceId, first.instanceId);
    assert.ok("reused" in second && second.reused);
    assert.equal(f.launched.length, 1);
    const changed = observation(await f.call({ command: ["/bin/true"] }));
    assert.equal(changed.instanceId, first.instanceId);
    assert.ok("specChanged" in changed && changed.specChanged);
    assert.equal(f.launched.length, 1);
    assert.equal(stopped(await f.call({ action: "stop", instanceId: "stale" })), false);
    assert.equal(f.stops.length, 0);
    assert.equal(stopped(await f.call({ action: "stop", instanceId: first.instanceId })), true);
    assert.equal(stopped(await f.call({ action: "stop", instanceId: first.instanceId })), false);
    const replacement = observation(await f.call());
    assert.equal(replacement.serviceId, first.serviceId);
    assert.notEqual(replacement.instanceId, first.instanceId);
    assert.equal(stopped(await f.call({ action: "stop", instanceId: first.instanceId })), false);
    assert.equal(f.stops.length, 1);
  });

  contract("start without a command returns the workspace's app unchanged", async (t) => {
    const f = await fixture(t);
    const first = observation(await f.call({ env: { MODE: "dev" }, readyPath: "/health" }));
    const again = observation(await f.call({ command: undefined }));
    assert.equal(again.instanceId, first.instanceId);
    assert.ok(!("specChanged" in again));
    assert.equal(f.launched.length, 1);
  });

  contract("replace stops only the exact current instance and launches once", async (t) => {
    const f = await fixture(t);
    const first = observation(await f.call());
    assert.deepEqual(await f.call({ command: ["/bin/true"], replace: "stale" }), {
      serviceId: first.serviceId,
      status: "not-current",
      replaced: false,
    });
    assert.equal(f.stops.length, 0);
    assert.equal(f.launched.length, 1);
    const second = observation(await f.call({ command: ["/bin/true"], replace: first.instanceId }));
    assert.notEqual(second.instanceId, first.instanceId);
    assert.ok("replaced" in second && second.replaced === first.instanceId);
    assert.deepEqual(second.spec.command, ["/bin/true"]);
    assert.equal(f.stops.length, 1);
    assert.equal(f.launched.length, 2);
    // Without a command, replace restarts the same launch.
    const third = observation(await f.call({ command: undefined, replace: second.instanceId }));
    assert.notEqual(third.instanceId, second.instanceId);
    assert.deepEqual(third.spec.command, ["/bin/true"]);
    assert.equal(f.launched.length, 3);
    const status = observation(await f.call({ action: "status" }));
    assert.equal(status.instanceId, third.instanceId);
  });

  contract(
    "a bare executable resolves on the app's PATH; an unknown one launches nothing",
    async (t) => {
      const f = await fixture(t);
      f.config.path = "/usr/bin:/bin";
      await assert.rejects(
        f.call({ command: ["no-such-preview-executable"] }),
        /not an executable on the app's PATH/,
      );
      assert.equal(f.launched.length, 0);
      assert.deepEqual(await readdir(f.stateRoot), ["lock.sqlite"]);
      const first = observation(await f.call({ command: ["true"] }));
      assert.equal(first.spec.command[0], "/usr/bin/true");
      assert.ok(f.launched[0].includes("/usr/bin/true"));
      const again = observation(await f.call({ command: ["true"] }));
      assert.equal(again.instanceId, first.instanceId);
      assert.ok(!("specChanged" in again));
    },
  );

  contract("readiness requires the app to answer the preview hostname", async (t) => {
    const f = await fixture(t);
    const hostname = new URL(origin).hostname;
    let allowed = false;
    const server = createHttpServer((request, response) => {
      response.statusCode = allowed && request.headers.host?.startsWith(`${hostname}:`) ? 200 : 403;
      response.end();
    });
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const first = observation(await f.call());
    await bindTo(f, first.serviceId, address.port);
    f.host.phase = "running";
    const rejected = observation(await f.call({ action: "status" }));
    assert.equal(rejected.ready, false);
    assert.equal(rejected.url, null);
    assert.match(rejected.detail, /HTTP 403/);
    if (platform === "linux") assert.match(rejected.detail, /allow test\.exe\.xyz/);
    allowed = true;
    const accepted = observation(await f.call({ action: "status" }));
    assert.equal(accepted.ready, true);
    assert.equal(accepted.state, "running");
    assert.equal(accepted.url, `${origin}:${address.port}/`);
    assert.equal(accepted.externalAccess, platform === "darwin" ? "same-host" : "unverified");
  });

  contract("an unrelated listener cannot establish readiness", async (t) => {
    const f = await fixture(t);
    // Answers every request, so only ownership can keep it from counting as the app.
    const server = createHttpServer((_request, response) => response.end("not the app"));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const first = observation(await f.call());
    await bindTo(f, first.serviceId, address.port);
    f.host.phase = "running";
    f.host.owner = "other";
    const status = observation(await f.call({ action: "status" }));
    assert.equal(status.ready, false);
    assert.equal(status.url, null);
    assert.equal(status.instanceId, first.instanceId);
    // The same listener, owned by the unit, is ready: ownership is what decided.
    f.host.owner = "self";
    assert.equal(observation(await f.call({ action: "status" })).ready, true);
  });

  contract(
    "stop clears a preview whose unit is gone, so the workspace can launch again",
    async (t) => {
      const f = await fixture(t);
      const first = observation(await f.call());
      f.host.phase = "gone";
      const cleared = await f.call({ action: "stop", instanceId: first.instanceId });
      assert.equal(stopped(cleared), false);
      assert.ok("cleared" in cleared && cleared.cleared);
      assert.equal(f.stops.length, 0);
      assert.deepEqual(await f.call({ action: "status" }), {
        serviceId: first.serviceId,
        workspace: first.workspace,
        status: "absent",
      });
      const replacement = observation(await f.call({ command: ["/bin/true"] }));
      assert.notEqual(replacement.instanceId, first.instanceId);
      assert.equal(f.launched.length, 2);
    },
  );

  contract("stop keeps a never-seen launch until its submission can no longer land", async (t) => {
    const f = await fixture(t);
    f.host.phase = "gone";
    f.host.lostReply = true;
    const first = observation(await f.call());
    f.host.lostReply = false;
    await assert.rejects(
      f.call({ action: "stop", instanceId: first.instanceId }),
      /submission may still be in flight/,
    );
    assert.equal(observation(await f.call({ action: "status" })).instanceId, first.instanceId);
    const path = join(f.stateRoot, `${first.serviceId}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...record, createdAt: record.createdAt - 121 }));
    const cleared = await f.call({ action: "stop", instanceId: first.instanceId });
    assert.ok("cleared" in cleared && cleared.cleared);
    assert.equal(f.stops.length, 0);
  });

  contract("uncertain submission reconciles without replay", async (t) => {
    const f = await fixture(t);
    f.host.lostReply = true;
    const first = observation(await f.call());
    assert.ok("launchError" in first);
    assert.match(first.launchError, /lost acknowledgement/);
    f.host.lostReply = false;
    const second = observation(await f.call());
    assert.equal(second.instanceId, first.instanceId);
    assert.equal(f.launched.length, 0);
  });

  contract(
    "collision, reservations and unavailable supervisor refuse without launch",
    async (t) => {
      const f = await fixture(t);
      const server = createServer();
      t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
      let port = 9400;
      for (; ; port++) {
        assert.ok(port < 9500, "free test port");
        try {
          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, "127.0.0.1", () => {
              server.removeListener("error", reject);
              resolve();
            });
          });
          break;
        } catch {
          /* Try another scratch port. */
        }
      }
      f.config.ports = [port, 5173, 8000, 8001, 7070, 9999];
      f.config.reservedPorts = [9999];
      await assert.rejects(f.call(), /No free supported/);
      f.host.unavailable = true;
      await assert.rejects(f.call(), /unsupported:.*unavailable/);
      assert.equal(f.launched.length, 0);
      assert.deepEqual(
        (await readdir(f.stateRoot)).filter((file) => file.endsWith(".json")),
        [],
      );
    },
  );

  contract("an invocation change refuses stop", async (t) => {
    const f = await fixture(t);
    const first = observation(await f.call());
    f.host.runs = 2;
    await assert.rejects(
      f.call({ action: "stop", instanceId: first.instanceId }),
      /invocation changed/,
    );
    assert.equal(f.stops.length, 0);
  });

  contract(
    "environment is explicit and observations redact values with bounded logs",
    async (t) => {
      const f = await fixture(t);
      f.host.journal = `${"x".repeat(20000)}\napp argv: APP_TOKEN=secret`;
      const result = observation(await f.call({ env: { APP_TOKEN: "secret" } }));
      assert.deepEqual(result.spec.env, ["APP_TOKEN"]);
      assert.ok(!result.logs.includes("secret"));
      assert.match(result.logs, /\[redacted\]/);
      assert.ok(result.logs.length <= 6000);
      assert.ok(!JSON.stringify(result).includes("secret"));
      const launch = f.launched[0];
      assert.ok(launch.includes("APP_TOKEN=secret"));
      // No automatic restart, on either supervisor.
      assert.ok(
        launch.includes(platform === "linux" ? "Restart=no" : "<key>KeepAlive</key><false/>"),
      );
    },
  );

  contract(
    "concurrent canonical workspace starts serialize; other workspaces reserve distinct ports",
    async (t) => {
      const f = await fixture(t);
      await mkdir(f.stateRoot);
      const alias = join(f.root, "alias");
      const stateAlias = join(f.root, "state-alias");
      await symlink(f.workspace, alias);
      await symlink(f.stateRoot, stateAlias);
      const [a, b] = (
        await Promise.all([
          f.call(),
          f.adapter.request({ ...f.request, workspace: alias }, stateAlias, f.config),
        ])
      ).map(observation);
      assert.equal(a.instanceId, b.instanceId);
      assert.equal(f.launched.length, 1);
      const other = join(f.root, "other");
      await mkdir(other);
      const c = observation(await f.call({ workspace: other }));
      assert.notEqual(c.serviceId, a.serviceId);
      assert.notEqual(c.port, a.port);
    },
  );

  contract(
    "a killed lock owner releases the lock; its intent is reconciled, not replayed",
    async (t) => {
      const f = await fixture(t);
      const child = spawn(
        process.execPath,
        [
          new URL("./fixtures/preview-owner.ts", import.meta.url).pathname,
          platform,
          f.workspace,
          f.stateRoot,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      });
      let error = "";
      child.stderr.on("data", (chunk) => {
        error += chunk;
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`owner did not submit: ${error}`)), 5000);
        child.once("error", reject);
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`owner exited: ${error}`));
        });
        child.stdout.once("data", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      const status = observation(await f.call({ action: "status" }));
      const reused = observation(await f.call());
      assert.equal(reused.instanceId, status.instanceId);
      assert.equal(f.launched.length, 0);
    },
  );
}

test("[systemd] Linux without a configured origin launches nothing", {
  skip: process.platform !== "linux",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piano-preview-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state");
  const { adapter, launched } = fakeAdapter("linux", stateRoot, {
    phase: "failed",
    runs: 1,
    owner: "self",
    journal: "",
    unavailable: false,
    lostReply: false,
    hangOnSubmit: false,
  });
  await assert.rejects(
    adapter.request({ action: "start", workspace: root, command: ["/bin/false"] }, stateRoot, {}),
    /Configure origin/,
  );
  assert.equal(launched.length, 0);
});

test("an unsupported platform refuses managed launch without side effects", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piano-preview-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const adapter = new PreviewAdapter({
    platform: "win32",
    uid: 1000,
    run: async () => {
      assert.fail("must not invoke supervisor commands");
    },
  });
  await assert.rejects(
    adapter.request(
      { action: "start", workspace: root, command: ["/bin/false"] },
      join(root, "state"),
      {},
    ),
    (error: Error) => {
      assert.match(error.message, /Managed previews unsupported: require Linux .* or macOS/);
      assert.ok(error.message.length < 200);
      return true;
    },
  );
  assert.deepEqual(await readdir(root), []);
});

test("the tool is offered only where a supervisor can own the app", () => {
  const offered = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) => {
    const tools: { name: string; description: string; promptGuidelines: string[] }[] = [];
    registerPreview(
      { registerTool: (tool: (typeof tools)[number]) => tools.push(tool) } as never,
      platform,
      env,
    );
    return tools;
  };
  const [mac] = offered("darwin", {});
  assert.equal(mac.name, "piano_preview");
  assert.ok(!mac.promptGuidelines.join(" ").includes("ALLOWED_HOSTS"));
  const [vm] = offered("linux", { PIANO_PREVIEW_CONFIG: "/etc/piano/preview.json" });
  assert.equal(vm.name, "piano_preview");
  assert.ok(vm.promptGuidelines.join(" ").includes("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"));
  assert.deepEqual(offered("linux", {}), []);
  assert.deepEqual(offered("win32", {}), []);
});
