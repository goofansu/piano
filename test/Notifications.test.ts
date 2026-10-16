import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import { TestClock } from "effect/testing";
import { ExeDevFetch } from "../server/ExeDev.ts";
import {
  NotificationDelayMs,
  NotificationFetch,
  Notifications,
  NotificationsLive,
} from "../server/Notifications.ts";
import { AllowedOrigins } from "../server/OriginPolicy.ts";
import type { PiSession } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { startRouter } from "./fixtures/router.ts";

const second = "https://second-slack.int.exe.xyz/";
const metadata = () => Response.json({ name: "scratch", paths: [{ path: "/integrations" }] });
const defaultEntries = [
  { name: "slack-hook", type: "slack" },
  { name: "second-slack", type: "slack" },
  { name: "slack-bot", type: "slack-bot" },
  { name: "notify", type: "notify" },
];
function fixture(send: typeof globalThis.fetch, origins = ["https://piano.example.test"]) {
  const root = mkdtempSync(join(tmpdir(), "piano-notifications-"));
  const discovery = { entries: defaultEntries, status: 200 };
  const layer = NotificationsLive.pipe(
    Layer.provideMerge(RegistryLive),
    Layer.provide(Layer.succeed(RegistryDatabasePath, join(root, "piano.db"))),
    Layer.provide(Layer.succeed(NotificationFetch, send)),
    Layer.provide(
      Layer.succeed(ExeDevFetch, async (url) =>
        String(url).endsWith("/integrations")
          ? Response.json({ integrations: discovery.entries }, { status: discovery.status })
          : metadata(),
      ),
    ),
    Layer.provide(Layer.succeed(AllowedOrigins, new Set(origins))),
  );
  return { layer, discovery, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("selection is opt-in, only Slack names are accepted, and one saved choice survives restart", async (t) => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  let status = 200;
  const f = fixture(async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response("", { status });
  });
  t.after(f.dispose);
  const runtime = ManagedRuntime.make(f.layer);
  const select = (name: string | null) =>
    runtime.runPromise(Effect.flatMap(Notifications, (n) => n.change({ action: "select", name })));
  const sendTest = () =>
    runtime.runPromise(Effect.flatMap(Notifications, (n) => n.change({ action: "test" })));
  try {
    const initial = await runtime.runPromise(Effect.flatMap(Notifications, (n) => n.state()));
    assert.deepEqual(initial, { integrations: ["second-slack", "slack-hook"], selected: null });
    await assert.rejects(sendTest(), /Select an available Slack integration/);
    for (const name of [
      "notify",
      "slack-bot",
      "unknown",
      "https://evil.test/",
      "evil.int.exe.xyz/",
      "../slack-hook",
    ]) {
      await assert.rejects(select(name), /Select an available Slack integration/);
    }
    assert.equal((await select("slack-hook")).selected, "slack-hook");
    assert.equal((await select("second-slack")).selected, "second-slack");
    assert.equal(
      await runtime.runPromise(Effect.flatMap(Registry, (r) => r.notificationIntegration)),
      "second-slack",
      "persistence stores the name, not the derived URL",
    );
    assert.equal(requests.length, 0, "selection never sends a notification");
    await sendTest();
    assert.equal(requests[0]!.url, second);
    assert.equal(requests[0]!.init?.redirect, "error");
    assert.equal(requests[0]!.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), {
      text: "Test notification from Piano. https://piano.example.test/",
      unfurl_links: false,
      unfurl_media: false,
    });
    status = 404;
    await assert.rejects(sendTest(), /Could not confirm Slack/);
    assert.equal(requests.length, 2, "no blind retry");
    status = 200;
    for (let i = 0; i < 3; i++) await sendTest();
    await assert.rejects(sendTest(), /limit reached/);
    assert.equal(requests.length, 5);
  } finally {
    await runtime.dispose();
  }
  const reopened = await Effect.runPromise(
    Effect.flatMap(Notifications, (n) => n.state()).pipe(Effect.provide(f.layer)),
  );
  assert.equal(reopened.selected, "second-slack");
});

test("stored names match discovery case-insensitively; missing, failed and empty catalogs retain a clearable preference", async (t) => {
  let sends = 0;
  const f = fixture(async () => {
    sends++;
    return new Response("");
  });
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* Registry;
      const n = yield* Notifications;
      yield* registry.setNotificationIntegration("SLACK-HOOK");
      assert.equal((yield* n.state()).selected, "slack-hook");
      f.discovery.entries = [{ name: "slack-hook", type: "notify" }];
      assert.deepEqual(yield* n.state(true), { integrations: [], selected: "SLACK-HOOK" });
      assert.match(
        (yield* n.change({ action: "test" }).pipe(Effect.flip)).detail,
        /available Slack/,
      );
      yield* n.completed("wrong-type");
      // The worker consumes a ready queue item against the fresh in-memory catalog; no HTTP wait.
      yield* Effect.yieldNow;
      assert.equal(sends, 0, "type changes also suppress automatic delivery");
      f.discovery.status = 503;
      assert.deepEqual(yield* n.state(true), { integrations: null, selected: "SLACK-HOOK" });
      assert.equal((yield* n.change({ action: "select", name: null })).selected, null);
      assert.equal(yield* registry.notificationIntegration, null);
      assert.equal(sends, 0);
    }).pipe(Effect.provide(f.layer)),
  );
});

test("clearing requires neither discovery nor a public origin; choosing or testing does require the link origin", async (t) => {
  const f = fixture(async () => {
    throw new Error("must not send");
  }, []);
  f.discovery.status = 503;
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* (yield* Registry).setNotificationIntegration("slack-hook");
      const n = yield* Notifications;
      assert.match((yield* n.state()).problem ?? "", /PIANO_ALLOWED_ORIGINS/);
      assert.match(
        (yield* n.change({ action: "select", name: "slack-hook" }).pipe(Effect.flip)).detail,
        /PIANO_ALLOWED_ORIGINS/,
      );
      assert.equal((yield* n.change({ action: "select", name: null })).selected, null);
    }).pipe(Effect.provide(f.layer)),
  );
});

test("replacement skips queued sends to the old destination", async (t) => {
  const delivered = Deferred.makeUnsafe<void>();
  const sent: { url: string; text: string }[] = [];
  const f = fixture(async (url, init) => {
    sent.push({ url: String(url), text: JSON.parse(String(init?.body)).text });
    if (sent.length === 6) Deferred.doneUnsafe(delivered, Effect.void);
    return new Response("");
  });
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      const n = yield* Notifications;
      yield* n.change({ action: "select", name: "slack-hook" });
      for (let i = 0; i < 5; i++) yield* n.change({ action: "test" });
      yield* n.completed("old-session");
      yield* n.change({ action: "select", name: "second-slack" });
      yield* n.completed("new-session");
      yield* TestClock.adjust(60_000);
      yield* Deferred.await(delivered);
      assert.deepEqual(sent.at(-1), {
        url: second,
        text: "Agent finished responding. https://piano.example.test/s/new-session",
      });
      assert.equal(
        sent.some((r) => r.text.includes("old-session")),
        false,
      );
    }).pipe(Effect.provide(f.layer), Effect.provide(TestClock.layer())),
  );
});

for (const action of ["touch", "complete again"] as const) {
  test(`a completion waiting for delivery is invalidated by ${action}`, async (t) => {
    const delivered = Deferred.makeUnsafe<void>();
    const texts: string[] = [];
    const f = fixture(async (_url, init) => {
      const text = JSON.parse(String(init?.body)).text as string;
      texts.push(text);
      if (text.endsWith("/sentinel")) Deferred.doneUnsafe(delivered, Effect.void);
      return new Response("");
    });
    t.after(f.dispose);
    await Effect.runPromise(
      Effect.gen(function* () {
        const n = yield* Notifications;
        yield* n.change({ action: "select", name: "slack-hook" });
        // Exhaust the quota so the first completion outlives its initial delay.
        for (let i = 0; i < 5; i++) yield* n.change({ action: "test" });
        yield* n.completed("waiting");
        yield* TestClock.adjust(1_000);
        if (action === "touch") yield* n.touched("waiting");
        else yield* n.completed("waiting");
        yield* n.completed("sentinel");
        yield* TestClock.adjust(60_000);
        yield* Deferred.await(delivered);
        assert.deepEqual(
          texts.slice(5),
          [
            ...(action === "touch"
              ? []
              : ["Agent finished responding. https://piano.example.test/s/waiting"]),
            "Agent finished responding. https://piano.example.test/s/sentinel",
          ],
          "only the current completion can be delivered after a quota wait",
        );
      }).pipe(
        Effect.provide(f.layer),
        Effect.provide(Layer.succeed(NotificationDelayMs, 1_000)),
        Effect.provide(TestClock.layer()),
      ),
    );
  });
}

test("a stalled test send is cancelled after five seconds without retrying", async (t) => {
  const started = Deferred.makeUnsafe<void>();
  let signal: AbortSignal | undefined;
  let sends = 0;
  const f = fixture(async (_url, init) => {
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
      yield* n.change({ action: "select", name: "slack-hook" });
      const pending = yield* n.change({ action: "test" }).pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(5_000);
      assert.match((yield* Fiber.join(pending)).detail, /Could not confirm Slack/);
      assert.equal(signal?.aborted, true);
      assert.equal(sends, 1);
    }).pipe(Effect.provide(f.layer), Effect.provide(TestClock.layer())),
  );
});

test("a completion waits a minute and is dropped when the session is acted on or opened first", async (t) => {
  const texts: string[] = [];
  let next = Deferred.makeUnsafe<void>();
  const f = fixture(async (_url, init) => {
    texts.push(JSON.parse(String(init?.body)).text);
    Deferred.doneUnsafe(next, Effect.void);
    return new Response("");
  });
  t.after(f.dispose);
  await Effect.runPromise(
    Effect.gen(function* () {
      const n = yield* Notifications;
      yield* n.change({ action: "select", name: "slack-hook" });
      // Untouched: posted once the minute is up, not before.
      yield* n.completed("quiet");
      yield* TestClock.adjust(59_000);
      yield* Effect.yieldNow;
      assert.deepEqual(texts, []);
      yield* TestClock.adjust(1_000);
      yield* Deferred.await(next);
      assert.deepEqual(texts, ["Agent finished responding. https://piano.example.test/s/quiet"]);
      // Acted on during the wait: never posted, even long after.
      next = Deferred.makeUnsafe<void>();
      yield* n.completed("busy");
      yield* TestClock.adjust(30_000);
      yield* n.touched("busy");
      yield* TestClock.adjust(120_000);
      yield* Effect.yieldNow;
      assert.equal(texts.length, 1);
      // A newer completion restarts the wait, and a touch on another session changes nothing.
      yield* n.completed("again");
      yield* TestClock.adjust(45_000);
      yield* n.completed("again");
      yield* n.touched("other");
      yield* TestClock.adjust(45_000);
      yield* Effect.yieldNow;
      assert.equal(texts.length, 1, "the restarted wait has 15 seconds left");
      yield* TestClock.adjust(15_000);
      yield* Deferred.await(next);
      assert.deepEqual(
        texts.at(-1),
        "Agent finished responding. https://piano.example.test/s/again",
      );
      assert.equal(texts.length, 2);
    }).pipe(Effect.provide(f.layer), Effect.provide(TestClock.layer())),
  );
});

test("through the session host, an action or an opened event stream during the wait drops the message", async (t) => {
  const texts: string[] = [];
  const next = Deferred.makeUnsafe<void>();
  const f = await startRouter(
    "piano-notifications-wait-",
    Layer.mergeAll(
      Layer.succeed(AllowedOrigins, new Set(["http://piano.test", "https://piano.example.test"])),
      Layer.succeed(ExeDevFetch, async (url) =>
        String(url).endsWith("/integrations")
          ? Response.json({ integrations: defaultEntries })
          : metadata(),
      ),
      Layer.succeed(NotificationFetch, async (_url, init) => {
        texts.push(JSON.parse(String(init?.body)).text);
        Deferred.doneUnsafe(next, Effect.void);
        return new Response("");
      }),
      TestClock.layer(),
    ),
  );
  t.after(f.dispose);
  const selected = await f.handle("/api/settings/integrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "select", name: "slack-hook" }),
  });
  assert.equal(selected.status, 200);
  const settle = (session: PiSession) =>
    session.events.pipe(
      Stream.filter((event) => event._tag === "response_completed"),
      Stream.take(1),
      Stream.runDrain,
    );
  const session = await f.run(
    Effect.gen(function* () {
      const session = yield* (yield* SessionHosts).create({ cwd: f.repo, options: {} });
      const settled = yield* Effect.forkChild(settle(session));
      yield* session.act({ _tag: "prompt", text: "notification success" });
      yield* Fiber.join(settled);
      return session;
    }),
  );
  // Opening the session (a new event subscription) half-way through the wait drops the message.
  await f.run(TestClock.adjust(30_000));
  await f.run(session.events.pipe(Stream.take(1), Stream.runDrain));
  await f.run(TestClock.adjust(120_000));
  assert.deepEqual(texts, []);
  // An action during the wait drops it as well.
  await f.run(
    Effect.gen(function* () {
      const settled = yield* Effect.forkChild(settle(session));
      yield* session.act({ _tag: "prompt", text: "notification success" });
      yield* Fiber.join(settled);
    }),
  );
  await f.run(TestClock.adjust(30_000));
  await f.run(session.act({ _tag: "set_thinking_level", level: "low" }));
  await f.run(TestClock.adjust(120_000));
  assert.deepEqual(texts, []);
  // Left alone, the message goes out once the minute is up.
  await f.run(
    Effect.gen(function* () {
      const settled = yield* Effect.forkChild(settle(session));
      yield* session.act({ _tag: "prompt", text: "notification success" });
      yield* Fiber.join(settled);
    }),
  );
  await f.run(TestClock.adjust(60_000));
  await f.run(Deferred.await(next));
  assert.deepEqual(texts, [
    `Agent finished responding. https://piano.example.test/s/${session.spec.sessionId}`,
  ]);
});

test("server-owned completion sends one session link to the discovered selection without a browser", async (t) => {
  const sent: { url: string; body: unknown }[] = [];
  let delivered!: () => void;
  const done = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let inventoryReads = 0;
  const f = await startRouter(
    "piano-notifications-router-",
    Layer.mergeAll(
      Layer.succeed(AllowedOrigins, new Set(["http://piano.test", "https://piano.example.test"])),
      Layer.succeed(ExeDevFetch, async (url) => {
        if (String(url).endsWith("/integrations")) {
          inventoryReads++;
          return Response.json({ integrations: defaultEntries });
        }
        return metadata();
      }),
      Layer.succeed(NotificationFetch, async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        delivered();
        return new Response("");
      }),
      // The wait is covered by its own test; this one is about delivery without a browser.
      Layer.succeed(NotificationDelayMs, 0),
    ),
  );
  t.after(f.dispose);
  assert.deepEqual(await (await f.handle("/api/settings/integrations/environment")).json(), {
    detected: true,
  });
  assert.equal(inventoryReads, 0);
  for (const name of ["slack-hook", "second-slack"]) {
    const result = await f.handle("/api/settings/integrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "attacker.test",
        "X-Forwarded-Host": "attacker.test",
      },
      body: JSON.stringify({ action: "select", name }),
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
  assert.deepEqual(sent, [
    {
      url: second,
      body: {
        text: `Agent finished responding. https://piano.example.test/s/${sessionId}`,
        unfurl_links: false,
        unfurl_media: false,
      },
    },
  ]);
});
