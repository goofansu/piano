import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Effect, Layer } from "effect";
import { PiSettings, PiSettingsError } from "../server/PiSettings.ts";
import { ProviderLoginRuntime } from "../server/ProviderLogin.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { type Endpoint, Endpoints } from "../shared/http.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

// The router's half of shared/http.ts, observed over HTTP the way any client sees it.
let server: RouterFixture;
before(async () => {
  // Settings that refuse one model, answer outside the response contract for another and fail
  // unexpectedly for any other, to observe failure statuses and the response contract.
  const failingSettings = Layer.succeed(PiSettings, {
    defaults: Effect.die("unused"),
    saveDefaults: ({ model }) =>
      model === "refused"
        ? Effect.fail(new PiSettingsError({ detail: "Choose an available model." }))
        : model === "off-contract"
          ? Effect.succeed({ candidate: "not defaults" } as never)
          : Effect.die(new Error("EACCES: /home/someone/.pi/agent/settings.json")),
  });
  // Pi's providers fail to load with an error that names a local file.
  const unreadableProviders = Layer.succeed(ProviderLoginRuntime, {
    create: () => Promise.reject(new Error("EACCES: /home/someone/.pi/agent/auth.json")),
    deviceId: () => "unused",
  });
  server = await startRouter("piano-router-", Layer.merge(failingSettings, unreadableProviders));
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

test("written files: each path a session wrote, as sent, is outside, ignored by Git, removed or listed; inside ones are placed", async (t) => {
  const { writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  writeFileSync(join(server.repo, ".gitignore"), "scratch/\n*.log\nREADME.md\n");
  writeFileSync(join(server.repo, "src/app.ts"), "export {};\n");
  t.after(() => {
    rmSync(join(server.repo, ".gitignore"));
    rmSync(join(server.repo, "src/app.ts"));
  });
  const { status, body } = await reply(
    await post(
      `/api/workspace/files/written?workspaceId=${server.workspaceId}`,
      JSON.stringify({
        paths: [
          "scratch/notes.md",
          "src/app.ts",
          `${server.repo}/build.log`,
          "/elsewhere/x.ts",
          "../sibling.ts",
          "README.md",
        ],
      }),
    ),
  );
  assert.equal(status, 200);
  assert.equal(body.workspace.id, server.workspaceId);
  assert.deepEqual(body.result, {
    status: "ready",
    files: [
      // Neither ignored file was ever written in this checkout: Git's verdict comes first.
      { path: "scratch/notes.md", verdict: "ignored", placed: "scratch/notes.md" },
      { path: "src/app.ts", verdict: "listed", placed: "src/app.ts" },
      { path: `${server.repo}/build.log`, verdict: "ignored", placed: "build.log" },
      { path: "/elsewhere/x.ts", verdict: "outside" },
      { path: "../sibling.ts", verdict: "outside" },
      // README.md matches a pattern but is tracked, so Git does not ignore it.
      { path: "README.md", verdict: "listed", placed: "README.md" },
    ],
  });
  const none = await reply(
    await post(
      `/api/workspace/files/written?workspaceId=${server.workspaceId}`,
      JSON.stringify({ paths: ["src/app.ts"] }),
    ),
  );
  assert.deepEqual(none.body.result, {
    status: "ready",
    files: [{ path: "src/app.ts", verdict: "listed", placed: "src/app.ts" }],
  });
});

test("an absolute path through a symlink to the workspace is inside it, as macOS's /var/folders tmp is", async (t) => {
  const { mkdtempSync, rmSync, symlinkSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const links = mkdtempSync(join(tmpdir(), "piano-link-"));
  const link = join(links, "repo");
  symlinkSync(server.repo, link);
  writeFileSync(join(server.repo, ".gitignore"), "scratch/\n");
  t.after(() => {
    rmSync(join(server.repo, ".gitignore"));
    rmSync(links, { recursive: true, force: true });
  });
  const { body } = await reply(
    await post(
      `/api/workspace/files/written?workspaceId=${server.workspaceId}`,
      JSON.stringify({ paths: [`${link}/scratch/notes.md`, `${link}/src/app.ts`] }),
    ),
  );
  assert.deepEqual(body.result, {
    status: "ready",
    files: [
      { path: `${link}/scratch/notes.md`, verdict: "ignored", placed: "scratch/notes.md" },
      { path: `${link}/src/app.ts`, verdict: "missing", placed: "src/app.ts" },
    ],
  });
});

test("written-file paths and their placed names are identities, never redacted as display text", async () => {
  const paths = ["notes/token=abc12345.md", `${server.repo}/keys/sk-abcdefghijklmnop.ts`];
  const { body } = await reply(
    await post(
      `/api/workspace/files/written?workspaceId=${server.workspaceId}`,
      JSON.stringify({ paths }),
    ),
  );
  assert.deepEqual(body.result, {
    status: "ready",
    files: [
      { path: paths[0], verdict: "missing", placed: "notes/token=abc12345.md" },
      { path: paths[1], verdict: "missing", placed: "keys/sk-abcdefghijklmnop.ts" },
    ],
  });
});

test("a file the Files list places inside the workspace through a symlink opens", async (t) => {
  const { mkdtempSync, rmSync, symlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const links = mkdtempSync(join(tmpdir(), "piano-link-"));
  const link = join(links, "repo");
  symlinkSync(server.repo, link);
  t.after(() => rmSync(links, { recursive: true, force: true }));
  const { status, body } = await reply(
    await post(
      `/api/workspace/file?workspaceId=${server.workspaceId}`,
      JSON.stringify({ path: `${link}/README.md` }),
    ),
  );
  assert.equal(status, 200);
  assert.equal(body.path, "README.md");
  assert.equal(body.content, "one\ntwo\n");
});

test("workspace files use a body path and return uncached text for the registered workspace", async () => {
  const response = await post(
    `/api/workspace/file?workspaceId=${server.workspaceId}`,
    JSON.stringify({ path: "README.md" }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    workspaceId: server.workspaceId,
    path: "README.md",
    kind: "markdown",
    language: "markdown",
    content: "one\ntwo\n",
  });
});

test("workspace file downloads are uncached, unsniffed attachments of the exact bytes", async () => {
  const response = await post(
    `/api/workspace/file/download?workspaceId=${server.workspaceId}`,
    JSON.stringify({ path: "README.md" }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="README.md"; filename*=UTF-8''README.md`,
  );
  assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.equal(await response.text(), "one\ntwo\n");
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

test("a result outside the response Schema is never sent", async () => {
  const { status, body } = await reply(
    await server.handle("/api/settings/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "off-contract", thinkingLevel: "medium" }),
    }),
  );
  assert.equal(status, 500);
  assert.equal(body.error, "The server answered outside its contract. Inspect the server log.");
  assert.ok(!JSON.stringify(body).includes("not defaults"));
});

test("a refusal is answered with the endpoint's status and its detail; an unexpected failure generically, never with its message", async () => {
  const save = (model: string) =>
    server.handle("/api/settings/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, thinkingLevel: "medium" }),
    });
  assert.deepEqual(await reply(await save("refused")), {
    status: 400,
    body: { error: "Choose an available model." },
  });
  const unexpected = await reply(await save("other"));
  assert.deepEqual(unexpected, {
    status: 500,
    body: { error: Endpoints.saveDefaults.fallback },
  });
  assert.ok(!JSON.stringify(unexpected).includes("EACCES"));
});

test("INV-04: a provider sign-in refusal reaches the browser with its own detail, as MCP sign-in's does", async () => {
  const send = ({ method, path }: Endpoint, body: unknown) =>
    server.handle(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const lane of [Endpoints.providerLogin, Endpoints.mcpLogin]) {
    assert.deepEqual(
      await reply(await send(lane.answer, { id: "gone", promptId: "gone", value: "x" })),
      {
        status: 409,
        body: { error: "This sign-in prompt has already closed. Refresh and try again." },
      },
      lane.answer.path,
    );
    assert.deepEqual(
      await reply(await send(lane.cancel, { id: "gone" })),
      { status: 409, body: { error: "This sign-in is no longer current." } },
      lane.cancel.path,
    );
  }
});

test("a session's slash commands are addressed by IDs; a stopped session's refusal is a 409 with its detail", async () => {
  let sessionId = "";
  const names = async (response: Response) =>
    ((await response.json()) as { commands: { name: string }[] }).commands.map((c) => c.name);
  const commands = () =>
    server.handle(
      `/api/session/commands?${new URLSearchParams({ workspaceId: server.workspaceId, sessionId })}`,
    );
  sessionId = await server.run(
    Effect.flatMap(SessionHosts, (hosts) =>
      hosts.create({ cwd: server.repo, options: {} }).pipe(Effect.map((s) => s.spec.sessionId)),
    ),
  );
  // The fake Pi lists `live-only` in a session and `probe-only` when started without one.
  const live = await names(await commands());
  assert.ok(live.includes("live-only") && !live.includes("probe-only"), live.join());
  await server.run(Effect.flatMap(SessionHosts, (hosts) => hosts.release(server.repo, sessionId)));
  assert.deepEqual(await reply(await commands()), {
    status: 409,
    body: { error: "Session is no longer running. Reopen the suggestions." },
  });
});

test("the services refuse what Router used to: the filesystem root, an empty directory, unreadable providers", async () => {
  const json = (body: unknown) => JSON.stringify(body);
  assert.deepEqual(await reply(await post("/api/mkdir", json({ path: "/" }))), {
    status: 400,
    body: { error: "Choose a folder below the filesystem root." },
  });
  assert.deepEqual(await reply(await post("/api/mkdir", json({ path: "" }))), {
    status: 400,
    body: { error: Endpoints.makeDirectory.invalid },
  });
  assert.deepEqual(await reply(await post("/api/commands", json({ cwd: "" }))), {
    status: 400,
    body: { error: Endpoints.slashCommands.invalid },
  });
  const providers = await reply(await server.handle(Endpoints.oauthProviders.path));
  assert.deepEqual(providers, { status: 502, body: { error: "Could not load OAuth providers." } });
  assert.ok(!JSON.stringify(providers).includes("auth.json"));
});

test("INV-11: a listed directory's path and name round-trip, however token-like; an error's text stays redacted", async (t) => {
  const { mkdirSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const secret = "router-identity-secret-42";
  process.env.PIANO_ROUTER_TOKEN = secret;
  const parent = join(server.root, "picker");
  const names = ["sk-demo", "xoxb-bot", `x${secret}`];
  for (const name of names) mkdirSync(join(parent, name), { recursive: true });
  t.after(() => {
    delete process.env.PIANO_ROUTER_TOKEN;
    rmSync(parent, { recursive: true, force: true });
  });
  const listing = await reply(await post("/api/ls", JSON.stringify({ path: parent })));
  assert.equal(listing.status, 200);
  assert.deepEqual(
    listing.body.entries.map((entry: { name: string; path: string }) => [entry.name, entry.path]),
    names.map((name) => [name, join(parent, name)]).sort((a, b) => a[0].localeCompare(b[0])),
  );
  // The browser opens an entry by sending its path back.
  const opened = await reply(
    await post("/api/ls", JSON.stringify({ path: listing.body.entries[0].path })),
  );
  assert.equal(opened.status, 200);
  assert.equal(opened.body.path, listing.body.entries[0].path);
  assert.equal(opened.body.parent, parent);

  const missing = await reply(
    await post("/api/ls", JSON.stringify({ path: join(parent, "sk-missing") })),
  );
  assert.equal(missing.status, 400);
  assert.ok(!JSON.stringify(missing.body).includes("sk-missing"), missing.body.error);
});
