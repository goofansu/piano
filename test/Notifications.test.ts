import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deferred, Effect, Fiber, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";
import { NotificationFetch, Notifications, NotificationsLive } from "../server/Notifications.ts";
import { AllowedOrigins } from "../server/OriginPolicy.ts";
import { RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { startRouter } from "./fixtures/router.ts";

const metadata = () => Response.json({ name: "scratch", paths: [{ path: "/integrations" }] });
const slack = "https://slack-hook.int.exe.xyz/";
const second = "https://second-slack.int.exe.xyz/";

function fixture(
  fetch: typeof globalThis.fetch,
  origins = ["http://127.0.0.1:7172", "https://piano.example.test", "https://alias.example.test"],
) {
  const root = mkdtempSync(join(tmpdir(), "piano-notifications-"));
  const layer = NotificationsLive.pipe(
    Layer.provide(RegistryLive),
    Layer.provide(Layer.succeed(RegistryDatabasePath, join(root, "piano.db"))),
    Layer.provide(Layer.succeed(NotificationFetch, fetch)),
    Layer.provide(Layer.succeed(AllowedOrigins, new Set(origins))),
  );
  return { layer, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("detection has a one-second deadline, aborts HTTP, retries later and remembers success only in memory", async (t) => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  let available = false;
  const started = await Effect.runPromise(Deferred.make<void>());
  const f = fixture(async (_url, init) => {
    calls++;
    signal = init?.signal ?? undefined;
    if (available) return metadata();
    Deferred.doneUnsafe(started, Effect.void);
    return await new Promise<Response>((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
  });
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      const notifications = yield* Notifications;
      const pending = yield* notifications.state.pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(999);
      assert.equal(signal?.aborted, false);
      yield* TestClock.adjust(1);
      assert.equal((yield* Fiber.join(pending)).detected, false);
      assert.equal(signal?.aborted, true);
      assert.equal((yield* notifications.state).detected, false);
      assert.equal(calls, 1, "negative results briefly back off");
      available = true;
      yield* TestClock.adjust(30_000);
      assert.equal((yield* notifications.state).detected, true);
      available = false;
      yield* TestClock.adjust(60_000);
      assert.equal((yield* notifications.state).detected, true);
      assert.equal(calls, 2, "success never re-probes in this backend");
    }).pipe(Effect.provide(f.layer), Effect.provide(TestClock.layer())),
  );
  available = true;
  await Effect.runPromise(
    Effect.gen(function* () {
      assert.equal((yield* (yield* Notifications).state).detected, true);
    }).pipe(Effect.provide(f.layer)),
  );
  assert.equal(calls, 3, "new backend must detect again");
});

test("webhooks persist, normalize and reject unsafe/duplicate URLs; only explicit testing sends Slack text", async (t) => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  let reject = false;
  const f = fixture(async (url, init) => {
    if (String(url).includes("reflection.")) return metadata();
    requests.push({ url: String(url), init });
    return new Response("", { status: reject ? 404 : 200 });
  });
  t.after(f.dispose);
  const runtime = ManagedRuntime.make(f.layer);
  const change = (action: "add" | "remove" | "test", url: string) =>
    runtime.runPromise(Effect.flatMap(Notifications, (n) => n.change({ action, url })));
  try {
    assert.deepEqual(await change("add", "  HTTPS://SLACK-HOOK.INT.EXE.XYZ  "), {
      detected: true,
      webhooks: [slack],
    });
    assert.deepEqual((await change("add", second)).webhooks, [slack, second]);
    assert.equal(requests.length, 0);
    await assert.rejects(change("add", slack), /already been added/);
    for (const url of [
      "https://localhost/",
      "http://slack-hook.int.exe.xyz/",
      "https://slack-hook.int.exe.xyz.evil.test/",
      "https://x@y.int.exe.xyz/",
      "https://x.int.exe.xyz:444/",
      "https://x.int.exe.xyz/?secret=1",
      "https://x.int.exe.xyz/#fragment",
      "https://x.int.exe.xyz/a/..",
      "https://127.0.0.1/",
      "https://hooks.slack.com/services/secret",
    ]) {
      await assert.rejects(change("add", url), /Use an exe.dev Slack URL/);
    }
    await change("test", slack);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.init?.redirect, "error");
    assert.equal(requests[0]!.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), {
      text: "Piano: test notification.\n<https://piano.example.test/|Open Piano>",
      unfurl_links: false,
      unfurl_media: false,
    });
    reject = true;
    await assert.rejects(change("test", second), /Could not confirm Slack/);
    assert.equal(requests.length, 2, "no blind retry");
    reject = false;
    for (let i = 0; i < 3; i++) await change("test", slack);
    await assert.rejects(change("test", slack), /limit reached/);
    assert.equal(requests.length, 5, "tests share Slack's five-send-per-minute budget");
    await change("remove", slack);
  } finally {
    await runtime.dispose();
  }
  const reopened = await Effect.runPromise(
    Effect.flatMap(Notifications, (n) => n.state).pipe(Effect.provide(f.layer)),
  );
  assert.deepEqual(reopened.webhooks, [second]);
});

test("notifications require a configured HTTPS Piano origin instead of guessing a session link", async (t) => {
  const f = fixture(async () => metadata(), ["http://127.0.0.1:7172"]);
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      const n = yield* Notifications;
      assert.match((yield* n.state).problem ?? "", /PIANO_ALLOWED_ORIGINS/);
      assert.match(
        (yield* n.change({ action: "add", url: slack }).pipe(Effect.flip)).detail,
        /PIANO_ALLOWED_ORIGINS/,
      );
    }).pipe(Effect.provide(f.layer)),
  );
});

test("a stalled test send is cancelled after five seconds without retrying", async (t) => {
  const started = Deferred.makeUnsafe<void>();
  let signal: AbortSignal | undefined;
  let sends = 0;
  const f = fixture(async (url, init) => {
    if (String(url).includes("reflection.")) return metadata();
    sends++;
    signal = init?.signal ?? undefined;
    Deferred.doneUnsafe(started, Effect.void);
    return await new Promise<Response>((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
  });
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      const n = yield* Notifications;
      yield* n.change({ action: "add", url: slack });
      const pending = yield* n
        .change({ action: "test", url: slack })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(5_000);
      assert.match((yield* Fiber.join(pending)).detail, /Could not confirm Slack/);
      assert.equal(signal?.aborted, true);
      assert.equal(sends, 1);
    }).pipe(Effect.provide(f.layer), Effect.provide(TestClock.layer())),
  );
});

test("unknown or malformed environments cannot configure or test notifications", async (t) => {
  const f = fixture(async () => Response.json({ name: 17 }));
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      const n = yield* Notifications;
      assert.equal((yield* n.state).detected, false);
      assert.match(
        (yield* n.change({ action: "add", url: slack }).pipe(Effect.flip)).detail,
        /exe.dev/,
      );
    }).pipe(Effect.provide(f.layer)),
  );
});

test("server-owned completion delivers to every destination without a browser; failure does not block the next webhook", async (t) => {
  const sent: { url: string; body: unknown }[] = [];
  let delivered!: () => void;
  const done = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  const f = await startRouter(
    "piano-notifications-router-",
    Layer.mergeAll(
      Layer.succeed(AllowedOrigins, new Set(["http://piano.test", "https://piano.example.test"])),
      Layer.succeed(NotificationFetch, async (url, init) => {
        if (String(url).includes("reflection.")) return metadata();
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        if (sent.length === 2) delivered();
        return new Response("", { status: String(url) === slack ? 404 : 200 });
      }),
    ),
  );
  t.after(f.dispose);
  for (const url of [slack, second]) {
    const result = await f.handle("/api/settings/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "attacker.test",
        "X-Forwarded-Host": "attacker.test",
      },
      body: JSON.stringify({ action: "add", url }),
    });
    assert.equal(result.status, 200);
  }
  const sessionId = await f.run(
    Effect.gen(function* () {
      const session = yield* (yield* SessionHosts).create({ cwd: f.repo, options: {} });
      yield* session.act({ _tag: "prompt", text: "notification success" });
      return session.spec.sessionId;
    }),
  );
  await Promise.race([
    done,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("delivery deadline")), 5000);
      timer.unref();
    }),
  ]);
  assert.deepEqual(
    sent,
    [slack, second].map((url) => ({
      url,
      body: {
        text: `Piano: agent finished responding.\n<https://piano.example.test/s/${sessionId}|Open session>`,
        unfurl_links: false,
        unfurl_media: false,
      },
    })),
  );
});
