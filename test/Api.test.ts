import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { CatalogLive } from "../server/Catalog.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { PiSettingsLive } from "../server/PiSettings.ts";
import { ProviderLoginLive } from "../server/ProviderLogin.ts";
import { RadiusSetupLive } from "../server/RadiusSetup.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { AppRouter } from "../server/Router.ts";
import { SessionHostsLive } from "../server/SessionHosts.ts";
import { SessionPullRequestsLive } from "../server/SessionPullRequests.ts";
import { SidebarViewLive } from "../server/SidebarView.ts";
import { WorkspaceChangesLive } from "../server/WorkspaceChanges.ts";
import { WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";
import { WorkspaceRevisionsLive } from "../server/WorkspaceRevisions.ts";
import { ApiError, listDirectory, makeDirectory, slashCommands, workspaceChangedFile, workspaceChanges } from "../web/src/lib/api.ts";

// The browser adapter against the real router; only the Pi child is faked.
const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-api-")));
const repo = join(root, "repo");
const database = join(root, "registry.db");
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
mkdirSync(join(root, "sessions"));
mkdirSync(join(repo, "src"), { recursive: true });
const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "pipe" });
git("init", "-q");
writeFileSync(join(repo, "README.md"), "one\n");
git("add", "."); git("commit", "-qm", "initial");
writeFileSync(join(repo, "README.md"), "one\ntwo\n");

const Config = Layer.mergeAll(
  Layer.succeed(PiCli, { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] }),
  Layer.succeed(RegistryDatabasePath, database),
  NodeServices.layer,
);
const Services = Layer.mergeAll(SessionHostsLive({ idleMs: 0 }), PiSettingsLive, ProviderLoginLive, RadiusSetupLive, WorkspaceRevisionsLive, WorkspaceChangesLive, SessionPullRequestsLive).pipe(
  Layer.provideMerge(CatalogLive), Layer.provideMerge(RegistryLive), Layer.provideMerge(PiSessionsLive), Layer.provide(Config));
const Core = Layer.mergeAll(WorkspaceCommandsLive, SidebarViewLive()).pipe(Layer.provideMerge(Services));

let workspaceId = "";
let dispose: () => Promise<void> = async () => {};
const realFetch = globalThis.fetch;
before(async () => {
  workspaceId = await Effect.runPromise(Effect.gen(function* () {
    const registry = yield* Registry;
    yield* registry.addFolder(repo);
    return (yield* registry.get).workspaces.find(w => w.path === repo)!.id;
  }).pipe(Effect.provide(RegistryLive.pipe(Layer.provide(Config)))));
  const web = HttpRouter.toWebHandler(AppRouter.pipe(Layer.provideMerge(Core)), { disableLogger: true });
  dispose = web.dispose;
  // The browser resolves "/api/…" against its origin; tests resolve it against the handler.
  globalThis.fetch = (input, init) => web.handler(new Request(new URL(String(input), "http://piano.test"), init));
});
after(async () => {
  globalThis.fetch = realFetch;
  await dispose();
  rmSync(root, { recursive: true, force: true });
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
  const commands = await slashCommands(repo, undefined);
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
