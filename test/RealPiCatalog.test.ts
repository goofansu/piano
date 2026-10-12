import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { defaultPiCli, PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

test("fresh Radius gateway discovers models and refresh reads changed availability", async () => {
  const root = mkdtempSync(join(tmpdir(), "piano-catalog-"));
  const agent = join(root, "agent");
  mkdirSync(agent);
  let id = "first";
  let requests = 0;
  const args = ["--no-extensions"];
  const endpoint = createServer((request, response) => {
    assert.equal(request.url, "/v1/config");
    requests++;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        baseUrl: "http://127.0.0.1/v1",
        models: [
          {
            id,
            name: id,
            reasoning: false,
            input: ["text"],
            contextWindow: 10000,
            maxTokens: 100,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  const gateway = `http://127.0.0.1:${(endpoint.address() as { port: number }).port}`;
  writeFileSync(
    join(agent, "models.json"),
    JSON.stringify({ providers: { "scratch-radius": { baseUrl: gateway, oauth: "radius" } } }),
  );
  writeFileSync(
    join(agent, "auth.json"),
    JSON.stringify({ "scratch-radius": { type: "api_key", key: "scratch-key" } }),
  );
  const settings = join(agent, "settings.json");
  writeFileSync(
    settings,
    JSON.stringify({
      defaultProvider: "scratch-radius",
      defaultModel: "first",
      cacheWarming: "off",
    }),
  );
  const shim = join(root, "cli.mjs");
  writeFileSync(
    shim,
    `for(const key of Object.keys(process.env)) if(key!=="PATH") delete process.env[key];
process.env.HOME=${JSON.stringify(root)};
process.env.PI_CODING_AGENT_DIR=${JSON.stringify(agent)};
process.env.PI_SKIP_VERSION_CHECK="1";
process.env.PI_TELEMETRY="0";
const fetchLocal = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "127.0.0.1") return Promise.resolve(new Response("External network disabled in catalog fixture", { status: 404 }));
  return fetchLocal(input, options);
};
await import(${JSON.stringify(pathToFileURL(defaultPiCli().cli).href)});`,
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* PiSessions;
        const first = yield* sessions.probe(root);
        assert.ok(
          first.models.some((model) => model.provider === "scratch-radius" && model.id === "first"),
        );
        id = "second";
        writeFileSync(
          settings,
          JSON.stringify({
            defaultProvider: "scratch-radius",
            defaultModel: "second",
            cacheWarming: "off",
          }),
        );
        const second = yield* sessions.probe(root);
        assert.ok(
          second.models.some(
            (model) => model.provider === "scratch-radius" && model.id === "second",
          ),
        );
        assert.ok(
          !second.models.some(
            (model) => model.provider === "scratch-radius" && model.id === "first",
          ),
        );
        assert.ok(requests >= 2, "each probe completes gateway discovery");
      }).pipe(
        Effect.provide(PiSessionsLive),
        Effect.provide(NodeServices.layer),
        Effect.provideService(PiCli, { node: process.execPath, cli: shim, extraArgs: args }),
        Effect.timeout("40 seconds"),
      ),
    );
  } finally {
    endpoint.closeAllConnections();
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
