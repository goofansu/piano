import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { projectPreview } from "../server/PreviewProjection.ts";
import type { SessionPreview } from "../shared/wire.ts";
import { freePort, freePorts } from "./fixtures/ports.ts";
import { type Platform } from "./fixtures/preview-host.ts";
import { ownerFixture } from "./fixtures/preview-owner-fixture.ts";

for (const platform of ["linux", "darwin"] as Platform[]) {
  const fixture = (t: TestContext, lockWait?: number) => ownerFixture(t, platform, lockWait);
  const foreign = process.platform !== platform;

  test(`[${platform}] another workspace's start waiting for readiness never stalls a warming app's checks`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t);
    const [port, silent] = await freePorts(2);
    f.config.ports = [port, silent];
    let warm = false;
    const server = createHttpServer((_request, response) => {
      response.statusCode = warm ? 200 : 500;
      response.end();
    });
    t.after(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    );
    f.host.afterSubmit = async () => {
      f.host.phase = "running";
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
    };
    let shown: SessionPreview | undefined;
    f.owner.observe((request, outcome) => {
      shown = projectPreview(shown, f.owner.identity.generation, request, outcome);
    });
    const cold = await f.call(f.owner, {
      command: [process.execPath, "-e", "process.exit(0)"],
      timeoutSeconds: 1,
    });
    assert.equal(cold.port, port);
    assert.equal(shown?.warming, true);

    f.host.afterSubmit = undefined;
    const elsewhere = join(f.root, "elsewhere");
    await mkdir(elsewhere);
    const other = await f.open("elsewhere", elsewhere);
    let otherDone = false;
    const waiting = f
      .call(other, { command: [process.execPath, "-e", "process.exit(0)"], timeoutSeconds: 5 })
      .finally(() => (otherDone = true));

    await new Promise((resolve) => setTimeout(resolve, 1500));
    warm = true;
    while (!shown?.ready && !otherDone) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(otherDone, false, "the other start's readiness wait held up this app's checks");
    assert.equal(shown?.ready, true);
    assert.equal(shown?.instanceId, cold.instanceId);
    const late = await waiting;
    assert.equal(late.port, silent);
    assert.equal(late.warming, true, "the other app is still warming up, not failed");
  });

  test(`[${platform}] a busy lock, in the owner's check or a browser read, never ends a warming app's checks`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t, 500);
    const port = await freePort();
    f.config.ports = [port];
    let warm = false;
    const server = createHttpServer((_request, response) => {
      response.statusCode = warm ? 200 : 500;
      response.end();
    });
    t.after(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    );
    f.host.afterSubmit = async () => {
      f.host.phase = "running";
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
    };
    let shown: SessionPreview | undefined;
    f.owner.observe((request, outcome) => {
      shown = projectPreview(shown, f.owner.identity.generation, request, outcome);
    });
    const cold = await f.call(f.owner, {
      command: [process.execPath, "-e", "process.exit(0)"],
      timeoutSeconds: 1,
    });
    assert.equal(shown?.warming, true);

    const holder = new DatabaseSync(join(f.state, "lock.sqlite"));
    holder.exec("BEGIN EXCLUSIVE");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(shown?.warming, true, "a busy lock says nothing about the app");
    await assert.rejects(f.call(f.owner, { action: "status" }), /busy/);
    assert.equal(shown?.ready, false);
    holder.exec("ROLLBACK");
    holder.close();

    warm = true;
    const deadline = Date.now() + 10000;
    while (!shown?.ready && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(shown?.ready, true, "the owner kept checking once the lock was free");
    assert.equal(shown?.instanceId, cold.instanceId);
  });
}
