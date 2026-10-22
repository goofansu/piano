import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import {
  PreviewAdapter,
  type PreviewConfig,
  type PreviewRequest,
} from "../scripts/PreviewAdapter.ts";

const linux = { skip: process.platform !== "linux" };
type Result = Awaited<ReturnType<PreviewAdapter["request"]>>;
function stopped(result: Result) {
  assert.ok("stopped" in result);
  return result.stopped;
}
function observation(result: Result) {
  assert.ok("ready" in result);
  return result;
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "piano-preview-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const stateRoot = join(root, "state");
  await mkdir(workspace);
  const config: PreviewConfig = { origin: "https://test.exe.xyz" };
  const request: PreviewRequest = { action: "start", workspace, command: ["/bin/false"] };
  const launches: string[][] = [];
  const stops: string[][] = [];
  const host = {
    state: { ActiveState: "failed", InvocationID: "original", ControlGroup: "/owned" },
    journal: "failed command",
    unavailable: false,
    lostReply: false,
  };
  const adapter = new PreviewAdapter({
    platform: "linux",
    uid: 1000,
    callerGroup: async () => "/caller",
    run: async (args) => {
      if (host.unavailable) throw new Error("user manager unavailable");
      if (args[0] === "loginctl") return "yes";
      if (args.includes("--value")) return "/user.slice/manager";
      if (args[0] === "journalctl") return host.journal;
      if (args.includes("show"))
        return Object.entries(host.state)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n");
      if (args[0] === "systemd-run") {
        // Durable intent must precede even an uncertain external submission.
        const files = (await readdir(stateRoot)).filter((file) => file.endsWith(".json"));
        assert.ok(files.length > 0);
        const records = await Promise.all(
          files.map(async (file) => JSON.parse(await readFile(join(stateRoot, file), "utf8"))),
        );
        assert.ok(records.some((record) => args.includes(`--unit=${record.unit}`)));
        if (host.lostReply) throw new Error("lost acknowledgement");
        launches.push(args);
      }
      if (args.includes("stop")) stops.push(args);
      return "";
    },
  });
  const call = (changes: Partial<PreviewRequest> = {}) =>
    adapter.request({ ...request, ...changes }, stateRoot, config);
  return { root, workspace, stateRoot, config, request, adapter, host, launches, stops, call };
}

test("preview identity, reuse, changed spec and stale/repeated stop", linux, async (t) => {
  const f = await fixture(t);
  const first = observation(await f.call());
  assert.equal(first.ready, false);
  const second = observation(await f.call());
  assert.equal(second.instanceId, first.instanceId);
  assert.ok("reused" in second && second.reused);
  assert.equal(f.launches.length, 1);
  await assert.rejects(f.call({ command: ["/bin/true"] }), /Launch spec changed/);
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

test("preview uncertain submission reconciles without replay", linux, async (t) => {
  const f = await fixture(t);
  f.host.lostReply = true;
  const first = observation(await f.call());
  assert.ok("launchError" in first);
  assert.match(first.launchError, /lost acknowledgement/);
  f.host.lostReply = false;
  const second = observation(await f.call());
  assert.equal(second.instanceId, first.instanceId);
  assert.equal(f.launches.length, 0);
});

test("preview unrelated listener cannot establish readiness", linux, async (t) => {
  const f = await fixture(t);
  const server = createServer();
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const first = observation(await f.call());
  const path = join(f.stateRoot, `${first.serviceId}.json`);
  const record = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...record, port: address.port }));
  f.host.state = {
    ActiveState: "active",
    InvocationID: "original",
    ControlGroup: "/not-our-cgroup",
  };
  const status = observation(await f.call({ action: "status" }));
  assert.equal(status.ready, false);
  assert.equal(status.url, null);
  assert.equal(status.instanceId, first.instanceId);
});

test(
  "preview collision, reservations and unavailable supervisor refuse without launch",
  linux,
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
    f.config.ports = [port, 8000, 8001, 7070, 9999];
    f.config.reservedPorts = [9999];
    await assert.rejects(f.call(), /No free supported/);
    f.host.unavailable = true;
    await assert.rejects(f.call(), /unsupported:.*unavailable/);
    assert.equal(f.launches.length, 0);
    assert.deepEqual(
      (await readdir(f.stateRoot)).filter((file) => file.endsWith(".json")),
      [],
    );
  },
);

test("preview invocation change refuses stop", linux, async (t) => {
  const f = await fixture(t);
  const first = observation(await f.call());
  f.host.state.InvocationID = "replacement";
  await assert.rejects(
    f.call({ action: "stop", instanceId: first.instanceId }),
    /invocation changed/,
  );
  assert.equal(f.stops.length, 0);
});

test(
  "preview environment is explicit and observations redact values with bounded logs",
  linux,
  async (t) => {
    const f = await fixture(t);
    f.host.journal = `${"x".repeat(20000)} systemd argv: APP_TOKEN=secret`;
    const result = observation(await f.call({ env: { APP_TOKEN: "secret" } }));
    assert.deepEqual(result.spec.env, ["APP_TOKEN"]);
    assert.ok(!result.logs.includes("secret"));
    assert.match(result.logs, /\[redacted\]/);
    assert.ok(result.logs.length <= 6000);
    const args = f.launches[0];
    assert.ok(args.includes("-i"));
    assert.ok(args.includes("APP_TOKEN=secret"));
    assert.ok(args.includes("--property=Restart=no"));
    assert.ok(args.includes("--property=KillMode=control-group"));
  },
);

test("non-Linux managed launch is unsupported, bounded and has no side effects", async (t) => {
  const f = await fixture(t);
  const adapter = new PreviewAdapter({
    platform: "darwin",
    run: async () => {
      assert.fail("must not invoke Linux supervisor commands");
    },
  });
  await assert.rejects(adapter.request(f.request, f.stateRoot, f.config), (error: Error) => {
    assert.match(error.message, /Managed previews unsupported: require Linux/);
    assert.ok(error.message.length < 200);
    return true;
  });
  assert.deepEqual(await readdir(f.root), ["workspace"]);
});

test(
  "concurrent canonical workspace starts serialize; other workspaces reserve distinct ports",
  linux,
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
    assert.equal(f.launches.length, 1);
    const other = join(f.root, "other");
    await mkdir(other);
    const c = observation(await f.call({ workspace: other }));
    assert.notEqual(c.serviceId, a.serviceId);
    assert.notEqual(c.port, a.port);
  },
);

test(
  "killed lock owner releases lock and retained intent is reconciled, not replayed",
  linux,
  async (t) => {
    const f = await fixture(t);
    const child = spawn(
      process.execPath,
      [new URL("./fixtures/preview-owner.ts", import.meta.url).pathname, f.workspace, f.stateRoot],
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
    assert.equal(f.launches.length, 0);
  },
);
