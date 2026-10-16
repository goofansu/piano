import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Clock, Effect, Layer } from "effect";
import { PiHistory } from "../server/PiHistory.ts";
import { Registry } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

let server: RouterFixture;
let clockOffset = 0;
before(async () => {
  const clock = Clock.Clock.defaultValue();
  const shifted: Clock.Clock = Object.create(clock, {
    currentTimeMillis: { value: Effect.sync(() => clock.currentTimeMillisUnsafe() + clockOffset) },
    currentTimeMillisUnsafe: { value: () => clock.currentTimeMillisUnsafe() + clockOffset },
  });
  server = await startRouter("piano-api-writes-", Layer.succeed(Clock.Clock, shifted));
});
after(() => server?.dispose());
const post = async (path: string, body: unknown) => {
  const response = await server.api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const pathFor = (body: { workspaceId: string; sessionId: string }) =>
  `workspaceId=${body.workspaceId}&sessionId=${body.sessionId}`;
const until = async (query: string, predicate: (body: Record<string, unknown>) => boolean) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await server.api(`/api/v1/sessions?${query}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    if (predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("API state deadline");
};

test("create/send dedupe concurrent retries; return before acknowledgement; busy rejects, steer counts and stop kills", async () => {
  const input = { cwd: server.repo, prompt: "withhold acknowledgement", requestId: "create-1" };
  const responses = await Promise.all([
    post("/api/v1/sessions", input),
    post("/api/v1/sessions", input),
  ]);
  assert.equal(responses[0].status, 200);
  assert.deepEqual(responses[1], responses[0]);
  const created = responses[0].body;
  assert.equal(created.seq, 1);
  const query = pathFor(created);
  const running = await until(query, (b) => b.status === "running");
  assert.equal(running.completedSeq, 0);
  assert.deepEqual(await post(`/api/v1/sessions/messages?${query}`, { prompt: "again" }), {
    status: 409,
    body: { error: "Session is busy." },
  });
  const messages = { prompt: "queued steer", mode: "steer", requestId: "message-1" };
  const steers = await Promise.all([
    post(`/api/v1/sessions/messages?${query}`, messages),
    post(`/api/v1/sessions/messages?${query}`, messages),
  ]);
  assert.deepEqual(steers, [
    { status: 200, body: { seq: 2 } },
    { status: 200, body: { seq: 2 } },
  ]);
  // requestId is global: even another endpoint returns the original body without acting.
  assert.deepEqual(
    await post(`/api/v1/sessions/messages?${query}`, { prompt: "ignored", requestId: "create-1" }),
    responses[0],
  );
  assert.deepEqual(await post(`/api/v1/sessions/abort?${query}`, { stop: true }), {
    status: 200,
    body: { ok: true },
  });
  const stopped = await until(query, (b) => b.hosted === false && b.completedSeq === 2);
  assert.ok(stopped.status === "idle" || stopped.status === "error");
  if (stopped.status === "error") assert.ok(stopped.detail);
  assert.deepEqual(await server.run(Effect.flatMap(SessionHosts, (h) => h.list)), []);
  assert.deepEqual(await post(`/api/v1/sessions/abort?${query}`, {}), {
    status: 200,
    body: { ok: true },
  });
});

test("API-owned dialogs auto-cancel, while a browser-owned pending dialog remains waiting", async () => {
  const browser = await server.run(
    Effect.gen(function* () {
      const session = yield* (yield* SessionHosts).create({ cwd: server.repo, options: {} });
      yield* session.act({ _tag: "prompt", text: "ask browser" });
      return session;
    }),
  );
  const query = pathFor({ workspaceId: server.workspaceId, sessionId: browser.spec.sessionId });
  const waiting = await until(query, (b) => b.status === "waiting");
  assert.equal(waiting.detail, "Enter a value");
  const list = await (await server.api("/api/v1/sessions/list")).json();
  assert.equal(
    list.find((s: { sessionId: string }) => s.sessionId === browser.spec.sessionId).status,
    "waiting",
  );
  assert.equal((await post(`/api/v1/sessions/messages?${query}`, { prompt: "again" })).status, 409);
  // API steering takes ownership and cancels a dialog that was already pending.
  assert.deepEqual(
    await post(`/api/v1/sessions/messages?${query}`, { prompt: "handled queue", mode: "steer" }),
    { status: 200, body: { seq: 2 } },
  );
  await until(query, (b) => b.status === "idle" && b.completedSeq === 2);
  const snapshot = await server.run(browser.snapshot);
  assert.equal(snapshot.dialogs.length, 0);
  assert.equal(snapshot.state.dialogResolution?.reason, "cancelled");
  assert.equal(snapshot.state.dialogResolution?.delivery, "written");
  const created = await post("/api/v1/sessions", { cwd: server.repo, prompt: "ask API" });
  assert.equal(created.status, 200);
  const done = await until(
    pathFor(created.body),
    (b) => b.status === "idle" && b.completedSeq === 1,
  );
  assert.match(done.lastAssistantMessage, /you said/);
});

test("API ownership also cancels a dialog opened during creation, before the first prompt", async () => {
  const created = await post("/api/v1/sessions", {
    cwd: server.repo,
    model: "fake/startup-dialog",
    prompt: "hello",
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const done = await until(
    pathFor(created.body),
    (b) => b.status === "idle" && b.completedSeq === 1,
  );
  assert.equal(done.lastAssistantMessage, "echo: hello");
  const snapshot = await server.run(
    Effect.gen(function* () {
      const session = yield* (yield* SessionHosts).get(server.repo, created.body.sessionId);
      assert.ok(session);
      return yield* session.snapshot;
    }),
  );
  assert.equal(snapshot.state.dialogResolution?.reason, "cancelled");
});

test("API initial creation waits for startup cancellation readback before delivering its prompt", {
  timeout: 5000,
}, async (t) => {
  const waiting = join(server.repo, ".startup-readback-waiting");
  const release = join(server.repo, ".startup-readback-release");
  let watcher: ReturnType<typeof watch>;
  const blocked = new Promise<"blocked">((resolve) => {
    watcher = watch(server.repo, () => {
      if (existsSync(waiting)) resolve("blocked");
    });
  });
  t.after(() => {
    watcher.close();
    // Release even on assertion failure so cleanup never leaves a held Pi query.
    writeFileSync(release, "release");
  });
  const created = post("/api/v1/sessions", {
    cwd: server.repo,
    model: "fake/startup-dialog-gated",
    prompt: "after startup settles",
  });
  assert.equal(await Promise.race([blocked, created.then(() => "responded")]), "blocked");
  writeFileSync(release, "release");
  const response = await created;
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.seq, 1);
  const done = await until(
    pathFor(response.body),
    (b) => b.status === "idle" && b.completedSeq === 1,
  );
  assert.equal(done.lastAssistantMessage, "echo: after startup settles");
});

test("a removed registered checkout rejects API input without reopening Pi", async () => {
  const cwd = join(server.root, "removed");
  mkdirSync(cwd);
  await server.run(Effect.flatMap(Registry, (r) => r.ensureFolder(cwd)));
  const created = await post("/api/v1/sessions", { cwd, prompt: "hello" });
  assert.equal(created.status, 200);
  const query = pathFor(created.body);
  await until(query, (b) => b.completedSeq === 1);
  rmSync(cwd, { recursive: true });
  assert.equal((await post(`/api/v1/sessions/messages?${query}`, { prompt: "again" })).status, 409);
  const hosts = await server.run(Effect.flatMap(SessionHosts, (h) => h.list));
  assert.equal(
    hosts.some((h) => h.sessionId === created.body.sessionId),
    false,
  );
});

test("unregistered cwd and invalid messages refuse without creating work; successful IDs expire after ten minutes", async () => {
  assert.deepEqual(await post("/api/v1/sessions", { cwd: "/nope", prompt: "x" }), {
    status: 400,
    body: { error: "cwd is not a registered folder." },
  });
  assert.equal((await post("/api/v1/sessions", { cwd: server.repo, prompt: "" })).status, 400);
  assert.equal((await post("/api/v1/sessions/messages", { prompt: "x" })).status, 400);
  assert.equal((await post("/api/v1/sessions/abort?workspaceId=x&sessionId=x", {})).status, 404);
  const input = { cwd: server.repo, prompt: "hello", requestId: "expires" };
  const first = await post("/api/v1/sessions", input);
  await until(pathFor(first.body), (b) => b.completedSeq === 1);
  clockOffset += 9 * 60_000;
  assert.deepEqual(await post("/api/v1/sessions", input), first);
  clockOffset += 60_001;
  const next = await post("/api/v1/sessions", input);
  assert.equal(next.status, 200);
  assert.notEqual(next.body.sessionId, first.body.sessionId);
});

test("API create delivers its first prompt through the new host without any history scans", async (t) => {
  const locate = t.mock.method(PiHistory, "locate");
  const list = t.mock.method(SessionManager, "list");
  const input = { cwd: server.repo, prompt: "first prompt without scans", requestId: "no-scans" };
  const created = await post("/api/v1/sessions", input);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.workspaceId, server.workspaceId);
  assert.equal(created.body.seq, 1);
  assert.deepEqual(await post("/api/v1/sessions", input), created);
  // A second resolve after registration would call locate, even with an already live host.
  assert.equal(locate.mock.callCount(), 0);
  assert.equal(list.mock.callCount(), 0);
  const entry = await server.run(
    Effect.flatMap(Registry, (r) => r.sessionIn(server.workspaceId, created.body.sessionId)),
  );
  assert.equal(entry.session.seq, 1);
  // Polling is deliberately outside the zero-scan assertion: ordinary reads still resolve.
  const done = await until(
    pathFor(created.body),
    (b) => b.status === "idle" && b.completedSeq === 1,
  );
  assert.equal(done.lastAssistantMessage, "echo: first prompt without scans");
});
