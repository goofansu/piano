import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Effect, Layer } from "effect";
import { WorkspaceRevisions } from "../server/WorkspaceRevisions.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

// The router's half of shared/http.ts, observed over HTTP the way any client sees it.
let server: RouterFixture;
before(async () => {
  // A capture that answers outside WorkspaceCapture, to observe the response contract.
  const offContract = Layer.succeed(WorkspaceRevisions, { capture: () => Effect.succeed({ candidate: "not a manifest" } as never) });
  server = await startRouter("piano-router-", offContract);
});
after(() => server.dispose());

const post = (path: string, body?: string) =>
  server.handle(path, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }) });
const reply = async (response: Response) => ({ status: response.status, body: await response.json() });

test("a decoded body and the resolved workspace reach the handler; the reply is the contract's JSON", async () => {
  const { status, body } = await reply(await post(`/api/workspace/changes/file?workspaceId=${server.workspaceId}`, JSON.stringify({ path: "README.md" })));
  assert.equal(status, 200);
  assert.deepEqual(body.workspace, { id: server.workspaceId, folder: server.repo, path: server.repo });
  assert.equal(body.result.status, "ready");
  assert.match(body.result.diff, /\+two/);
});

test("INV-07: IDs resolve through the registry; a missing ID is malformed and an unknown one is not found", async () => {
  assert.deepEqual(await reply(await post("/api/workspace/changes?workspaceId=nope")),
    { status: 404, body: { error: "Workspace is not registered. Refresh the folder list." } });
  assert.deepEqual(await reply(await post("/api/workspace/changes")), { status: 400, body: { error: "Workspace ID is required." } });
  const pr = (query: string) => server.handle(`/api/session/pull-request?${query}`);
  assert.deepEqual(await reply(await pr(`workspaceId=${server.workspaceId}`)), { status: 400, body: { error: "Workspace and session IDs are required." } });
  assert.deepEqual(await reply(await pr(`workspaceId=${server.workspaceId}&sessionId=unknown`)),
    { status: 404, body: { error: "Session is not registered in this workspace. Refresh the session list." } });
});

test("a body outside the endpoint's Schema is answered 400 with the endpoint's message, before any work", async () => {
  const file = `/api/workspace/changes/file?workspaceId=${server.workspaceId}`;
  for (const body of [undefined, "not json", "{}", JSON.stringify({ path: 7 })]) {
    assert.deepEqual(await reply(await post(file, body)), { status: 400, body: { error: "File path is required in the request body." } }, `body ${body}`);
  }
  assert.deepEqual(await reply(await post("/api/settings/radius", JSON.stringify({ action: "remove-mcp" }))),
    { status: 400, body: { error: "Invalid Radius setup action." } }, "removal names the reviewed configuration");
  assert.deepEqual(await reply(await server.handle("/api/provider-login", { method: "PUT", body: JSON.stringify({ id: "a", promptId: "b", value: "x".repeat(16_385) }) })),
    { status: 400, body: { error: "Invalid sign-in request." } });
  assert.deepEqual(await reply(await post("/api/ls", "[1, 2")), { status: 400, body: { error: "Invalid request." } });
});

test("a result outside the response Schema is never sent", async () => {
  const { status, body } = await reply(await post(`/api/workspace/capture?workspaceId=${server.workspaceId}`));
  assert.equal(status, 500);
  assert.equal(body.error, "The server answered outside its contract. Inspect the server log.");
  assert.ok(!JSON.stringify(body).includes("not a manifest"));
});
