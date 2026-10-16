import assert from "node:assert/strict";
import { test } from "node:test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { ExeDev, ExeDevFetch, ExeDevLive } from "../server/ExeDev.ts";

const metadata = (paths = ["/integrations"]) =>
  Response.json({ name: "scratch", paths: paths.map((path) => ({ path })) });
const layer = (fetch: typeof globalThis.fetch) =>
  ExeDevLive.pipe(Layer.provide(Layer.succeed(ExeDevFetch, fetch)));

test("exe.dev detection aborts at exactly one second, retries later and remembers success only in memory", async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  let available = false;
  const started = Deferred.makeUnsafe<void>();
  const live = layer(async (_url, init) => {
    calls++;
    signal = init?.signal ?? undefined;
    assert.equal(init?.redirect, "error");
    if (available) return metadata();
    Deferred.doneUnsafe(started, Effect.void);
    return await new Promise<Response>((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const exe = yield* ExeDev;
      const pending = yield* exe.detected.pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(999);
      assert.equal(signal?.aborted, false);
      yield* TestClock.adjust(1);
      assert.equal(yield* Fiber.join(pending), false);
      assert.equal(signal?.aborted, true);
      assert.equal(yield* exe.detected, false);
      assert.equal(calls, 1);
      available = true;
      yield* TestClock.adjust(30_000);
      assert.equal(yield* exe.detected, true);
      available = false;
      yield* TestClock.adjust(60_000);
      assert.equal(yield* exe.detected, true);
      assert.equal(calls, 2);
    }).pipe(Effect.provide(live), Effect.provide(TestClock.layer())),
  );
  available = true;
  assert.equal(
    await Effect.runPromise(Effect.flatMap(ExeDev, (e) => e.detected).pipe(Effect.provide(live))),
    true,
  );
  assert.equal(calls, 3, "a new backend detects again");
});

test("inventory refreshes independently of cached detection and distinguishes errors from an empty list", async () => {
  let rootReads = 0,
    inventoryReads = 0;
  let entries = [
    { name: "slack-hook", type: "slack", comment: "private", help: "never execute this" },
  ];
  let status = 200;
  await Effect.runPromise(
    Effect.gen(function* () {
      const exe = yield* ExeDev;
      assert.equal(yield* exe.detected, true);
      assert.equal(inventoryReads, 0, "navigation detection must not wait for inventory");
      assert.deepEqual(yield* exe.integrations(), [{ name: "slack-hook", type: "slack" }]);
      entries = [];
      assert.equal((yield* exe.integrations())?.length, 1, "short-lived inventory cache");
      assert.deepEqual(yield* exe.integrations(true), []);
      status = 503;
      assert.equal(yield* exe.integrations(true), null);
      assert.equal(yield* exe.detected, true);
      assert.equal(rootReads, 1, "inventory failure never clears positive detection");
      assert.equal(inventoryReads, 3);
      status = 200;
      yield* TestClock.adjust(30_000);
      assert.deepEqual(yield* exe.integrations(), []);
      assert.equal(inventoryReads, 4);
    }).pipe(
      Effect.provide(
        layer(async (url, init) => {
          assert.equal(init?.redirect, "error");
          if (String(url).endsWith("/integrations")) {
            inventoryReads++;
            return Response.json({ integrations: entries }, { status });
          }
          rootReads++;
          return metadata();
        }),
      ),
      Effect.provide(TestClock.layer()),
    ),
  );
});

test("missing discovery permission is unavailable, and explicit refresh can discover a newly advertised path", async () => {
  let paths: string[] = [];
  let inventoryReads = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const exe = yield* ExeDev;
      assert.equal(yield* exe.detected, true);
      assert.equal(yield* exe.integrations(), null);
      assert.equal(inventoryReads, 0);
      paths = ["/integrations"];
      assert.deepEqual(yield* exe.integrations(true), []);
      assert.equal(inventoryReads, 1);
    }).pipe(
      Effect.provide(
        layer(async (url) => {
          if (String(url).endsWith("/integrations")) {
            inventoryReads++;
            return Response.json({ integrations: [] });
          }
          return metadata(paths);
        }),
      ),
    ),
  );
});

for (const bad of [
  { integrations: "wrong" },
  { integrations: [{ name: "evil.test/path", type: "slack" }] },
  {
    integrations: [
      { name: "same", type: "slack" },
      { name: "same", type: "notify" },
    ],
  },
  { integrations: [{ name: "slack", type: "slack", help: "x".repeat(65_536) }] },
])
  test(`malformed or oversized discovery is unavailable: ${JSON.stringify(bad).slice(0, 100)}`, async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const exe = yield* ExeDev;
        assert.equal(yield* exe.integrations(), null);
        assert.equal(yield* exe.detected, true);
      }).pipe(
        Effect.provide(
          layer(async (url) =>
            String(url).endsWith("/integrations") ? Response.json(bad) : metadata(),
          ),
        ),
      ),
    );
  });

test("the independent inventory deadline includes a stalled response body", async () => {
  const started = Deferred.makeUnsafe<void>();
  let signal: AbortSignal | undefined;
  await Effect.runPromise(
    Effect.gen(function* () {
      const exe = yield* ExeDev;
      yield* exe.detected;
      const pending = yield* exe.integrations().pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(999);
      assert.equal(signal?.aborted, false);
      yield* TestClock.adjust(1);
      assert.equal(yield* Fiber.join(pending), null);
      assert.equal(signal?.aborted, true);
      assert.equal(yield* exe.detected, true);
    }).pipe(
      Effect.provide(
        layer(async (url, init) => {
          if (!String(url).endsWith("/integrations")) return metadata();
          signal = init?.signal ?? undefined;
          return new Response(
            new ReadableStream({
              start(controller) {
                signal?.addEventListener("abort", () => controller.error(new Error("aborted")), {
                  once: true,
                });
                Deferred.doneUnsafe(started, Effect.void);
              },
            }),
          );
        }),
      ),
      Effect.provide(TestClock.layer()),
    ),
  );
});
