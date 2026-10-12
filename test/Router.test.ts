import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Effect, Layer } from "effect";
import { SessionHosts } from "../server/SessionHosts.ts";
import { WorkspaceRevisions } from "../server/WorkspaceRevisions.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

// The router's half of shared/http.ts, observed over HTTP the way any client sees it.
let server: RouterFixture;
before(async () => {
  // A capture that answers outside WorkspaceCapture, to observe the response contract.
  const offContract = Layer.succeed(WorkspaceRevisions, {
    capture: () => Effect.succeed({ candidate: "not a manifest" } as never),
  });
  server = await startRouter("piano-router-", offContract);
});
after(() => server.dispose());

const post = (path: string, body?: string) =>
  server.handle(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
  });
const reply = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

test("a decoded body and the resolved workspace reach the handler; the reply is the contract's JSON", async () => {
  const { status, body } = await reply(
    await post(
      `/api/workspace/changes/file?workspaceId=${server.workspaceId}`,
      JSON.stringify({ path: "README.md" }),
    ),
  );
  assert.equal(status, 200);
  assert.deepEqual(body.workspace, {
    id: server.workspaceId,
    folder: server.repo,
    path: server.repo,
  });
  assert.equal(body.result.status, "ready");
  assert.match(body.result.diff, /\+two/);
});

test("INV-07: IDs resolve through the registry; a missing ID is malformed and an unknown one is not found", async () => {
  assert.deepEqual(await reply(await post("/api/workspace/changes?workspaceId=nope")), {
    status: 404,
    body: { error: "Workspace is not registered. Refresh the folder list." },
  });
  assert.deepEqual(await reply(await post("/api/workspace/changes")), {
    status: 400,
    body: { error: "Workspace ID is required." },
  });
  const pr = (query: string) => server.handle(`/api/session/pull-request?${query}`);
  assert.deepEqual(await reply(await pr(`workspaceId=${server.workspaceId}`)), {
    status: 400,
    body: { error: "Workspace and session IDs are required." },
  });
  assert.deepEqual(await reply(await pr(`workspaceId=${server.workspaceId}&sessionId=unknown`)), {
    status: 404,
    body: { error: "Session is not registered in this workspace. Refresh the session list." },
  });
});

test("a body outside the endpoint's Schema is answered 400 with the endpoint's message, before any work", async () => {
  const file = `/api/workspace/changes/file?workspaceId=${server.workspaceId}`;
  for (const body of [undefined, "not json", "{}", JSON.stringify({ path: 7 })]) {
    assert.deepEqual(
      await reply(await post(file, body)),
      { status: 400, body: { error: "File path is required in the request body." } },
      `body ${body}`,
    );
  }
  assert.deepEqual(
    await reply(await post("/api/settings/radius", JSON.stringify({ action: "remove-mcp" }))),
    { status: 400, body: { error: "Invalid Radius setup action." } },
    "removal names the reviewed configuration",
  );
  assert.deepEqual(
    await reply(
      await server.handle("/api/provider-login", {
        method: "PUT",
        body: JSON.stringify({ id: "a", promptId: "b", value: "x".repeat(16_385) }),
      }),
    ),
    { status: 400, body: { error: "Invalid sign-in request." } },
  );
  assert.deepEqual(await reply(await post("/api/ls", "[1, 2")), {
    status: 400,
    body: { error: "Invalid request." },
  });
});

test("folder listing follows directory links, skips hidden/files/broken links, sorts names and preserves errors", async () => {
  const path = join(server.root, "listing");
  mkdirSync(path);
  for (const name of ["zebra", "Alpha", ".hidden"]) mkdirSync(join(path, name));
  writeFileSync(join(path, "file"), "text");
  symlinkSync(join(path, "Alpha"), join(path, "link"));
  symlinkSync(join(path, "missing"), join(path, "broken"));
  const list = (path: string) => post("/api/ls", JSON.stringify({ path })).then(reply);
  const result = await list(path);
  assert.equal(result.status, 200);
  assert.equal(result.body.path, path);
  assert.equal(result.body.parent, server.root);
  assert.deepEqual(
    result.body.entries.map((entry: { name: string }) => entry.name),
    ["Alpha", "link", "zebra"],
  );
  assert.deepEqual(await list(join(path, "missing")), {
    status: 400,
    body: { error: `No such directory: ${path}/missing` },
  });
  assert.deepEqual(await list(join(path, "file")), {
    status: 400,
    body: { error: `${path}/file is a file, not a directory` },
  });
});

test("a result outside the response Schema is never sent", async () => {
  const { status, body } = await reply(
    await post(`/api/workspace/capture?workspaceId=${server.workspaceId}`),
  );
  assert.equal(status, 500);
  assert.equal(body.error, "The server answered outside its contract. Inspect the server log.");
  assert.ok(!JSON.stringify(body).includes("not a manifest"));
});

test("INV-04: a provider sign-in refusal reaches the browser with its own detail, as MCP sign-in's does", async () => {
  const send = (path: string, method: string, body: unknown) =>
    server.handle(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const path of ["/api/provider-login", "/api/settings/mcp/login"]) {
    assert.deepEqual(
      await reply(await send(path, "PUT", { id: "gone", promptId: "gone", value: "x" })),
      {
        status: 409,
        body: { error: "This sign-in prompt has already closed. Refresh and try again." },
      },
      path,
    );
    assert.deepEqual(
      await reply(await send(path, "DELETE", { id: "gone" })),
      { status: 409, body: { error: "This sign-in is no longer current." } },
      path,
    );
  }
});

test("INV-02: a session's slash commands come from its running child, addressed by IDs; a stopped one is not started to answer", async () => {
  const sessionId = crypto.randomUUID();
  const names = async (response: Response) =>
    ((await response.json()) as { commands: { name: string }[] }).commands.map((c) => c.name);
  const commands = () =>
    server.handle(
      `/api/session/commands?${new URLSearchParams({ workspaceId: server.workspaceId, sessionId })}`,
    );
  await server.run(
    Effect.flatMap(SessionHosts, (hosts) =>
      hosts.open({ cwd: server.repo, sessionId, create: true }),
    ),
  );
  // The fake Pi lists `live-only` in a session and `probe-only` when started without one.
  const live = await names(await commands());
  assert.ok(live.includes("live-only") && !live.includes("probe-only"), live.join());
  const probed = await names(await post("/api/commands", JSON.stringify({ cwd: server.repo })));
  assert.ok(probed.includes("probe-only") && !probed.includes("live-only"), probed.join());
  await server.run(Effect.flatMap(SessionHosts, (hosts) => hosts.release(server.repo, sessionId)));
  assert.deepEqual(await reply(await commands()), {
    status: 409,
    body: { error: "Session is no longer running. Reopen the suggestions." },
  });
  assert.deepEqual(await server.run(Effect.flatMap(SessionHosts, (hosts) => hosts.list)), []);
});
