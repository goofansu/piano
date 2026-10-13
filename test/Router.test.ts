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
