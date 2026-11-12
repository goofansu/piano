import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { mock, type TestContext, test } from "node:test";
import { WARMUP_SECONDS } from "../scripts/PreviewReadiness.ts";
import { projectPreview } from "../server/PreviewProjection.ts";
import type { SessionPreview } from "../shared/wire.ts";
import { freePort } from "./fixtures/ports.ts";
import { type Platform } from "./fixtures/preview-host.ts";
import { ownerFixture } from "./fixtures/preview-owner-fixture.ts";

for (const platform of ["linux", "darwin"] as Platform[]) {
  const fixture = (t: TestContext, lockWait?: number) => ownerFixture(t, platform, lockWait);
  // A running app's ownership is discovered from the real host (/proc on Linux, ps and lsof on
  // macOS), so cases that observe one run only on their native platform.
  const foreign = process.platform !== platform;

  test(`[${platform}] keeps checking a warming app after the start's deadline and shows it once it answers`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t);
    const port = await freePort();
    f.config.ports = [port];
    let warm = false;
    let requests = 0;
    const server = createHttpServer((_request, response) => {
      requests++;
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
    assert.equal(cold.warming, true);
    assert.equal(shown?.warming, true, "the session shows it warming up, not failed");
    assert.equal(shown?.url, null);

    // Nobody asks again: the owner's own checks find it ready.
    warm = true;
    const deadline = Date.now() + 10000;
    while (!shown?.ready && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(shown?.ready, true);
    assert.equal(shown?.warming, false);
    assert.equal(shown?.instanceId, cold.instanceId);
    assert.equal(shown?.url, `http://localhost:${port}/`);

    // Once it answered, checking stops.
    const answered = requests;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(requests, answered);
  });

  test(`[${platform}] a stale stop or replace while an app warms still shows it once it answers`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t);
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

    // Requests naming an instance that is no longer current observe nothing about this app.
    assert.equal(
      (await f.call(f.owner, { action: "stop", instanceId: "stale" })).status,
      "not-current",
    );
    assert.equal(
      (await f.call(f.owner, { replace: "stale", command: [process.execPath, "-e", "0"] })).status,
      "not-current",
    );
    assert.equal(shown?.warming, true, "a stale request says nothing about the app");

    warm = true;
    const deadline = Date.now() + 10000;
    while (!shown?.ready && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(shown?.ready, true, "the session gains the link once the app answers");
    assert.equal(shown?.instanceId, cold.instanceId);
    assert.equal(shown?.url, `http://localhost:${port}/`);
  });

  test(`[${platform}] a failing read keeps a warming app checked, for its warm-up window only`, async (t) => {
    if (foreign) return t.skip("needs native process ownership");
    const f = await fixture(t);
    const port = await freePort();
    f.config.ports = [port];
    const server = createHttpServer((_request, response) => {
      response.statusCode = 500;
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
    let failures = 0;
    f.owner.observe((_request, outcome) => {
      if ("error" in outcome) failures++;
    });
    const cold = await f.call(f.owner, {
      command: [process.execPath, "-e", "process.exit(0)"],
      timeoutSeconds: 1,
    });
    assert.equal(cold.warming, true);

    // The supervisor stops answering: each check fails and is shown, and checking goes on.
    f.host.unavailable = true;
    const deadline = Date.now() + 10000;
    while (failures < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(failures >= 2, "the owner checks again after a failed check");

    // Past the warm-up window, a failing check is the last one.
    mock.timers.enable({ apis: ["Date"], now: Date.now() + (WARMUP_SECONDS + 1) * 1000 });
    t.after(() => mock.timers.reset());
    const seen = failures;
    for (let i = 0; failures === seen && i < 200; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(failures > seen, "the owner checked once past the window");
    const last = failures;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(failures, last, "checking stopped after the warm-up window");
  });
}
