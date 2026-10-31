import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, get, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import type { PreviewConfig, PreviewRequest } from "../scripts/PreviewAdapter.ts";
import { ownerRequest } from "../scripts/PreviewClient.ts";
import { PreviewOwner } from "../scripts/PreviewOwner.ts";
import { projectPreview } from "../server/PreviewProjection.ts";
import type { SessionPreview } from "../shared/wire.ts";
import { type FakeHost, fakeAdapter, type Platform } from "./fixtures/preview-host.ts";

for (const dead of [true, false])
  test(`a late runner cannot spawn against ${dead ? "a dead endpoint" : "another generation"}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "preview-late-runner-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const owner = await PreviewOwner.open({ cwd: root, sessionId: "dead" }, "dead");
    t.after(() => owner.prepareRelease());
    if (dead) await owner.prepareRelease();
    const marker = join(root, "escaped-launch");
    const runner = spawn(
      process.execPath,
      [
        new URL("../scripts/preview-runner.ts", import.meta.url).pathname,
        owner.identity.endpoint,
        dead ? owner.identity.generation : "different-generation",
        "late-instance",
        join(root, "late.outcome"),
        process.execPath,
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'escaped')`,
      ],
      { detached: true, stdio: "ignore" },
    );
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      runner.kill("SIGKILL");
    }, 10000);
    t.after(() => clearTimeout(timeout));
    await once(runner, "exit");
    assert.equal(expired, false, "runner exits by itself without an owner");
    await assert.rejects(access(marker), { code: "ENOENT" });
  });

for (const platform of ["linux", "darwin"] as Platform[]) {
  async function fixture(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "preview-owner-test-"));
    const workspace = join(root, "checkout");
    const state = join(root, "state");
    await mkdir(workspace);
    const host: FakeHost = {
      phase: "failed",
      runs: 1,
      owner: "self",
      journal: "",
      unavailable: false,
      lostReply: false,
      hangOnSubmit: false,
    };
    const { adapter, launched, stops } = fakeAdapter(platform, state, host);
    const config: PreviewConfig = { origin: "http://localhost" };
    const owners: PreviewOwner[] = [];
    const open = async (sessionId = "session", cwd = workspace) => {
      const owner = await PreviewOwner.open({ cwd, sessionId }, `generation-${owners.length}`, {
        adapter,
        root: state,
        config: async () => config,
      });
      owners.push(owner);
      return owner;
    };
    t.after(async () => {
      host.unavailable = false;
      host.phase = "failed";
      await Promise.allSettled(owners.map((owner) => owner.prepareRelease()));
      await rm(root, { recursive: true, force: true });
    });
    const owner = await open();
    const call = async (who = owner, changes: Partial<PreviewRequest> = {}) =>
      JSON.parse(
        await ownerRequest(who.identity.endpoint, {
          action: "start",
          command: ["/bin/false"],
          ...changes,
          workspace: "/untrusted-tool-workspace-is-ignored",
          owner: { sessionId: "forged", generation: "forged", workspace: "/" },
        }),
      );
    return { root, workspace, state, host, adapter, launched, stops, open, owner, call, config };
  }
  // A running app's ownership is discovered from the real host (/proc on Linux, ps and lsof on
  // macOS), so cases that observe one run only on their native platform.
  const foreign = process.platform !== platform;

  test(`[${platform}] terminal outcomes distinguish app failure from cleanup and fence attribution`, async (t) => {
    const f = await fixture(t);
    const app = await f.call();
    const outcome = join(f.state, `${app.serviceId}.json.${app.instanceId}.outcome`);
    const terminal = {
      instanceId: app.instanceId,
      generation: app.owner.generation,
      reason: "app-exit",
      exitCode: 42,
      signal: null,
    };
    // systemd can unload a clean transient unit; launchd records the runner's group kill.
    f.host.phase = platform === "linux" ? "gone" : "failed";
    for (const [reason, exitCode, signal, expected] of [
      ["app-exit", 42, null, "failed"],
      ["app-exit", 0, null, "exited"],
      ["app-exit", null, "SIGTERM", "failed"],
      ["spawn-error", null, null, "failed"],
      ["stop", null, null, "exited"],
      ["owner-disconnect", null, null, "exited"],
    ]) {
      await writeFile(outcome, JSON.stringify({ ...terminal, reason, exitCode, signal }));
      const status = await f.call(f.owner, { action: "status" });
      assert.equal(status.state, expected);
      assert.equal(status.termination.reason, reason);
    }
    if (!foreign) {
      f.host.phase = "running";
      const active = await f.call(f.owner, { action: "status" });
      assert.equal(active.state, "running", "terminal evidence cannot overrule a live supervisor");
      assert.equal(active.termination, undefined);
    }
    f.host.phase = "failed";
    if (platform === "linux")
      assert.equal(
        (await f.call(f.owner, { action: "status" })).state,
        "failed",
        "a clean owner disconnect cannot hide a native cleanup failure",
      );
    for (const stale of [{ generation: "other-generation" }, { instanceId: "other-instance" }]) {
      await writeFile(outcome, JSON.stringify({ ...terminal, ...stale }));
      await assert.rejects(f.call(f.owner, { action: "status" }), /refusing to attribute/);
    }
    await writeFile(outcome, JSON.stringify(terminal));
    f.host.phase = "failed";
    await f.call(f.owner, { action: "stop", instanceId: app.instanceId });
    await assert.rejects(access(outcome), { code: "ENOENT" });
    const next = await f.call();
    assert.notEqual(next.instanceId, app.instanceId);
    assert.equal(next.termination, undefined);
  });

  test(`[${platform}] trusted generation, ownership conflict and independent workspaces`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t);
    const app = await f.call();
    assert.equal(app.workspace, f.owner.identity.workspace);
    assert.equal(app.owner.generation, f.owner.identity.generation);
    assert.equal(app.owner.endpoint, undefined, "owner endpoint is not tool output");
    const other = await f.open("competitor");
    f.host.phase = "running";
    for (const changes of [
      {},
      { replace: app.instanceId },
      { action: "stop" as const, instanceId: app.instanceId },
    ]) {
      await assert.rejects(f.call(other, changes), /ownership conflict/);
    }
    assert.equal(f.launched.length, 1);
    f.host.phase = "failed";
    await assert.rejects(
      f.call(other),
      /ownership conflict/,
      "a failed app still belongs to its live owner",
    );
    // A different owner retiring must never stop this owner's app.
    await other.prepareRelease();
    assert.equal(f.stops.length, 0);
    f.host.phase = "failed";
    const elsewhere = join(f.root, "elsewhere");
    await mkdir(elsewhere);
    const independent = await f.call(await f.open("elsewhere", elsewhere));
    assert.notEqual(independent.port, app.port);
    assert.notEqual(independent.serviceId, app.serviceId);
  });

  test(`[${platform}] active and failed observations guard idle; explicit stop permits retirement`, async (t) => {
    const f = await fixture(t);
    const app = await f.call();
    f.host.phase = "running";
    assert.equal(await f.owner.prepareRelease(true), false);
    f.host.unavailable = true;
    assert.equal(await f.owner.prepareRelease(true), false, "unknown does not mean gone");
    f.host.unavailable = false;
    f.host.phase = "failed";
    await f.call(f.owner, { action: "stop", instanceId: app.instanceId });
    assert.equal(await f.owner.prepareRelease(true), true);
    await assert.rejects(f.call(), /ENOENT|ECONNREFUSED/);
    const exited = await f.open("naturally-exited");
    await f.call(exited);
    assert.equal(
      await exited.prepareRelease(true),
      true,
      "confirmed failed/exited app needs no explicit stop to retire",
    );
  });

  test(`[${platform}] idle answers not-idle without waiting on a busy lock or an unusable state root`, {
    timeout: 10000,
  }, async (t) => {
    const f = await fixture(t);
    await f.call(); // a failed app: idle may retire it once the lock and state are readable
    // Another helper holds the account-wide lock; idle must not wait out its 65-second bound.
    const holder = new DatabaseSync(join(f.state, "lock.sqlite"));
    holder.exec("BEGIN EXCLUSIVE");
    try {
      assert.equal(await f.owner.prepareRelease(true), false, "a busy lock is not idle");
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    assert.equal(await f.owner.prepareRelease(true), true, "a free lock lets idle retire");
    // The state root became a file: idle answers not-idle, explicit cleanup reports the failure.
    const next = await f.open("unusable-state");
    await f.call(next);
    await rm(f.state, { recursive: true });
    await writeFile(f.state, "not a directory");
    assert.equal(await next.prepareRelease(true), false, "unknown state is not idle");
    await assert.rejects(next.prepareRelease(), /EEXIST|ENOTDIR/);
  });

  test(`[${platform}] cleanup retains identity after checkout deletion, is retryable and fences launches`, async (t) => {
    const f = await fixture(t);
    const app = await f.call();
    await rm(f.workspace, { recursive: true });
    f.host.unavailable = true;
    await assert.rejects(f.owner.prepareRelease(), /unavailable/);
    assert.equal(
      JSON.parse(await readFile(join(f.state, `${app.serviceId}.json`), "utf8")).instanceId,
      app.instanceId,
    );
    await assert.rejects(
      f.owner.request({ action: "start", workspace: f.workspace, command: ["/bin/true"] }),
      /owner is ending/,
    );
    f.host.unavailable = false;
    await f.owner.prepareRelease();
    await f.owner.prepareRelease();
    assert.equal(f.stops.length, 1);
    assert.equal(f.launched.length, 1);
  });

  test(`[${platform}] late cleanup cannot stop a replacement generation; reopen never adopts`, async (t) => {
    const f = await fixture(t);
    const first = await f.call();
    f.owner.disconnect(); // old Pi died; its cleanup is delayed until after the next launch
    const reopened = await f.open(); // same saved conversation, different Pi generation
    const next = await f.call(reopened); // old failed launch is confirmed stopped first
    assert.notEqual(first.instanceId, next.instanceId);
    assert.notEqual(first.owner.generation, next.owner.generation);
    const count = f.stops.length;
    await f.owner.prepareRelease();
    assert.equal(f.stops.length, count);
    assert.equal((await f.call(reopened)).instanceId, next.instanceId);
  });

  test(`[${platform}] legacy instances are neither adopted nor automatically terminated`, async (t) => {
    const f = await fixture(t);
    const app = await f.call();
    const path = join(f.state, `${app.serviceId}.json`);
    const legacy = JSON.parse(await readFile(path, "utf8"));
    delete legacy.owner;
    await writeFile(path, JSON.stringify(legacy));
    await assert.rejects(f.call(), /Legacy independent preview/);
    await f.owner.prepareRelease();
    assert.equal(f.stops.length, 0);
    const result = await f.adapter.request(
      { action: "stop", workspace: f.workspace, instanceId: app.instanceId },
      f.state,
      f.config,
    );
    assert.ok("stopped" in result && result.stopped);
    await assert.rejects(
      f.adapter.request(
        { action: "start", workspace: f.workspace, command: ["/bin/true"] },
        f.state,
        f.config,
      ),
      /live Piano session owner/,
    );
  });

  test(`[${platform}] idle racing admitted startup waits and cannot retire its live owner`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t);
    let proceed!: () => void;
    let entered!: () => void;
    const atConfig = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const owner = await PreviewOwner.open(
      { cwd: f.workspace, sessionId: "idle-race" },
      "idle-race",
      {
        adapter: f.adapter,
        root: f.state,
        config: async () => {
          entered();
          await gate;
          return f.config;
        },
      },
    );
    t.after(() => {
      proceed();
      f.host.phase = "failed";
      return owner.prepareRelease();
    });
    const starting = owner.request({
      action: "start",
      workspace: f.workspace,
      command: ["/bin/false"],
      timeoutSeconds: 1,
    });
    await atConfig;
    const idle = owner.prepareRelease(true);
    f.host.phase = "running";
    proceed();
    await starting;
    assert.equal(await idle, false, "startup wins admission before idle retirement");
    assert.equal((await f.call(owner, { action: "status" })).state, "running");
    assert.equal(f.stops.length, 0);
  });

  test(`[${platform}] aborting tool observation leaves admitted launch with its owner`, async (t) => {
    const f = await fixture(t);
    let proceed!: () => void;
    let entered!: () => void;
    const atConfig = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const owner = await PreviewOwner.open(
      { cwd: f.workspace, sessionId: "aborted-observation" },
      "aborted",
      {
        adapter: f.adapter,
        root: f.state,
        config: async () => {
          entered();
          await gate;
          return f.config;
        },
      },
    );
    t.after(() => {
      proceed();
      return owner.prepareRelease();
    });
    const abort = new AbortController();
    const result = ownerRequest(
      owner.identity.endpoint,
      { action: "start", command: ["/bin/false"] },
      abort.signal,
    );
    await atConfig;
    abort.abort();
    await assert.rejects(result, /abort/i);
    proceed();
    const status = await f.call(owner, { action: "status" });
    assert.equal(status.owner.generation, owner.identity.generation);
    assert.equal(f.launched.length, 1, "cancelled client did not cancel or repeat the launch");
    assert.equal((await f.call(owner)).instanceId, status.instanceId);
  });

  test(`[${platform}] admitted startup/replace versus idle and owner death cannot escape cleanup`, async (t) => {
    const f = await fixture(t);
    // Hold real configuration input, not lifecycle methods, while the admitted replacement waits.
    let hold = false;
    let proceed!: () => void;
    let entered!: () => void;
    const atConfig = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const owner = await PreviewOwner.open({ cwd: f.workspace, sessionId: "racing" }, "race", {
      adapter: f.adapter,
      root: f.state,
      config: async () => {
        if (hold) {
          entered();
          await gate;
        }
        return f.config;
      },
    });
    t.after(() => {
      proceed();
      return owner.prepareRelease();
    });
    const first = await f.call(owner);
    hold = true;
    const starting = owner.request({
      action: "start",
      workspace: f.workspace,
      command: ["/bin/true"],
      replace: first.instanceId,
    });
    await atConfig;
    const idle = owner.prepareRelease(true);
    const closing = owner.prepareRelease();
    proceed();
    await starting;
    await idle;
    await closing;
    assert.equal(f.launched.length, 2);
    assert.equal(f.stops.length, 2, "old instance and in-flight new instance are both cleaned");
    await assert.rejects(
      owner.request({ action: "start", workspace: f.workspace }),
      /owner is ending/,
    );
    assert.equal(first.owner.generation, owner.identity.generation);
  });
  test(`[${platform}] a replacement clears the old app once stopped and shows the new one starting`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t);
    // A and B share one port, as when Piano reuses it; B answers 503 until it warms up.
    const port = await freePort();
    f.config.ports = [port];
    const servers = new Set<Server>();
    const serve = async (status: () => number, body: string) => {
      const server = createHttpServer((_request, response) => {
        response.statusCode = status();
        response.end(body);
      });
      servers.add(server);
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      return server;
    };
    const shut = (server: Server) =>
      new Promise<void>((resolve) => {
        servers.delete(server);
        server.close(() => resolve());
        server.closeAllConnections();
      });
    t.after(() => Promise.all([...servers].map(shut)));

    // What the session's state shows after each owner publication, in order.
    let shown: SessionPreview | undefined;
    const published: (SessionPreview | undefined)[] = [];
    f.owner.observe((request, outcome) => {
      shown = projectPreview(shown, f.owner.identity.generation, request, outcome);
      published.push(shown);
    });

    const a = await f.call();
    f.host.phase = "running";
    const appA = await serve(() => 200, "A");
    const readyA = await f.call(f.owner, { action: "status" });
    assert.equal(readyA.ready, true);
    assert.equal(shown?.url, `http://localhost:${port}/`);

    // Rejected before A stops: A and its ready link remain.
    assert.equal((await f.call(f.owner, { replace: "stale-instance" })).status, "not-current");
    await assert.rejects(
      f.call(f.owner, {
        replace: a.instanceId,
        command: ["/usr/bin/python3", "-m", "http.server", "{port}"],
      }),
    );
    assert.equal(shown?.instanceId, a.instanceId);
    assert.equal(shown?.url, `http://localhost:${port}/`);
    assert.equal(f.stops.length, 0);

    let warm = false;
    f.host.onStop = async () => {
      await shut(appA);
      f.host.phase = "gone";
    };
    f.host.afterSubmit = async () => {
      f.host.phase = "running";
      await serve(() => (warm ? 200 : 503), "B");
    };
    published.length = 0;
    let settled = false;
    const replacing = f.call(f.owner, { replace: a.instanceId, timeoutSeconds: 20 }).finally(() => {
      settled = true;
    });
    const deadline = Date.now() + 10000;
    while (!(shown && shown.instanceId !== a.instanceId) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));

    // B is held unready: the replacement has not completed, yet the state already moved on.
    assert.equal(settled, false, "the replacement is still waiting for B's readiness");
    assert.ok(
      published.indexOf(undefined) >= 0 &&
        published.indexOf(undefined) < published.findIndex((p) => p !== undefined),
      "A is cleared as soon as its stop is confirmed",
    );
    assert.ok(shown, "B's launch intent is published");
    assert.notEqual(shown.instanceId, a.instanceId);
    assert.equal(shown.state, "starting");
    assert.equal(shown.ready, false);
    assert.equal(shown.url, null, "B has no ready URL before its own readiness check");
    assert.equal(await statusAt(port), 503, "A's old URL now reaches unready B");

    warm = true;
    const b = await replacing;
    assert.equal(b.ready, true);
    assert.equal(b.replaced, a.instanceId);
    assert.equal(shown?.instanceId, b.instanceId);
    assert.equal(shown?.url, `http://localhost:${port}/`);

    // A stale stop of A cannot target B.
    assert.equal(
      (await f.call(f.owner, { action: "stop", instanceId: a.instanceId })).status,
      "not-current",
    );
    assert.equal(shown?.instanceId, b.instanceId);
    assert.equal(shown?.ready, true);
  });
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function statusAt(port: number) {
  return new Promise<number | undefined>((resolve, reject) => {
    get({ host: "127.0.0.1", port, path: "/" }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
}
