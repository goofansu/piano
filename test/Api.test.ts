import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ApiError, listDirectory, makeDirectory, slashCommands, workspaceChangedFile, workspaceChanges } from "../web/src/lib/api.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

// The browser adapter against the real router; only the Pi child is faked.
let server: RouterFixture;
let root = "", repo = "", workspaceId = "";
const realFetch = globalThis.fetch;
before(async () => {
  server = await startRouter("piano-api-");
  ({ root, repo, workspaceId } = server);
  // The browser resolves "/api/…" against its origin; tests resolve it against the handler.
  globalThis.fetch = (input, init) => server.handle(String(input), init);
});
after(async () => {
  globalThis.fetch = realFetch;
  await server.dispose();
});

test("folder picker: listings decode, and a missing path fails with the server's message", async () => {
  const listing = await listDirectory(repo);
  assert.equal(listing.path, repo);
  assert.equal(listing.gitSubject, "initial");
  assert.deepEqual(listing.entries.map(e => e.name), ["src"]);
  const missing = join(root, "missing");
  await assert.rejects(listDirectory(missing), (error: unknown) =>
    error instanceof ApiError && error.status === 400 && error.message === `No such directory: ${missing}`);
  const created = await makeDirectory(join(repo, "new"));
  assert.equal(created, join(repo, "new"));
  assert.deepEqual((await listDirectory(repo)).entries.map(e => e.name), ["new", "src"]);
});

test("INV-07: changes address the workspace by ID and an unknown ID surfaces the registry's reason", async () => {
  const changes = await workspaceChanges(workspaceId);
  assert.equal(changes.workspace.path, repo);
  assert.ok(changes.result.status === "ready");
  assert.deepEqual(changes.result.files.map(f => [f.path, f.additions]), [["README.md", 1]]);
  const file = await workspaceChangedFile(workspaceId, "README.md");
  assert.ok(file.result.status === "ready" && file.result.diff.includes("+two"));
  await assert.rejects(workspaceChanges("not-a-workspace"), (error: unknown) =>
    error instanceof ApiError && error.status === 404 && error.message === "Workspace is not registered. Refresh the folder list.");
});

test("slash commands decode from a directory probe", async () => {
  const commands = await slashCommands(repo);
  assert.ok(commands.length > 0);
  assert.ok(commands.every(c => typeof c.name === "string" && ["extension", "prompt", "skill"].includes(c.source)));
});

test("a response outside the contract is rejected with the endpoint's message, not trusted", async () => {
  const contract = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ path: repo, entries: "not a list" });
    await assert.rejects(listDirectory(repo), (error: unknown) => error instanceof ApiError && error.message === "Could not list this folder.");
    globalThis.fetch = async () => new Response("<html>Bad gateway</html>", { status: 502 });
    await assert.rejects(workspaceChanges(workspaceId), (error: unknown) =>
      error instanceof ApiError && error.status === 502 && error.message === "Changes request failed (502). Refresh folders or inspect the server.");
  } finally { globalThis.fetch = contract; }
});
