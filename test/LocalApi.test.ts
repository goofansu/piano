import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Effect } from "effect";
import { Registry } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

let server: RouterFixture;
before(async () => {
  server = await startRouter("piano-local-api-");
});
after(() => server.dispose());
const get = async (path: string) => {
  const response = await server.api(path);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
async function until(path: string, predicate: (body: Awaited<ReturnType<typeof get>>) => boolean) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const body = await get(path);
    if (predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("API state deadline");
}

test("INV-11: API is absent from the main listener; local routes reject every Origin and serve nothing else", async () => {
  for (const method of ["GET", "POST", "OPTIONS"])
    assert.equal((await server.handle("/api/v1/sessions/list", { method })).status, 404);
  for (const origin of ["https://yejun-dev.exe.xyz", "null", "", "http://piano.test"]) {
    const response = await server.api("/api/v1/sessions/list", { headers: { origin } });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Origin not allowed on API." });
  }
  for (const path of ["/", "/api/folders", "/ws", "/api/v1/nope"]) {
    const response = await server.api(path);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found." });
  }
  assert.deepEqual(await get("/api/v1/sessions/list"), []);
  assert.equal((await server.api("/api/v1/sessions")).status, 400);
  assert.equal((await server.api("/api/v1/sessions?workspaceId=no&sessionId=no")).status, 404);
});

test("INV-01/02/03: browser prompts count, reads never reopen Pi, completed counters and errors survive release", async () => {
  const session = await server.run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const session = yield* hosts.create({ cwd: server.repo, options: {} });
      yield* session.act({ _tag: "prompt", text: "hello" });
      return session;
    }),
  );
  const path = `/api/v1/sessions?workspaceId=${server.workspaceId}&sessionId=${session.spec.sessionId}`;
  const done = await until(path, (b) => b.status === "idle" && b.completedSeq === 1);
  assert.equal(done.seq, 1);
  assert.equal(done.hosted, true);
  assert.ok(done.lastAssistantMessage);
  // This fake does not write Pi history; seed the authoritative file before retiring it.
  writeFileSync(
    join(server.root, "sessions", "saved.jsonl"),
    [
      {
        type: "session",
        version: 3,
        id: session.spec.sessionId,
        cwd: server.repo,
        timestamp: "2026-10-05T00:00:00Z",
      },
      {
        type: "message",
        id: "saved",
        parentId: null,
        timestamp: "2026-10-05T00:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: done.lastAssistantMessage }],
          timestamp: 1,
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );
  await server.run(
    Effect.gen(function* () {
      yield* (yield* SessionHosts).release(server.repo, session.spec.sessionId);
    }),
  );
  const released = await get(path);
  assert.equal(released.hosted, false);
  assert.equal(released.status, "idle");
  assert.equal(released.seq, 1);
  assert.equal(released.completedSeq, 1);
  assert.equal(released.lastAssistantMessage, done.lastAssistantMessage);
  const list = await get("/api/v1/sessions/list");
  assert.deepEqual(list, [
    {
      workspaceId: server.workspaceId,
      sessionId: session.spec.sessionId,
      cwd: server.repo,
      status: "idle",
      hosted: false,
    },
  ]);
  assert.deepEqual(await server.run(Effect.flatMap(SessionHosts, (h) => h.list)), []);
  // The general fake only supports --session-id, not loading a saved --session file.
  rmSync(join(server.root, "sessions", "saved.jsonl"));
  await server.run(
    Effect.gen(function* () {
      const reopened = yield* (yield* SessionHosts).open(session.spec);
      yield* reopened.act({ _tag: "prompt", text: "reject input" }).pipe(Effect.ignore);
    }),
  );
  const failed = await until(path, (b) => b.status === "error" && b.completedSeq === 2);
  assert.equal(failed.seq, 2);
  assert.match(failed.detail, /input rejected/);
  await server.run(
    Effect.flatMap(SessionHosts, (h) => h.release(server.repo, session.spec.sessionId)),
  );
  assert.equal((await get(path)).status, "error");
  const entry = await server.run(
    Effect.flatMap(Registry, (r) => r.sessionIn(server.workspaceId, session.spec.sessionId)),
  );
  assert.equal(entry.session.lastStatus, "error");
});

test("turn completion observes quiescence after the final state event's readback drains", async () => {
  const session = await server.run(
    Effect.gen(function* () {
      const session = yield* (yield* SessionHosts).create({ cwd: server.repo, options: {} });
      yield* session.act({ _tag: "prompt", text: "late stats" });
      return session;
    }),
  );
  const path = `/api/v1/sessions?workspaceId=${server.workspaceId}&sessionId=${session.spec.sessionId}`;
  const done = await until(path, (b) => b.status === "idle" && b.completedSeq === 1);
  assert.equal(done.lastAssistantMessage, "echo: late stats");
});
