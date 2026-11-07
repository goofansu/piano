import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { defaultPiCli, PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

// The locked Pi and bundled provider are real; only Claude's auth-status boundary is fake.
// No developer settings, credentials, real Claude executable or model requests are used.
for (const status of ["signed-in", "signed-out", "missing"] as const) {
  test(
    `bundled Claude Code: ${status} availability leaves another provider usable`,
    {
      skip:
        status === "signed-in" &&
        "Quarantined: Pi catalog-refresh startup race can omit signed-in Claude Code models (#593; unresolved)",
    },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "piano-claude-code-"));
      const agent = join(root, "agent");
      mkdirSync(agent);
      const signedIn = status === "signed-in";
      const command = join(root, "claude");
      if (status !== "missing") {
        writeFileSync(
          command,
          `#!${process.execPath}
if (process.argv.slice(2).join(" ") !== "auth status") process.exit(2);
console.log(JSON.stringify({ loggedIn: ${signedIn}, subscriptionType: "max" }));
process.exit(${signedIn ? 0 : 1});
`,
          { mode: 0o700 },
        );
      }
      writeFileSync(
        join(agent, "models.json"),
        JSON.stringify({
          providers: {
            "scratch-other": {
              api: "openai-completions",
              baseUrl: "http://127.0.0.1:1/v1",
              apiKey: "not-a-credential",
              models: [
                {
                  id: "other",
                  name: "Other provider",
                  reasoning: false,
                  input: ["text"],
                  contextWindow: 1000,
                  maxTokens: 100,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        }),
      );
      writeFileSync(
        join(agent, "settings.json"),
        JSON.stringify({
          defaultProvider: "scratch-other",
          defaultModel: "other",
          cacheWarming: "off",
        }),
      );
      const shim = join(root, "cli.mjs");
      writeFileSync(
        shim,
        `for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, ${JSON.stringify({
          HOME: root,
          PI_CODING_AGENT_DIR: agent,
          PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
          PI_CLAUDE_CODE_COMMAND: command,
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
          PI_TELEMETRY: "0",
        })});
await import(${JSON.stringify(new URL("../server/PiRpcCli.ts", import.meta.url).href)});
`,
      );
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const sessions = yield* PiSessions;
            const catalog = yield* sessions.probe(root);
            assert.equal(
              catalog.models.some((model) => model.provider === "claude-code"),
              signedIn,
              JSON.stringify(catalog),
            );
            assert.ok(catalog.models.some((model) => model.provider === "scratch-other"));
            const session = yield* sessions.open({ cwd: root, sessionId: `claude-${status}` });
            assert.equal((yield* session.state).model, "scratch-other/other");
            assert.ok(
              (yield* session.commands).some((command) => command.name === "claude-code-status"),
            );
          }).pipe(
            Effect.scoped,
            Effect.provide(PiSessionsLive),
            Effect.provide(NodeServices.layer),
            Effect.provideService(PiCli, { ...defaultPiCli(), cli: shim, extraArgs: [] }),
            Effect.timeout("30 seconds"),
          ),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
