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

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Pi's argument syntax, not JavaScript's.
      const body =
        "Review the staged changes. Focus on ${1:-correctness, security, and error handling}.";
      const review = yield* prompts.create({
        name: "review",
        description: "Review staged git changes",
        argumentHint: "[focus]",
        body,
      });
      const expected = {
        name: "review",
        description: "Review staged git changes",
        argumentHint: "[focus]",
        // The file as saved, front matter included, as View shows and copies it.
        file: `---\ndescription: "Review staged git changes"\nargument-hint: "[focus]"\n---\n${body}\n`,
      };
      assert.deepEqual(review, expected);
      // A body that starts like front matter stays the body: the description keeps it out of the header.
      yield* prompts.create({
        name: "rule",
        description: "House rule",
        body: "---\nKeep it short.",
      });
      // A file put in the folder by hand, without a description: Pi cuts the first line at 60
      // characters, and the list says the same.
      const long = `${"Summarize the open pull requests ".repeat(3)}by risk.`;
      const triage = `${long}\nThen list the next steps.\n`;
      writeFileSync(join(dir, "triage.md"), triage);
      const cut = `${long.slice(0, 60)}...`;
      assert.deepEqual(yield* prompts.list, [
        expected,
        {
          name: "rule",
          description: "House rule",
          file: '---\ndescription: "House rule"\n---\n---\nKeep it short.\n',
        },
        { name: "triage", description: cut, file: triage },
      ]);

      const commands = (yield* sessions.probe(root)).commands.filter((c) => c.source === "prompt");
      assert.deepEqual(
        commands.map((c) => [c.name, c.description]).sort(),
        [
          ["personal", "Personal prompt"],
          ["review", "Review staged git changes"],
          ["rule", "House rule"],
          ["triage", cut],
        ],
        "Pi offers Piano's prompts beside its own",
      );

      const taken = yield* failure(
        prompts.create({ name: "review", description: "D.", body: "Other" }),
      );
      assert.deepEqual(
        [taken.field, taken.detail],
        ["name", "A prompt named review already exists."],
      );
      for (const name of [
        "",
        "../escape",
        "has space",
        "-dash",
        "dash-",
        "double--hyphen",
        "Review",
        "snake_case",
        "skill:x",
        "a".repeat(65),
      ])
        assert.equal(
          (yield* failure(prompts.create({ name, description: "D.", body: "x" }))).field,
          "name",
          name,
        );
      assert.equal(
        (yield* failure(prompts.create({ name: "blank", description: "D.", body: "  \n" }))).field,
        "body",
      );
      const tooLong = yield* failure(
        prompts.create({ name: "long", description: "d".repeat(1025), body: "x" }),
      );
      assert.deepEqual(
        [tooLong.field, tooLong.detail],
        ["description", "Keep it to 1,024 characters."],
      );
      assert.equal(
        (yield* failure(prompts.remove("../agent/prompts/personal"))).detail,
        "Prompt not found.",
      );

      yield* prompts.remove("review");
      yield* prompts.remove("review");
      assert.deepEqual(
        (yield* prompts.list).map((p) => p.name),
        ["rule", "triage"],
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
