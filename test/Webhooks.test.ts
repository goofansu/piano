import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, Logger, type Scope, Stream } from "effect";
import { AllowedOrigins } from "../server/OriginPolicy.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { WebhookFetch, Webhooks, WebhooksLive, WebhookTimeoutMs } from "../server/Webhooks.ts";
import { LAST_ANSWER_CHARS } from "../shared/dispatch.ts";
import { emptySnapshot } from "../shared/sessionProjection.ts";
import { WEBHOOK_EVENTS, type WebhookPayload, type WebhookSave } from "../shared/webhooks.ts";
import type { Snapshot } from "../shared/wire.ts";

const root = mkdtempSync(join(tmpdir(), "piano-webhooks-"));
const cwd = join(root, "checkout");
mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_SESSION_DIR);
after(() => rmSync(root, { recursive: true, force: true }));
const input: WebhookSave = {
  url: "https://receiver.example/events",
  events: ["session.completed"],
  active: true,
};
type Received = { url: string; headers: Headers; body: WebhookPayload };
const receive =
  (requests: Received[]): typeof fetch =>
  async (url, init) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(null, { status: 204 });
  };
const run = <A, E>(
  name: string,
  work: Effect.Effect<A, E, Webhooks | Registry | Scope.Scope>,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = 10_000,
) =>
  Effect.runPromise(
    work.pipe(
      Effect.scoped,
      Effect.provide(WebhooksLive.pipe(Layer.provideMerge(RegistryLive))),
      Effect.provideService(RegistryDatabasePath, join(root, `${name}.db`)),
      Effect.provideService(WebhookFetch, fetch),
      Effect.provideService(WebhookTimeoutMs, timeoutMs),
      Effect.provideService(AllowedOrigins, new Set(["https://piano.example"])),
    ),
  );
/** Webhooks fed by real session hosts on fake Pi, delivering into `requests`, until the scope
 * closes as Piano's does at shutdown. */
const live =
  (name: string, requests: Received[]) =>
  <A, E>(work: Effect.Effect<A, E, Webhooks | SessionHosts | Registry | Scope.Scope>) =>
    work.pipe(
      Effect.timeout("10 seconds"),
      Effect.scoped,
      Effect.provide(
        SessionHostsLive({ idleMs: 0 }).pipe(
          Layer.provide(PiSessionsLive),
          Layer.provideMerge(RegistryLive),
          Layer.provide(NodeServices.layer),
        ),
      ),
      Effect.provideService(RegistryDatabasePath, join(root, `${name}.db`)),
      Effect.provideService(WebhookFetch, receive(requests)),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
      Effect.provideService(AllowedOrigins, new Set(["https://piano.example"])),
    );
const wait = (condition: () => boolean) =>
  Effect.gen(function* () {
    while (!condition()) yield* Effect.sleep(5);
  }).pipe(Effect.timeout("5 seconds"));
const snapshot: Snapshot = {
  ...emptySnapshot("s"),
  messages: [{ id: "a", role: "assistant", text: "x".repeat(2001), stopReason: "stop" }],
};
const registered = Effect.gen(function* () {
  const registry = yield* Registry;
  yield* registry.addSession(cwd, "s", "Test session");
  return registry;
});

test("webhook preferences survive restart; token is write-only, preserved, replaced and cleared", async () => {
  let id = "";
  const requests: Received[] = [];
  await run(
    "persist",
    Effect.gen(function* () {
      const hooks = yield* Webhooks;
      const saved = yield* hooks.save({ ...input, token: "private-canary" });
      id = saved.id;
      assert.equal(saved.hasToken, true);
      assert.equal(JSON.stringify(saved).includes("private-canary"), false);
      assert.equal(JSON.stringify(yield* hooks.list).includes("private-canary"), false);
      assert.equal(JSON.stringify(yield* (yield* Registry).get).includes("private-canary"), false);
      yield* hooks.save({ ...input, id, active: false, url: "https://changed.example/hook" });
    }),
    receive(requests),
  );
  await run(
    "persist",
    Effect.gen(function* () {
      const hooks = yield* Webhooks;
      assert.deepEqual(
        (yield* hooks.list).map((h) => [h.id, h.active, h.url, h.hasToken, h.lastDelivery]),
        [[id, false, "https://changed.example/hook", true, null]],
      );
      yield* hooks.test(id);
      assert.equal(requests.at(-1)!.headers.get("authorization"), "Bearer private-canary");
      yield* hooks.save({ ...input, id, token: "replacement" });
      yield* hooks.test(id);
      assert.equal(requests.at(-1)!.headers.get("authorization"), "Bearer replacement");
      yield* hooks.save({ ...input, id, token: null });
    }),
    receive(requests),
  );
  await run(
    "persist",
    Effect.gen(function* () {
      const hooks = yield* Webhooks;
      assert.equal((yield* hooks.list)[0].hasToken, false);
      yield* hooks.test(id);
      assert.equal(requests.at(-1)!.headers.has("authorization"), false);
      yield* hooks.remove(id);
    }),
    receive(requests),
  );
  await run(
    "persist",
    Effect.gen(function* () {
      assert.deepEqual(yield* (yield* Webhooks).list, []);
    }),
  );
});

test("subscription/active filtering is paired with positive delivery; payloads are bounded, explicit and path-free", async () => {
  const requests: Received[] = [];
  await run(
    "payload",
    Effect.gen(function* () {
      const registry = yield* registered;
      const entry = (yield* registry.get).sessions[0];
      yield* registry.setSessionLink(entry, "pullRequest", {
        url: "https://github.com/acme/project/pull/123",
        source: "manual",
      });
      const hooks = yield* Webhooks;
      const completed = yield* hooks.save({ ...input, token: "secret-canary" });
      const all = yield* hooks.save({ ...input, events: WEBHOOK_EVENTS });
      const inactive = yield* hooks.save({ ...input, active: false, events: WEBHOOK_EVENTS });
      yield* hooks.emit("session.completed", cwd, "s", snapshot);
      const dialog: Snapshot = {
        ...emptySnapshot("s"),
        dialogs: [
          {
            id: "d",
            generation: "g",
            receivedAt: 0,
            deadlineAt: 9999,
            deadlineKind: "pi-timeout",
            method: "select",
            title: "Choose",
            options: ["yes", "no"],
          },
        ],
      };
      yield* hooks.emit("session.needs_input", cwd, "s", dialog);
      yield* hooks.emit("session.failed", cwd, "s", {
        ...snapshot,
        state: {
          ...snapshot.state,
          closure: {
            _tag: "exited",
            code: 3,
            detail: `Failed in ${cwd} /tmp/elsewhere secret-canary`,
          },
        },
      });
      // Stops the browser does not flag are not failures: a quiet release and a clean exit.
      for (const closure of [
        { _tag: "released", detail: "Released" },
        { _tag: "exited", code: 0, detail: "Pi exited with code 0" },
      ] as const)
        yield* hooks.emit("session.failed", cwd, "s", {
          ...snapshot,
          state: { ...snapshot.state, closure },
        });
      // Emit admits synchronously, so once the subscribed deliveries arrive nothing else is queued;
      // the inactive hook still answers its Test, so its receiver can be heard.
      yield* wait(() => requests.length === 4);
      assert.equal((yield* hooks.test(inactive.id)).status, "delivered");
      const live = requests.filter((r) => r.body.event !== "ping");
      assert.equal(live.filter((r) => r.headers.get("x-piano-hook-id") === completed.id).length, 1);
      assert.equal(live.filter((r) => r.headers.get("x-piano-hook-id") === all.id).length, 3);
      assert.equal(live.filter((r) => r.headers.get("x-piano-hook-id") === inactive.id).length, 0);
      const body = live[0].body;
      assert.equal(body.answer, "x".repeat(2000));
      assert.equal(body.answerTruncated, true);
      assert.equal(body.action, null);
      assert.equal(body.source, "piano");
      assert.equal(body.version, 1);
      assert.deepEqual(body.session, {
        id: "s",
        title: "Test session",
        url: "https://piano.example/s/s",
        model: null,
      });
      assert.deepEqual(body.pullRequest, {
        number: 123,
        url: "https://github.com/acme/project/pull/123",
        state: null,
      });
      assert.equal(body.workspace?.folder, "checkout");
      const question = live.find((r) => r.body.event === "session.needs_input")!.body;
      assert.equal(question.action, "Answer in Piano: https://piano.example/s/s");
      assert.deepEqual(question.question, {
        kind: "select",
        title: "Choose",
        message: null,
        options: ["yes", "no"],
      });
      const failure = live.find((r) => r.body.event === "session.failed")!.body;
      assert.equal(failure.failure?.reason, "exited");
      assert.equal(failure.failure?.exitCode, 3);
      assert.equal(failure.action, "Open session in Piano: https://piano.example/s/s");
      assert.equal(JSON.stringify(failure).includes(cwd), false);
      assert.equal(JSON.stringify(failure).includes("/tmp/"), false);
      assert.equal(JSON.stringify(failure).includes("secret-canary"), false);
      const ping = requests.at(-1)!.body;
      assert.equal(ping.ignore, true);
      assert.equal(ping.workspace, null);
      assert.equal(ping.session, null);
      assert.equal(ping.pullRequest, null);
      assert.equal(ping.action, null);
      const ids = new Set(requests.map((r) => r.body.deliveryId));
      assert.equal(ids.size, requests.length);
      for (const r of requests) {
        assert.match(r.body.deliveryId, /^[0-9a-f-]{36}$/);
        assert.equal(r.headers.get("x-piano-delivery"), r.body.deliveryId);
        assert.equal(r.headers.get("x-piano-event"), r.body.event);
        assert.equal(r.headers.get("user-agent"), "Piano-Webhook/1");
        assert.equal(r.headers.get("content-type"), "application/json");
        assert.ok(r.body.occurredAt);
        assert.equal("cwd" in r.body, false);
        assert.equal("summary" in r.body, false);
        assert.equal("hookId" in r.body, false);
      }
      yield* registry.setSessionLink((yield* registry.get).sessions[0], "pullRequest", null);
      yield* hooks.emit("session.completed", cwd, "s", {
        ...snapshot,
        messages: [{ ...snapshot.messages[0], text: "short" }],
      });
      yield* wait(() => requests.some((r) => r.body.answer === "short"));
      const short = requests.find((r) => r.body.answer === "short")!.body;
      assert.equal(short.answerTruncated, false);
      assert.equal(short.pullRequest, null);
    }),
    receive(requests),
  );
});

test("a webhook token is redacted whole before the answer is cut, even across the cut", async () => {
  const requests: Received[] = [];
  const token = "tok0abcdefghijklmnopqrstuvwxyz0123456789";
  assert.equal(token.length, 40);
  const answered = (text: string): Snapshot => ({
    ...snapshot,
    messages: [{ ...snapshot.messages[0], text }],
  });
  await run(
    "redact-before-cut",
    Effect.gen(function* () {
      yield* registered;
      const hooks = yield* Webhooks;
      yield* hooks.save({ ...input, token });
      const b = yield* hooks.save(input);
      yield* hooks.emit("session.completed", cwd, "s", answered(`${"x".repeat(100)} ${token}`));
      // The token spans characters 1,982-2,021; the tail keeps the redacted answer over 2,000.
      yield* hooks.emit(
        "session.completed",
        cwd,
        "s",
        answered(`${"x".repeat(1980)} ${token} ${"y".repeat(100)}`),
      );
      yield* hooks.emit("session.completed", cwd, "s", answered("z".repeat(LAST_ANSWER_CHARS)));
      const fromB = () => requests.filter((r) => r.headers.get("x-piano-hook-id") === b.id);
      yield* wait(() => fromB().length === 3);
      const [whole, straddling, exact] = fromB().map((r) => r.body);
      assert.equal(whole.answer, `${"x".repeat(100)} [redacted]`);
      assert.equal(whole.answerTruncated, false);
      assert.equal(straddling.answerTruncated, true);
      assert.equal(straddling.answer?.length, LAST_ANSWER_CHARS);
      assert.equal(exact.answer?.length, LAST_ANSWER_CHARS);
      assert.equal(exact.answerTruncated, false);
      assert.ok(straddling.answer?.startsWith(`${"x".repeat(1980)} [redacted] y`));
      for (let i = 0; i + 8 <= token.length; i++)
        assert.equal(straddling.answer?.includes(token.slice(i, i + 8)), false);
    }),
    receive(requests),
  );
});

test("an answer cut at an emoji leaves the emoji out whole, and is flagged truncated", async () => {
  const requests: Received[] = [];
  const answered = (text: string): Snapshot => ({
    ...snapshot,
    messages: [{ ...snapshot.messages[0], text }],
  });
  await run(
    "surrogate-cut",
    Effect.gen(function* () {
      yield* registered;
      const hooks = yield* Webhooks;
      yield* hooks.save(input);
      // The emoji's two UTF-16 units sit at 1,999-2,000, across the limit.
      const head = "x".repeat(LAST_ANSWER_CHARS - 1);
      yield* hooks.emit("session.completed", cwd, "s", answered(`${head}\u{1F600} tail`));
      yield* wait(() => requests.length === 1);
      const [body] = requests.map((r) => r.body);
      assert.ok(body.answer === head, `answer ends ${JSON.stringify(body.answer?.slice(-3))}`);
      assert.equal(body.answerTruncated, true);
    }),
    receive(requests),
  );
});

test("a save that omits url and events keeps the stored ones; a removed hook stays removed", async () => {
  await run(
    "partial",
    Effect.gen(function* () {
      const hooks = yield* Webhooks;
      const { id } = yield* hooks.save(input);
      yield* hooks.save({
        id,
        url: "https://edited.example/hook",
        events: ["session.failed", "session.needs_input"],
        active: true,
      });
      // The Active switch sends only what it changes, from a list that may predate the edit.
      yield* hooks.save({ id, active: false });
      assert.deepEqual(
        (yield* hooks.list).map((h) => [h.url, h.events, h.active]),
        [["https://edited.example/hook", ["session.failed", "session.needs_input"], false]],
      );
      yield* hooks.remove(id);
      const after = yield* hooks.save({ id, active: true }).pipe(Effect.flip);
      assert.equal(after.detail, "Webhook no longer exists.");
      assert.deepEqual(yield* hooks.list, []);
      const created = yield* hooks.save({ active: true }).pipe(Effect.flip);
      assert.equal(created.detail, "Enter a URL and select at least one event.");
    }),
  );
});

test("a refusal names the field it belongs to", async () => {
  await run(
    "fields",
    Effect.gen(function* () {
      const hooks = yield* Webhooks;
      const token = yield* hooks.save({ ...input, token: "a b" }).pipe(Effect.flip);
      assert.equal(token.field, "token");
      // A short token would redact ordinary words out of every webhook's payload.
      const short = yield* hooks.save({ ...input, token: "test" }).pipe(Effect.flip);
      assert.deepEqual([short.field, short.detail], ["token", "Use at least 8 characters."]);
      assert.equal((yield* hooks.save({ ...input, token: "12345678" })).hasToken, true);
      const url = yield* hooks
        .save({ ...input, url: "ftp://receiver.example/x" })
        .pipe(Effect.flip);
      assert.equal(url.field, "url");
      const gone = yield* hooks.save({ ...input, id: "missing" }).pipe(Effect.flip);
      assert.equal(gone.field, undefined);
    }),
  );
});

test("URL and token validation refuse unsafe transport without echoing secrets", async () => {
  await run(
    "validation",
    Effect.gen(function* () {
      const hooks = yield* Webhooks;
      for (const url of [
        "http://receiver.example",
        "https://user:private-canary@example.com",
        "file:///tmp/private-canary",
        "https://example.com/#private-canary",
      ]) {
        const result = yield* hooks.save({ ...input, url }).pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        assert.equal(JSON.stringify(result).includes("private-canary"), false);
      }
      assert.equal(
        (yield* hooks.save({ ...input, events: [] }).pipe(Effect.result))._tag,
        "Failure",
      );
      assert.equal(
        (yield* hooks
          .save({ ...input, token: "private-canary\r\nInjected: yes" })
          .pipe(Effect.result))._tag,
        "Failure",
      );
      for (const url of ["http://127.0.0.1:1234", "http://localhost:1234", "http://[::1]:1234"])
        yield* hooks.save({ ...input, url });
    }),
  );
});

test("admission stays bounded under a stalled receiver, a Test goes ahead of it; logs never hold secrets", async () => {
  const requests: Received[] = [];
  const logs: unknown[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await receive(requests)(url, init);
    if (first) {
      first = false;
      await held;
      throw new Error("private-canary https://receiver.example/events payload");
    }
    return response;
  };
  await run(
    "capacity",
    Effect.gen(function* () {
      yield* registered;
      const hooks = yield* Webhooks;
      const hook = yield* hooks.save({ ...input, token: "private-canary" });
      const test = yield* hooks.test(hook.id).pipe(Effect.forkChild);
      yield* wait(() => requests.length === 1);
      for (let i = 0; i < 100; i++) yield* hooks.emit("session.completed", cwd, "s", snapshot);
      assert.equal(
        requests.length,
        1,
        "admission did not wait for delivery or start unbounded fetches",
      );
      // A Test checks this very receiver: it goes ahead of the full backlog, not behind or refused.
      const again = yield* hooks.test(hook.id).pipe(Effect.forkChild);
      release();
      assert.equal((yield* Fiber.join(test)).status, "failed");
      assert.equal((yield* Fiber.join(again)).status, "delivered");
      assert.equal(requests[1]?.body.event, "ping", "the Test is the next request");
      yield* wait(() => requests.length === 34);
      assert.equal(requests.filter((r) => r.body.event === "session.completed").length, 32);
      assert.ok(logs.length > 0, "overflow is logged");
      assert.doesNotMatch(JSON.stringify(logs), /private-canary|receiver\.example|payload/);
    }).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ message }) => {
            logs.push(message);
          }),
        ]),
      ),
    ),
    fetch,
  );
});

test("one webhook's backlog never drops another webhook's deliveries or Test", async () => {
  const requests: Received[] = [];
  const logs: unknown[] = [];
  // Receiver A never answers; B answers at once.
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await receive(requests)(url, init);
    if (String(url).startsWith("https://stuck.example"))
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    return response;
  };
  await run(
    "per-hook",
    Effect.gen(function* () {
      yield* registered;
      const hooks = yield* Webhooks;
      const stuck = yield* hooks.save({ ...input, url: "https://stuck.example/events" });
      const healthy = yield* hooks.save({ ...input, events: ["session.failed"] });
      for (let i = 0; i < 100; i++) yield* hooks.emit("session.completed", cwd, "s", snapshot);
      yield* wait(() => requests.length === 1);
      assert.ok(logs.length > 0, "the stuck webhook's own overflow is dropped and logged");
      yield* hooks.emit("session.failed", cwd, "s", {
        ...snapshot,
        state: { ...snapshot.state, closure: { _tag: "exited", code: 3, detail: "boom" } },
      });
      const ping = yield* hooks.test(healthy.id).pipe(Effect.result);
      assert.equal(ping._tag, "Success", JSON.stringify(ping));
      const toHealthy = () =>
        requests.filter((r) => r.headers.get("x-piano-hook-id") === healthy.id);
      yield* wait(() => toHealthy().length === 2);
      assert.deepEqual(
        toHealthy()
          .map((r) => r.body.event)
          .sort(),
        ["ping", "session.failed"],
      );
      assert.equal(
        requests.filter((r) => r.headers.get("x-piano-hook-id") === stuck.id).length,
        1,
        "the stuck webhook still has one request in flight",
      );
    }).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ message }) => {
            logs.push(message);
          }),
        ]),
      ),
    ),
    fetch,
  );
});

test("a test queued behind a slow delivery answers, and sends nothing, once its webhook is deleted", async () => {
  const requests: Received[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await receive(requests)(url, init);
    await held;
    return response;
  };
  await run(
    "test-deleted",
    Effect.gen(function* () {
      yield* registered;
      const hooks = yield* Webhooks;
      const hook = yield* hooks.save({ ...input, token: "private-canary" });
      yield* hooks.emit("session.completed", cwd, "s", snapshot);
      yield* wait(() => requests.length === 1);
      const test = yield* hooks.test(hook.id).pipe(Effect.result, Effect.forkChild);
      // Let the test pass admission, which still finds the webhook, and wait in its lane.
      yield* Effect.sleep(50);
      yield* hooks.remove(hook.id);
      release();
      const answer = yield* Fiber.join(test);
      assert.equal(answer._tag, "Failure");
      assert.match(JSON.stringify(answer), /Webhook no longer exists\./);
      assert.deepEqual(
        requests.map((r) => r.body.event),
        ["session.completed"],
      );
    }),
    fetch,
  );
});

test("real HTTP: redirects/non-2xx fail, a dead receiver times out without blocking other hooks", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    if (req.url === "/dead") return;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/leak" });
      res.end();
    } else {
      res.writeHead(req.url === "/fail" ? 500 : 204);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run(
      "http",
      Effect.gen(function* () {
        const hooks = yield* Webhooks;
        const slow = yield* hooks.save({ ...input, url: `${url}/dead` });
        const fast = yield* hooks.save({ ...input, url: `${url}/ok` });
        const started = Date.now();
        const dead = yield* hooks.test(slow.id).pipe(Effect.forkChild);
        yield* wait(() => paths.includes("/dead"));
        // Answered well before the dead receiver's request times out.
        assert.equal((yield* hooks.test(fast.id).pipe(Effect.timeout(1500))).httpStatus, 204);
        for (const path of ["redirect", "fail"]) {
          const hook = yield* hooks.save({ ...input, url: `${url}/${path}` });
          const result = yield* hooks.test(hook.id);
          assert.equal(result.status, "failed");
          assert.equal(result.httpStatus, path === "fail" ? 500 : null);
        }
        const timedOut = yield* Fiber.join(dead);
        assert.equal(timedOut.status, "failed");
        assert.equal(timedOut.httpStatus, null);
        assert.ok(Date.now() - started >= 2900);
        assert.deepEqual(paths.sort(), ["/dead", "/fail", "/ok", "/redirect"]);
      }),
      globalThis.fetch,
      3000,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("live fake-Pi completion/dialog/exit drive the worker once; opening history never replays", async () => {
  const requests: Received[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const hooks = yield* Webhooks,
        hosts = yield* SessionHosts;
      yield* registered;
      const all = yield* hooks.save({ ...input, events: WEBHOOK_EVENTS });
      const complete = yield* hooks.save(input);
      const inactive = yield* hooks.save({ ...input, events: WEBHOOK_EVENTS, active: false });
      const session = yield* hosts.open({ cwd, sessionId: "s" });
      yield* session.act({ _tag: "prompt", text: "notification success" });
      yield* wait(() => requests.filter((r) => r.body.event === "session.completed").length === 2);
      // A new attachment only observes a snapshot; no completion replay or cancellation.
      yield* session.events.pipe(Stream.take(1), Stream.runCollect);
      yield* session.act({ _tag: "prompt", text: "ask choose" });
      yield* wait(() => requests.some((r) => r.body.event === "session.needs_input"));
      yield* session.act({ _tag: "abort" });
      yield* session.act({ _tag: "prompt", text: "crash now" }).pipe(Effect.ignore);
      yield* wait(() => requests.some((r) => r.body.event === "session.failed"));
      yield* hosts.read(cwd, "s");
      for (const hook of [all, complete, inactive]) yield* hooks.test(hook.id);
      const live = requests.filter((r) => r.body.event !== "ping");
      assert.deepEqual(
        live.filter((r) => r.headers.get("x-piano-hook-id") === all.id).map((r) => r.body.event),
        WEBHOOK_EVENTS,
      );
      assert.deepEqual(
        live
          .filter((r) => r.headers.get("x-piano-hook-id") === complete.id)
          .map((r) => r.body.event),
        ["session.completed"],
      );
      assert.equal(live.filter((r) => r.headers.get("x-piano-hook-id") === inactive.id).length, 0);
      // Archive and delete stop Pi mid-work because the person asked: not a failure.
      const stopMidWork = (id: string, stop: Effect.Effect<void, unknown>) =>
        Effect.gen(function* () {
          yield* (yield* Registry).addSession(cwd, id);
          const working = yield* hosts.open({ cwd, sessionId: id });
          yield* working.act({ _tag: "prompt", text: "ask before release" });
          yield* wait(() =>
            requests.some(
              (r) => r.body.session?.id === id && r.body.event === "session.needs_input",
            ),
          );
          yield* stop;
        });
      yield* stopMidWork("archived", hosts.archive(cwd, "archived"));
      yield* stopMidWork("deleted", hosts.delete(cwd, "deleted"));
      // Delivery is in order per hook, so Test arriving means their events would have too.
      yield* hooks.test(all.id);
      assert.deepEqual(
        requests.filter((r) => r.body.event === "session.failed").map((r) => r.body.session?.id),
        ["s"],
      );
    }).pipe(live("live", requests)),
  );
});

test("a Piano shutdown during work announces nothing, as shutdown drops pending work", async () => {
  const requests: Received[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const hooks = yield* Webhooks,
        hosts = yield* SessionHosts;
      yield* registered;
      yield* hooks.save({ ...input, events: WEBHOOK_EVENTS });
      const session = yield* hosts.open({ cwd, sessionId: "s" });
      yield* session.act({ _tag: "prompt", text: "ask before release" });
      yield* wait(() => requests.some((r) => r.body.event === "session.needs_input"));
    }).pipe(live("shutdown", requests)),
  );
  // The scope has closed, as at shutdown, with Pi still waiting on its dialog; nothing is left
  // to send afterwards. A crash's session.failed arrives in the test above.
  assert.deepEqual(
    requests.map((r) => r.body.event),
    ["session.needs_input"],
  );
});
