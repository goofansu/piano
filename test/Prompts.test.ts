import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { defaultPiCli, PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { Prompts, PromptsDir, PromptsLive } from "../server/Prompts.ts";

const root = mkdtempSync(join(tmpdir(), "piano-prompts-"));
after(() => rmSync(root, { recursive: true, force: true }));

const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.flip(effect);

test("a prompt created in Piano is listed alone and offered by Pi as a / command", async () => {
  const dir = join(root, "data", "prompts");
  const agent = join(root, "agent");
  mkdirSync(join(agent, "prompts"), { recursive: true });
  // Pi's own personal prompt: Pi offers it, but Piano did not create it.
  writeFileSync(join(agent, "prompts", "personal.md"), "Personal prompt\n");
  // A Pi isolated from this machine's settings, credentials and network.
  const shim = join(root, "cli.mjs");
  writeFileSync(
    shim,
    `for (const key of Object.keys(process.env)) if (key !== "PATH") delete process.env[key];
process.env.HOME = ${JSON.stringify(root)};
process.env.PI_CODING_AGENT_DIR = ${JSON.stringify(agent)};
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";
globalThis.fetch = () => Promise.resolve(new Response("offline", { status: 404 }));
await import(${JSON.stringify(pathToFileURL(defaultPiCli().cli).href)});`,
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const prompts = yield* Prompts;
      const sessions = yield* PiSessions;
      assert.deepEqual(yield* prompts.list, [], "no folder yet reads as no prompts");

      const review = yield* prompts.create({
        name: "review",
        description: "Review staged git changes",
        argumentHint: "[focus]",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Pi's argument syntax, not JavaScript's.
        body: "Review the staged changes. Focus on ${1:-correctness, security, and error handling}.",
      });
      const expected = {
        name: "review",
        description: "Review staged git changes",
        argumentHint: "[focus]",
      };
      assert.deepEqual(review, expected);
      // A body that starts like front matter stays the body; no description falls back as Pi's does.
      yield* prompts.create({ name: "rule", body: "---\nKeep it short." });
      assert.deepEqual(yield* prompts.list, [expected, { name: "rule", description: "---" }]);

      const commands = (yield* sessions.probe(root)).commands.filter((c) => c.source === "prompt");
      assert.deepEqual(
        commands.map((c) => [c.name, c.description]).sort(),
        [
          ["personal", "Personal prompt"],
          ["review", "Review staged git changes"],
          ["rule", "---"],
        ],
        "Pi offers Piano's prompts beside its own",
      );

      const taken = yield* failure(prompts.create({ name: "review", body: "Other" }));
      assert.deepEqual([taken.field, taken.detail], ["name", "/review already exists."]);
      for (const name of ["", "../escape", "has space", "-dash", "skill:x"])
        assert.equal((yield* failure(prompts.create({ name, body: "x" }))).field, "name", name);
      assert.equal((yield* failure(prompts.create({ name: "blank", body: "  \n" }))).field, "body");
      assert.equal(
        (yield* failure(prompts.remove("../agent/prompts/personal"))).detail,
        "Prompt not found.",
      );

      yield* prompts.remove("review");
      yield* prompts.remove("review");
      assert.deepEqual(
        (yield* prompts.list).map((p) => p.name),
        ["rule"],
      );
      const after = (yield* sessions.probe(root)).commands.map((c) => c.name);
      assert.ok(!after.includes("review"), "a deleted prompt is not offered to new sessions");
      assert.ok(after.includes("personal"), "deleting never touches Pi's own prompts");
    }).pipe(
      Effect.provide(Layer.mergeAll(PromptsLive, PiSessionsLive)),
      Effect.provide(NodeServices.layer),
      Effect.provideService(PromptsDir, dir),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: shim,
        extraArgs: ["--no-extensions"],
        promptTemplates: [dir],
      }),
      Effect.timeout("40 seconds"),
    ),
  );
});
