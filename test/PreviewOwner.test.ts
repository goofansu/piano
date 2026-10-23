import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { PreviewRequest } from "../scripts/PreviewAdapter.ts";
import { ownerRequest } from "../scripts/PreviewClient.ts";
import { PreviewOwner } from "../scripts/PreviewOwner.ts";
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
    const config = { origin: "http://localhost" };
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

  test(`[${platform}] trusted generation, ownership conflict and independent workspaces`, async (t) => {
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
}
