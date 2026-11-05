import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { Effect, Layer } from "effect";
// The credential store McpSetup uses, so synthetic tokens are saved under Pi's own keys.
import { FileAuthStorageBackend } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { McpOAuthCredentialStore } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.js";
import { DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { McpSetup, McpSetupEnvironment, McpSetupLive } from "../server/McpSetup.ts";
import { PiSessions } from "../server/PiSessions.ts";
import { MCP_CATALOG, type McpSetupState } from "../shared/mcp.ts";
import type { ProviderLoginState } from "../shared/wire.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
/** The local CLI a stdio catalog server runs, as McpSetup resolves it for this machine. */
const command = (directory: string) => join(directory, "bin", "paper");
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));

/** The network is the fake boundary: a loopback MCP server behind OAuth discovery, dynamic
 * registration and a token endpoint. Pi's own client runs the whole sign-in against it. */
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
    if (path !== "/mcp") return reply(404);
    if (request.headers.authorization !== "Bearer private-access-token") {
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
          servers: () => [
            { id: "linear", name: "Linear", url: fake.url },
            { id: "paper", name: "Paper", command: command(directory), args: ["mcp"] },
          ],
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

test("INV-01/11/12: install, sign in by pasted redirect, sign out and uninstall a catalog MCP server through Pi", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { custom: { untouched: true }, mcpServers: { other: { command: "do-not-run" } } });
      // The user's own entry is listed; the catalog servers wait to be installed.
      const initial = yield* setup.state;
      assert.deepEqual(names(initial), ["other"]);
      assert.deepEqual(available(initial), ["linear", "paper"]);
      assert.equal(yield* linear(setup), undefined);
      const notInstalled = yield* Effect.flip(setup.signIn.start("linear"));
      assert.match(notInstalled.detail, /Add Linear MCP/);

      yield* setup.change({ action: "install", server: "linear" });
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: { other: { command: "do-not-run" }, linear: { url } },
      });
      const installed = (yield* linear(setup))!;
      assert.deepEqual(
        { ...installed, removalKey: typeof installed.removalKey },
        {
          name: "linear",
          catalog: "linear",
          config: { url, headers: {}, hasAuthorization: false },
          oauth: true,
          signedIn: false,
          removalKey: "string",
        },
      );
      assert.deepEqual(available(yield* setup.state), ["paper"]);

      yield* setup.signIn.start("linear");
      const waiting = yield* until(setup, (state) => !!state.prompt && !!state.url);
      const authorization = new URL(waiting.url!);
      assert.equal(authorization.origin, new URL(url).origin);
      const redirect = new URL(authorization.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", "granted");
      redirect.searchParams.set("state", authorization.searchParams.get("state")!);
      // A mistyped paste asks again instead of ending the sign-in.
      const wrongState = new URL(redirect);
      wrongState.searchParams.set("state", "other");
      const rejected = yield* Effect.flip(
        setup.signIn.answer(waiting.id, waiting.prompt!.id, wrongState.href),
      );
      assert.match(rejected.detail, /Paste the full address/);
      assert.equal((yield* setup.signIn.state)?.prompt?.id, waiting.prompt!.id);
      yield* setup.signIn.answer(waiting.id, waiting.prompt!.id, redirect.href);
      const finished = yield* until(setup, (state) => state.status !== "running");
      assert.equal(finished.status, "success", finished.message ?? "sign-in succeeds");
      assert.ok(
        !JSON.stringify(finished).includes("private-"),
        "no token reaches the browser state",
      );
      assert.equal((yield* linear(setup))?.signedIn, true);
      assert.match(readFileSync(join(directory, "mcp-auth.json"), "utf8"), /private-access-token/);

      // A second sign-in finds the stored token and asks nothing.
      yield* setup.signIn.start("linear");
      assert.equal(
        (yield* until(setup, (state) => state.status !== "running")).message,
        "Already signed in to Linear.",
      );

      yield* setup.change({ action: "sign-out", name: "linear" });
      assert.equal((yield* linear(setup))?.signedIn, false);
      assert.doesNotMatch(
        readFileSync(join(directory, "mcp-auth.json"), "utf8"),
        /private-access-token/,
      );

      const { removalKey } = (yield* linear(setup))!;
      const stale = yield* Effect.flip(
        setup.change({ action: "remove", name: "linear", removalKey: "stale" }),
      );
      assert.match(stale.detail, /changed|Refresh/);
      yield* setup.change({ action: "remove", name: "linear", removalKey });
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: { other: { command: "do-not-run" } },
      });
      assert.equal(yield* linear(setup), undefined);
      assert.deepEqual(available(yield* setup.state), ["linear", "paper"]);
    }),
  );
});

test("INV-01/12: uninstall clears the endpoint's sign-in after a switch to a header, keeps other servers' and can be retried", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      const auth = join(directory, "mcp-auth.json");
      const store = new McpOAuthCredentialStore(new FileAuthStorageBackend(auth), directory);
      const signIn = (name: string, endpoint: string, token: string) =>
        store.forServer(name, endpoint).save({
          serverUrl: endpoint,
          tokens: { access_token: token, refresh_token: `${token}-refresh`, token_type: "Bearer" },
        });
      const notes = "http://127.0.0.1:9/notes";
      save(file, { mcpServers: { notes: { url: notes } } });
      signIn("notes", notes, "synthetic-notes");

      yield* setup.change({ action: "install", server: "linear" });
      signIn("linear", url, "synthetic-linear");
      assert.equal((yield* linear(setup))?.signedIn, true);

      // The user switches the same endpoint to a header in Pi; the old sign-in is still stored.
      save(file, {
        mcpServers: {
          notes: { url: notes },
          linear: { url, headers: { Authorization: "Bearer synthetic-header" } },
        },
      });
      const switched = (yield* linear(setup))!;
      assert.equal(switched.oauth, false);
      assert.deepEqual(switched.config, { url, headers: {}, hasAuthorization: true });
      assert.ok(
        !JSON.stringify(yield* setup.state).includes("synthetic-header"),
        "the Authorization value never reaches the browser",
      );
      assert.ok(store.tokens("linear", url), "the earlier sign-in survives the switch");

      const stale = yield* Effect.flip(
        setup.change({ action: "remove", name: "linear", removalKey: "stale" }),
      );
      assert.match(stale.detail, /changed|Refresh/);
      assert.ok(store.tokens("linear", url), "a stale removal keeps the credentials");

      // An unreadable credential store fails the removal and leaves the entry to retry.
      const stored = readFileSync(auth, "utf8");
      writeFileSync(auth, "{ not json");
      const failed = yield* Effect.flip(
        setup.change({ action: "remove", name: "linear", removalKey: switched.removalKey }),
      );
      assert.match(failed.detail, /Could not remove/);
      assert.ok(yield* linear(setup));
      assert.ok(json(file).mcpServers.linear, "the entry is kept for a retry");

      writeFileSync(auth, stored);
      yield* setup.change({
        action: "remove",
        name: "linear",
        removalKey: (yield* linear(setup))!.removalKey,
      });
      assert.deepEqual(json(file), { mcpServers: { notes: { url: notes } } });
      assert.equal(store.tokens("linear", url), undefined);
      assert.equal(store.tokens("notes", notes)?.access_token, "synthetic-notes");
      assert.doesNotMatch(readFileSync(auth, "utf8"), /synthetic-linear/);

      yield* setup.change({ action: "install", server: "linear" });
      const reinstalled = (yield* linear(setup))!;
      assert.deepEqual([reinstalled.oauth, reinstalled.signedIn], [true, false]);
    }),
  );
});

test("INV-01/12: a local command server configures its CLI, never signs in, and uninstall takes only its entry", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { custom: { untouched: true }, mcpServers: { other: { command: "do-not-run" } } });
      // Nothing to sign in to, installed or not: Pi starts a local command without OAuth.
      assert.equal(yield* server(setup, "paper"), undefined);
      assert.match((yield* Effect.flip(setup.signIn.start("paper"))).detail, /Add Paper MCP/);

      // Installing configures the relay; it does not install or look for the CLI, which an
      // isolated home (as the browser harness uses) does not have.
      assert.equal(existsSync(command(directory)), false);
      yield* setup.change({ action: "install", server: "paper" });
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: {
          other: { command: "do-not-run" },
          paper: { command: command(directory), args: ["mcp"] },
        },
      });
      const installed = (yield* server(setup, "paper"))!;
      assert.equal(installed.catalog, "paper");
      assert.deepEqual(installed.config, { command: command(directory), args: ["mcp"], env: {} });
      assert.equal(installed.oauth, false);
      assert.equal(installed.signedIn, false);
      assert.match((yield* Effect.flip(setup.signIn.start("paper"))).detail, /does not sign in/);
      assert.equal(
        (yield* Effect.result(setup.change({ action: "sign-out", name: "paper" })))._tag,
        "Failure",
      );
      assert.equal(existsSync(join(directory, "mcp-auth.json")), false, "no credential is stored");

      // Installing again keeps the user's entry as configured, and leaves the other server alone.
      yield* setup.change({ action: "install", server: "linear" });
      const before = readFileSync(file, "utf8");
      yield* setup.change({ action: "install", server: "paper" });
      assert.equal(readFileSync(file, "utf8"), before);

      const { removalKey } = (yield* server(setup, "paper"))!;
      yield* setup.change({ action: "remove", name: "paper", removalKey });
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: { other: { command: "do-not-run" }, linear: { url } },
      });
      assert.equal(yield* server(setup, "paper"), undefined);
      assert.ok(yield* server(setup, "linear"));
    }),
  );
});

test("INV-01/12: the user's own servers are added in Pi's shape, all or none, edited with Pi's other keys kept, and the Authorization value stays on the machine", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { custom: { untouched: true }, mcpServers: {} });
      const docsUrl = "https://docs.example.test/mcp";
      const docs = {
        url: docsUrl,
        headers: { Authorization: "Bearer private-docs", "x-org": "acme" },
        timeout: 30,
      };
      const tools = { command: "uvx", args: ["tools-mcp"], env: { API_KEY: "${TOOLS_KEY}" } };

      // The pasted `mcpServers` shape lands as written, with Pi's own keys intact.
      const added = yield* setup.change({
        action: "add",
        servers: [
          { name: "docs", config: docs },
          { name: "tools", config: tools },
        ],
      });
      assert.deepEqual(json(file), { custom: { untouched: true }, mcpServers: { docs, tools } });
      assert.deepEqual(names(added), ["docs", "tools"]);
      assert.deepEqual(available(added), ["linear", "paper"]);
      const [docsSetup, toolsSetup] = added.servers;
      assert.deepEqual(
        { ...docsSetup, removalKey: typeof docsSetup!.removalKey },
        {
          name: "docs",
          config: { url: docsUrl, headers: { "x-org": "acme" }, hasAuthorization: true },
          oauth: false,
          signedIn: false,
          removalKey: "string",
        },
      );
      assert.deepEqual(toolsSetup!.config, {
        command: "uvx",
        args: ["tools-mcp"],
        env: { API_KEY: "${TOOLS_KEY}" },
      });
      assert.equal(toolsSetup!.oauth, false);
      assert.ok(!JSON.stringify(added).includes("private-docs"), "no header value on the wire");

      // Refusals name the field; a batch with one bad entry writes nothing.
      const before = readFileSync(file, "utf8");
      const taken = yield* Effect.flip(
        setup.change({ action: "add", servers: [{ name: "docs", config: { url } }] }),
      );
      assert.deepEqual([taken.field, taken.detail], ["name", "Another MCP server is named docs."]);
      const invalid = yield* Effect.flip(
        setup.change({
          action: "add",
          servers: [
            { name: "fine", config: { url } },
            { name: "broken", config: { nope: true } },
          ],
        }),
      );
      assert.equal(invalid.field, "config");
      assert.match(invalid.detail, /broken/);
      const twice = yield* Effect.flip(
        setup.change({
          action: "add",
          servers: [
            { name: "dup", config: { url } },
            { name: "dup", config: { url } },
          ],
        }),
      );
      assert.equal(twice.field, "name");
      assert.equal(readFileSync(file, "utf8"), before);

      // Editing: a rename, new headers, the saved Authorization kept while the edit leaves it out.
      const edited = yield* setup.change({
        action: "update",
        name: "docs",
        removalKey: docsSetup!.removalKey,
        rename: "handbook",
        config: { url: docsUrl, headers: { "x-team": "platform" } },
      });
      assert.deepEqual(json(file).mcpServers.handbook, {
        url: docsUrl,
        headers: { Authorization: "Bearer private-docs", "x-team": "platform" },
        timeout: 30,
      });
      assert.equal(json(file).mcpServers.docs, undefined);
      assert.deepEqual(names(edited), ["tools", "handbook"]);
      const handbook = edited.servers.find((server) => server.name === "handbook")!;
      assert.deepEqual(handbook.config, {
        url: docsUrl,
        headers: { "x-team": "platform" },
        hasAuthorization: true,
      });

      // A stale identity refuses the edit; `null` removes the header, so Pi signs in instead.
      const stale = yield* Effect.flip(
        setup.change({
          action: "update",
          name: "handbook",
          removalKey: docsSetup!.removalKey,
          config: { url: docsUrl, headers: {} },
        }),
      );
      assert.match(stale.detail, /changed|Refresh/);
      const cleared = yield* setup.change({
        action: "update",
        name: "handbook",
        removalKey: handbook.removalKey,
        config: { url: docsUrl, headers: {}, authorization: null },
      });
      assert.deepEqual(json(file).mcpServers.handbook, { url: docsUrl, timeout: 30 });
      const signsIn = cleared.servers.find((server) => server.name === "handbook")!;
      assert.deepEqual(
        [signsIn.oauth, signsIn.config],
        [true, { url: docsUrl, headers: {}, hasAuthorization: false }],
      );

      // A change of transport drops the other transport's keys; Pi still validates the result.
      const switched = yield* setup.change({
        action: "update",
        name: "tools",
        removalKey: toolsSetup!.removalKey,
        config: { url: "https://tools.example.test/mcp", headers: {}, authorization: "Bearer t" },
      });
      assert.deepEqual(json(file).mcpServers.tools, {
        url: "https://tools.example.test/mcp",
        headers: { Authorization: "Bearer t" },
      });
      const toolsNow = switched.servers.find((server) => server.name === "tools")!;
      const rejected = yield* Effect.flip(
        setup.change({
          action: "update",
          name: "tools",
          removalKey: toolsNow.removalKey,
          config: { command: "", args: [], env: {} },
        }),
      );
      assert.equal(rejected.field, "config");
      assert.deepEqual(json(file).mcpServers.tools, {
        url: "https://tools.example.test/mcp",
        headers: { Authorization: "Bearer t" },
      });
    }),
  );
});

test("INV-01/12: renaming or re-pointing an OAuth entry drops its stored sign-in; Pi's MCP switch blocks every change", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      const store = new McpOAuthCredentialStore(
        new FileAuthStorageBackend(join(directory, "mcp-auth.json")),
        directory,
      );
      const signIn = (name: string, endpoint: string, token: string) =>
        store.forServer(name, endpoint).save({
          serverUrl: endpoint,
          tokens: { access_token: token, refresh_token: `${token}-refresh`, token_type: "Bearer" },
        });
      // The user's own entry at the catalog endpoint is Linear's, whatever its name.
      yield* setup.change({ action: "add", servers: [{ name: "mine", config: { url } }] });
      signIn("mine", url, "synthetic-mine");
      const mine = (yield* server(setup, "mine"))!;
      assert.deepEqual([mine.catalog, mine.oauth, mine.signedIn], ["linear", true, true]);
      assert.deepEqual(available(yield* setup.state), ["paper"]);
      yield* setup.change({ action: "install", server: "linear" });
      assert.equal(json(file).mcpServers.linear, undefined, "install keeps the matching entry");

      const renamed = yield* setup.change({
        action: "update",
        name: "mine",
        removalKey: mine.removalKey,
        rename: "theirs",
        config: { url, headers: {} },
      });
      assert.deepEqual(names(renamed), ["theirs"]);
      assert.equal(store.tokens("mine", url), undefined, "tokens under the old name are dropped");
      assert.equal(renamed.servers[0]!.signedIn, false);

      // A catalog server whose default name another entry holds says so instead of installing.
      save(file, { mcpServers: { linear: { url: "https://elsewhere.test/mcp" } } });
      const named = yield* setup.state;
      assert.deepEqual(named.available, [
        { id: "linear", detail: "Another MCP server is named linear." },
        { id: "paper" },
      ]);
      const refused = yield* Effect.flip(setup.change({ action: "install", server: "linear" }));
      assert.equal(refused.field, "name");

      // Pi's switch for all MCP: the page reports it and refuses to write.
      writeFileSync(
        join(directory, "settings.json"),
        JSON.stringify({ extensions: ["-builtin:mcp"] }),
      );
      const off = yield* setup.state;
      assert.match(off.problem ?? "", /switched off/);
      assert.deepEqual([off.servers, off.available], [[], []]);
      const text = readFileSync(file, "utf8");
      assert.equal(
        (yield* Effect.result(
          setup.change({ action: "add", servers: [{ name: "docs", config: { url } }] }),
        ))._tag,
        "Failure",
      );
      assert.equal(readFileSync(file, "utf8"), text);
    }),
  );
});

test("INV-11: the catalog carries no filesystem path; the server resolves a local CLI under the home directory", () => {
  const servers = Effect.runSync(
    Effect.gen(function* () {
      return (yield* McpSetupEnvironment).servers();
    }),
  );
  assert.deepEqual(
    servers.find((server) => server.id === "paper"),
    {
      id: "paper",
      name: "Paper",
      command: join(
        homedir(),
        ".paper",
        "bin",
        process.platform === "win32" ? "paper.exe" : "paper",
      ),
      args: ["mcp"],
    },
  );
  assert.deepEqual(
    servers.find((server) => server.id === "linear"),
    { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp" },
  );
  for (const entry of MCP_CATALOG)
    assert.equal(isAbsolute(entry.command?.home ?? ""), false, `${entry.name} sends a path`);
});
