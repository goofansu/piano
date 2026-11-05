import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Layer } from "effect";
// The credential store McpSetup uses, so synthetic tokens are saved under Pi's own keys.
import { FileAuthStorageBackend } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { McpOAuthCredentialStore } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.js";
import { DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { McpSetup, McpSetupEnvironment, McpSetupLive } from "../server/McpSetup.ts";
import { PiSessions } from "../server/PiSessions.ts";
import type { McpSetupState } from "../shared/mcp.ts";
import type { ProviderLoginState } from "../shared/wire.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));

/** The network is the fake boundary: a loopback MCP server behind OAuth discovery, dynamic
 * registration and a token endpoint. Pi's own client runs the whole sign-in against it. The same
 * endpoint also accepts a fixed Authorization header, as a server with an API key does. */
async function oauthMcpServer() {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reply = (status: number, value?: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(value === undefined ? undefined : JSON.stringify(value));
    };
    const path = new URL(request.url ?? "/", base).pathname;
    if (path.startsWith("/.well-known/oauth-protected-resource"))
      return reply(200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (path === "/.well-known/oauth-authorization-server")
      return reply(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (path === "/register")
      return reply(201, { ...JSON.parse(body), client_id: "piano-test-client" });
    if (path === "/token")
      return new URLSearchParams(body).get("code") === "granted"
        ? reply(200, {
            access_token: "private-access-token",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "private-refresh-token",
          })
        : reply(400, { error: "invalid_grant" });
    // `/keyed` is the same server at an endpoint that is no catalog server's.
    if (path !== "/mcp" && path !== "/keyed") return reply(404);
    const authorized = ["Bearer private-access-token", "Bearer header-token"];
    if (!authorized.includes(request.headers.authorization ?? "")) {
      return reply(
        401,
        { error: "unauthorized" },
        {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        },
      );
    }
    if (request.method !== "POST") return reply(405);
    const message = JSON.parse(body);
    if (message.id === undefined) return reply(202);
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fake", version: "1.0.0" },
          }
        : message.method === "tools/list"
          ? { tools: [{ name: "list_issues", inputSchema: { type: "object" } }] }
          : {};
    return reply(200, { jsonrpc: "2.0", id: message.id, result });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function fixture(
  run: (setup: McpSetup["Service"], directory: string, url: string) => Effect.Effect<void, unknown>,
) {
  const directory = mkdtempSync(join(tmpdir(), "piano-mcp-"));
  const fake = await oauthMcpServer();
  const sessions = Layer.succeed(
    PiSessions,
    PiSessions.of({
      open: () => Effect.die("unused"),
      history: undefined as never,
      probe: () => Effect.succeed({ models: [], commands: [] }),
    }),
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* run(yield* McpSetup, directory, fake.url);
      }).pipe(
        Effect.provide(
          McpSetupLive.pipe(Layer.provideMerge(DirectoryFactsLive), Layer.provide(sessions)),
        ),
        Effect.scoped,
        Effect.provideService(McpSetupEnvironment, {
          directory: () => directory,
          servers: () => [{ id: "linear", name: "Linear", url: fake.url }],
        }),
      ),
    );
  } finally {
    await fake.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const until = (setup: McpSetup["Service"], done: (state: ProviderLoginState) => boolean) =>
  Effect.gen(function* () {
    for (;;) {
      const state = yield* setup.signIn.state;
      if (state && done(state)) return state;
      yield* Effect.sleep(5);
    }
  }).pipe(Effect.timeout("10 seconds"));
/** The entry named `name`, or undefined when Pi's file has none. */
const server = (setup: McpSetup["Service"], name: string) =>
  Effect.map(setup.state, (state) => state.servers.find((server) => server.name === name));
const linear = (setup: McpSetup["Service"]) => server(setup, "linear");
const available = (state: McpSetupState) => state.available.map((server) => server.id);
const names = (state: McpSetupState) => state.servers.map((server) => server.name);

/** Approves the running sign-in by pasting the redirect with `code`, and waits for its outcome. */
const approve = (setup: McpSetup["Service"], code = "granted") =>
  Effect.gen(function* () {
    const waiting = yield* until(setup, (state) => !!state.prompt && !!state.url);
    const authorization = new URL(waiting.url!);
    const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", authorization.searchParams.get("state")!);
    yield* setup.signIn.answer(waiting.id, waiting.prompt!.id, redirect.href);
    return yield* until(setup, (state) => state.status !== "running");
  });
const credentialStore = (directory: string) =>
  new McpOAuthCredentialStore(
    new FileAuthStorageBackend(join(directory, "mcp-auth.json")),
    directory,
  );

test("INV-01/11/12: connecting a catalog server saves it only once its sign-in succeeds; disconnecting removes it and its sign-in", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { custom: { untouched: true }, mcpServers: { other: { command: "do-not-run" } } });
      const initial = yield* setup.state;
      assert.deepEqual(names(initial), ["other"]);
      assert.deepEqual(available(initial), ["linear"]);
      assert.match((yield* Effect.flip(setup.signIn.start("linear"))).detail, /Add linear MCP/);

      // The server asks for a sign-in: nothing is saved yet, and the answer says whom to sign in to.
      const before = readFileSync(file, "utf8");
      const connecting = yield* setup.change({ action: "connect", server: "linear" });
      assert.equal(connecting.signIn, "linear");
      assert.deepEqual(names(connecting.state), ["other"]);
      assert.equal(readFileSync(file, "utf8"), before);

      yield* setup.signIn.start("linear");
      const waiting = yield* until(setup, (state) => !!state.prompt && !!state.url);
      assert.equal(new URL(waiting.url!).origin, new URL(url).origin);
      // A mistyped paste asks again instead of ending the sign-in.
      const wrong = new URL(new URL(waiting.url!).searchParams.get("redirect_uri")!);
      wrong.searchParams.set("code", "granted");
      wrong.searchParams.set("state", "other");
      const rejected = yield* Effect.flip(
        setup.signIn.answer(waiting.id, waiting.prompt!.id, wrong.href),
      );
      assert.match(rejected.detail, /Paste the full address/);
      const finished = yield* approve(setup);
      assert.deepEqual(
        [finished.status, finished.message],
        ["success", "Connected. Start a new session to use Linear tools."],
      );
      assert.ok(!JSON.stringify(finished).includes("private-"), "no token reaches the browser");
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: { other: { command: "do-not-run" }, linear: { url } },
      });
      const connected = (yield* linear(setup))!;
      assert.deepEqual(
        [connected.catalog, connected.oauth, connected.signedIn],
        ["linear", true, true],
      );
      assert.deepEqual(available(yield* setup.state), []);

      // A saved server signs in again with its stored token, asking nothing.
      yield* setup.signIn.start("linear");
      assert.equal(
        (yield* until(setup, (state) => state.status !== "running")).message,
        "Already signed in to Linear.",
      );

      const stale = yield* Effect.flip(
        setup.change({ action: "remove", name: "linear", removalKey: "stale" }),
      );
      assert.match(stale.detail, /changed|Refresh/);
      yield* setup.change({ action: "remove", name: "linear", removalKey: connected.removalKey });
      assert.deepEqual(json(file).mcpServers, { other: { command: "do-not-run" } });
      assert.equal(credentialStore(directory).tokens("linear", url), undefined);
      assert.deepEqual(available(yield* setup.state), ["linear"]);
    }),
  );
});

test("INV-01/12: a sign-in that is refused or cancelled saves nothing and leaves no tokens", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { mcpServers: {} });
      const store = credentialStore(directory);

      assert.equal((yield* setup.change({ action: "connect", server: "linear" })).signIn, "linear");
      yield* setup.signIn.start("linear");
      const refused = yield* approve(setup, "denied");
      assert.equal(refused.status, "error");
      assert.deepEqual(json(file), { mcpServers: {} });
      assert.equal(store.tokens("linear", url), undefined);

      // Trying again signs in to the same waiting server; cancelling it saves nothing either.
      yield* setup.signIn.start("linear");
      const waiting = yield* until(setup, (state) => !!state.prompt);
      yield* setup.signIn.cancel(waiting.id);
      yield* Effect.sleep(50);
      assert.deepEqual(json(file), { mcpServers: {} });
      assert.equal(yield* linear(setup), undefined);

      // A later sign-in still saves it.
      yield* setup.signIn.start("linear");
      assert.equal((yield* approve(setup)).status, "success");
      assert.equal((yield* linear(setup))?.signedIn, true);
    }),
  );
});

test("INV-01/12: removing clears the endpoint's sign-in after a switch to a header, keeps other servers' and can be retried", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      const auth = join(directory, "mcp-auth.json");
      const store = credentialStore(directory);
      const signIn = (name: string, endpoint: string, token: string) =>
        store.forServer(name, endpoint).save({
          serverUrl: endpoint,
          tokens: { access_token: token, refresh_token: `${token}-refresh`, token_type: "Bearer" },
        });
      const notes = "http://127.0.0.1:9/notes";
      signIn("notes", notes, "synthetic-notes");
      signIn("linear", url, "synthetic-linear");
      // The user switched Linear's endpoint to a header in Pi; the old sign-in is still stored.
      save(file, {
        mcpServers: {
          notes: { url: notes },
          linear: { url, headers: { Authorization: "Bearer synthetic-header" } },
        },
      });
      const switched = (yield* linear(setup))!;
      assert.deepEqual(
        [switched.oauth, switched.config],
        [false, { url, headers: {}, hasAuthorization: true }],
      );
      assert.ok(
        !JSON.stringify(yield* setup.state).includes("synthetic-header"),
        "the Authorization value never reaches the browser",
      );

      // An unreadable credential store fails the removal and leaves the entry to retry.
      const stored = readFileSync(auth, "utf8");
      writeFileSync(auth, "{ not json");
      const failed = yield* Effect.flip(
        setup.change({ action: "remove", name: "linear", removalKey: switched.removalKey }),
      );
      assert.match(failed.detail, /Could not remove/);
      assert.ok(json(file).mcpServers.linear, "the entry is kept for a retry");

      writeFileSync(auth, stored);
      yield* setup.change({ action: "remove", name: "linear", removalKey: switched.removalKey });
      assert.deepEqual(json(file), { mcpServers: { notes: { url: notes } } });
      assert.equal(store.tokens("linear", url), undefined);
      assert.equal(store.tokens("notes", notes)?.access_token, "synthetic-notes");

      // Connecting again asks for a new sign-in: nothing of the old one is reused.
      assert.equal((yield* setup.change({ action: "connect", server: "linear" })).signIn, "linear");
    }),
  );
});

test("INV-01/12: a URL server that cannot be reached, or rejects its Authorization header, is refused on its URL and not saved", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { mcpServers: {} });
      const keyedUrl = url.replace(/\/mcp$/, "/keyed");
      const unreachable = yield* Effect.flip(
        setup.change({ action: "add", name: "gone", config: { url: "http://127.0.0.1:9/mcp" } }),
      );
      assert.deepEqual(
        [unreachable.field, unreachable.detail],
        ["config", "Could not connect to gone MCP. Check the URL and the network, then try again."],
      );
      const rejected = yield* Effect.flip(
        setup.change({
          action: "add",
          name: "keyed",
          config: { url: keyedUrl, headers: { Authorization: "Bearer wrong" } },
        }),
      );
      assert.deepEqual(
        [rejected.field, rejected.detail],
        [
          "config",
          "Could not connect to keyed MCP. Check the URL, the Authorization header and the network, then try again.",
        ],
      );
      assert.ok(!rejected.detail.includes("wrong"), "the header value is not echoed");
      assert.deepEqual(json(file), { mcpServers: {} });

      // The right header connects without a sign-in, so the server is saved at once.
      const keyed = yield* setup.change({
        action: "add",
        name: "keyed",
        config: { url: keyedUrl, headers: { Authorization: "Bearer header-token" }, timeout: 30 },
      });
      assert.equal(keyed.signIn, undefined);
      assert.deepEqual(json(file).mcpServers.keyed, {
        url: keyedUrl,
        headers: { Authorization: "Bearer header-token" },
        timeout: 30,
      });
      assert.ok(!JSON.stringify(keyed).includes("header-token"), "no header value on the wire");
    }),
  );
});

test("INV-01/12: a local command server is saved as Pi validates it, never started and never signed in to", async () => {
  await fixture((setup, directory) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { custom: { untouched: true }, mcpServers: {} });
      const paper = { command: join(directory, "no-such-cli"), args: ["mcp"] };
      const added = yield* setup.change({ action: "add", name: "paper", config: paper });
      assert.equal(added.signIn, undefined);
      assert.deepEqual(json(file), { custom: { untouched: true }, mcpServers: { paper } });
      const saved = (yield* server(setup, "paper"))!;
      assert.deepEqual(
        [saved.catalog, saved.oauth, saved.config],
        [undefined, false, { ...paper, env: {} }],
      );
      assert.match((yield* Effect.flip(setup.signIn.start("paper"))).detail, /does not sign in/);

      const empty = yield* Effect.flip(
        setup.change({ action: "add", name: "blank", config: { command: "" } }),
      );
      assert.equal(empty.field, "config");
      const taken = yield* Effect.flip(
        setup.change({ action: "add", name: "paper", config: paper }),
      );
      assert.deepEqual([taken.field, taken.detail], ["name", "Another MCP server is named paper."]);
      const invalid = yield* Effect.flip(
        setup.change({ action: "add", name: "broken", config: { nope: true } }),
      );
      assert.equal(invalid.field, "config");
      assert.match(invalid.detail, /broken/);

      yield* setup.change({ action: "remove", name: "paper", removalKey: saved.removalKey });
      assert.deepEqual(json(file), { custom: { untouched: true }, mcpServers: {} });
    }),
  );
});

test("INV-01/12: edits keep Pi's other keys and the Authorization value on the machine, and an edit to a URL server saves only once it connects", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      const store = credentialStore(directory);
      const docs = { url, headers: { Authorization: "Bearer header-token", "x-org": "acme" } };
      save(file, {
        mcpServers: {
          docs: { ...docs, timeout: 30 },
          tools: { command: "uvx", args: ["tools-mcp"] },
        },
      });
      const docsSetup = (yield* server(setup, "docs"))!;
      assert.deepEqual(docsSetup.config, {
        url,
        headers: { "x-org": "acme" },
        hasAuthorization: true,
      });

      // A rename and new headers, the saved Authorization kept while the edit leaves it out.
      const edited = yield* setup.change({
        action: "update",
        name: "docs",
        removalKey: docsSetup.removalKey,
        rename: "handbook",
        config: { url, headers: { "x-team": "platform" } },
      });
      assert.equal(edited.signIn, undefined);
      assert.deepEqual(json(file).mcpServers.handbook, {
        url,
        headers: { Authorization: "Bearer header-token", "x-team": "platform" },
        timeout: 30,
      });
      assert.equal(json(file).mcpServers.docs, undefined);
      const handbook = (yield* server(setup, "handbook"))!;

      // A stale identity refuses the edit; one that cannot connect is refused and changes nothing.
      const stale = yield* Effect.flip(
        setup.change({
          action: "update",
          name: "handbook",
          removalKey: docsSetup.removalKey,
          config: { url, headers: {} },
        }),
      );
      assert.match(stale.detail, /changed|Refresh/);
      const saved = readFileSync(file, "utf8");
      const unreachable = yield* Effect.flip(
        setup.change({
          action: "update",
          name: "handbook",
          removalKey: handbook.removalKey,
          config: { url: "http://127.0.0.1:9/mcp", headers: {} },
        }),
      );
      assert.equal(unreachable.field, "config");
      assert.equal(readFileSync(file, "utf8"), saved);

      // Dropping the header makes the server ask for a sign-in, which saves the edit.
      const cleared = yield* setup.change({
        action: "update",
        name: "handbook",
        removalKey: handbook.removalKey,
        config: { url, headers: {}, authorization: null },
      });
      assert.equal(cleared.signIn, "handbook");
      assert.equal(readFileSync(file, "utf8"), saved);
      yield* setup.signIn.start("handbook");
      assert.equal((yield* approve(setup)).status, "success");
      assert.deepEqual(json(file).mcpServers.handbook, { url, timeout: 30 });
      assert.equal((yield* server(setup, "handbook"))?.signedIn, true);

      // Renaming an OAuth entry drops the tokens stored under its old name.
      const signedIn = (yield* server(setup, "handbook"))!;
      const renamed = yield* setup.change({
        action: "update",
        name: "handbook",
        removalKey: signedIn.removalKey,
        rename: "manual",
        config: { url, headers: {} },
      });
      assert.equal(renamed.signIn, "manual");
      assert.ok(store.tokens("handbook", url), "nothing changes before the sign-in");
      yield* setup.signIn.start("manual");
      assert.equal((yield* approve(setup)).status, "success");
      assert.equal(
        store.tokens("handbook", url),
        undefined,
        "tokens under the old name are dropped",
      );
      assert.ok(store.tokens("manual", url));

      // A command server's edit is validated by Pi, not started; a change of transport drops the
      // other transport's keys.
      const tools = (yield* server(setup, "tools"))!;
      const rejected = yield* Effect.flip(
        setup.change({
          action: "update",
          name: "tools",
          removalKey: tools.removalKey,
          config: { command: "", args: [], env: {} },
        }),
      );
      assert.equal(rejected.field, "config");
      const switched = yield* setup.change({
        action: "update",
        name: "tools",
        removalKey: tools.removalKey,
        config: { url, headers: {}, authorization: "Bearer header-token" },
      });
      assert.equal(switched.signIn, undefined);
      assert.deepEqual(json(file).mcpServers.tools, {
        url,
        headers: { Authorization: "Bearer header-token" },
      });
    }),
  );
});

test("INV-01/12: a server the user configured at the catalog endpoint is the catalog's; a taken default name and Pi's MCP switch refuse to connect", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { mcpServers: { mine: { url } } });
      const mine = (yield* server(setup, "mine"))!;
      assert.deepEqual([mine.catalog, mine.oauth, mine.signedIn], ["linear", true, false]);
      assert.deepEqual(available(yield* setup.state), []);
      const before = readFileSync(file, "utf8");
      const kept = yield* setup.change({ action: "connect", server: "linear" });
      assert.equal(kept.signIn, undefined);
      assert.equal(readFileSync(file, "utf8"), before, "connect keeps the matching entry");

      save(file, { mcpServers: { linear: { url: "https://elsewhere.test/mcp" } } });
      assert.deepEqual((yield* setup.state).available, [
        { id: "linear", detail: "Another MCP server is named linear." },
      ]);
      const refused = yield* Effect.flip(setup.change({ action: "connect", server: "linear" }));
      assert.equal(refused.field, "name");

      writeFileSync(
        join(directory, "settings.json"),
        JSON.stringify({ extensions: ["-builtin:mcp"] }),
      );
      const off = yield* setup.state;
      assert.match(off.problem ?? "", /switched off/);
      assert.deepEqual([off.servers, off.available], [[], []]);
      const text = readFileSync(file, "utf8");
      const blocked = yield* Effect.result(
        setup.change({ action: "add", name: "tools", config: { command: "uvx" } }),
      );
      assert.equal(blocked._tag, "Failure");
      assert.equal(readFileSync(file, "utf8"), text);
    }),
  );
});

test("the catalog offers the hosted servers Piano connects to, with their public endpoints", () => {
  const servers = Effect.runSync(
    Effect.gen(function* () {
      return (yield* McpSetupEnvironment).servers();
    }),
  );
  assert.deepEqual(servers, [
    { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp" },
    { id: "jira", name: "Jira", url: "https://mcp.atlassian.com/v2/mcp" },
  ]);
});
