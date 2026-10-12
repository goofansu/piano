import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { McpSetup, McpSetupEnvironment, McpSetupLive } from "../server/McpSetup.ts";
import { PiSessions } from "../server/PiSessions.ts";
import type { ProviderLoginState } from "../shared/wire.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
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
      const state = yield* setup.login;
      if (state && done(state)) return state;
      yield* Effect.sleep(5);
    }
  }).pipe(Effect.timeout("10 seconds"));
const linear = (setup: McpSetup["Service"]) =>
  Effect.map(setup.state, (state) => state.servers.find((server) => server.id === "linear")!);

test("INV-01/11/12: install, sign in by pasted redirect, sign out and uninstall a catalog MCP server through Pi", async () => {
  await fixture((setup, directory, url) =>
    Effect.gen(function* () {
      const file = join(directory, "mcp.json");
      save(file, { custom: { untouched: true }, mcpServers: { other: { command: "do-not-run" } } });
      assert.deepEqual(yield* linear(setup), {
        id: "linear",
        status: "missing",
        oauth: true,
        signedIn: false,
      });
      const notInstalled = yield* Effect.flip(setup.startLogin("linear"));
      assert.match(notInstalled.detail, /Install Linear MCP/);

      yield* setup.change({ action: "install", server: "linear" });
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: { other: { command: "do-not-run" }, linear: { url } },
      });
      const installed = yield* linear(setup);
      assert.equal(installed.status, "ready");
      assert.equal(installed.signedIn, false);

      yield* setup.startLogin("linear");
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
        setup.answerLogin(waiting.id, waiting.prompt!.id, wrongState.href),
      );
      assert.match(rejected.detail, /Paste the full address/);
      assert.equal((yield* setup.login)?.prompt?.id, waiting.prompt!.id);
      yield* setup.answerLogin(waiting.id, waiting.prompt!.id, redirect.href);
      const finished = yield* until(setup, (state) => state.status !== "running");
      assert.equal(finished.status, "success", finished.message);
      assert.ok(
        !JSON.stringify(finished).includes("private-"),
        "no token reaches the browser state",
      );
      assert.equal((yield* linear(setup)).signedIn, true);
      assert.match(readFileSync(join(directory, "mcp-auth.json"), "utf8"), /private-access-token/);

      // A second sign-in finds the stored token and asks nothing.
      yield* setup.startLogin("linear");
      assert.equal(
        (yield* until(setup, (state) => state.status !== "running")).message,
        "Already signed in to Linear.",
      );

      yield* setup.change({ action: "sign-out", server: "linear" });
      assert.equal((yield* linear(setup)).signedIn, false);
      assert.doesNotMatch(
        readFileSync(join(directory, "mcp-auth.json"), "utf8"),
        /private-access-token/,
      );

      const { removalKey } = yield* linear(setup);
      const stale = yield* Effect.flip(
        setup.change({ action: "uninstall", server: "linear", removalKey: "stale" }),
      );
      assert.match(stale.detail, /changed since|Refresh/);
      yield* setup.change({ action: "uninstall", server: "linear", removalKey: removalKey! });
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: { other: { command: "do-not-run" } },
      });
      assert.equal((yield* linear(setup)).status, "missing");
    }),
  );
});
