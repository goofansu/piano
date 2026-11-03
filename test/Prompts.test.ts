import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { defaultPiCli, PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { Prompts, PromptsEnvironment, PromptsLive } from "../server/Prompts.ts";

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

      // `${...}` here is Pi's argument syntax, not a JavaScript template.
      const instructions =
        "Review the staged changes. Focus on ${1:-correctness, security, and error handling}.";
      const review = yield* prompts.create({
        name: "review",
        description: "Review staged git changes",
        instructions,
      });
      const expected = {
        name: "review",
        description: "Review staged git changes",
        // The file as saved, front matter included, as View shows and copies it.
        file: `---\ndescription: "Review staged git changes"\n---\n${instructions}\n`,
      };
      assert.deepEqual(review, expected);
      // Instructions that start like front matter stay the instructions: the description keeps them out of the header.
      yield* prompts.create({
        name: "rule",
        description: "House rule",
        instructions: "---\nKeep it short.",
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
        prompts.create({ name: "review", description: "D.", instructions: "Other" }),
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
          (yield* failure(prompts.create({ name, description: "D.", instructions: "x" }))).field,
          "name",
          name,
        );
      assert.equal(
        (yield* failure(prompts.create({ name: "blank", description: "D.", instructions: "  \n" })))
          .field,
        "instructions",
      );
      const tooLong = yield* failure(
        prompts.create({ name: "long", description: "d".repeat(1025), instructions: "x" }),
      );
      assert.deepEqual(
        [tooLong.field, tooLong.detail],
        ["description", "Keep it to 1,024 characters."],
      );
      assert.equal(
        (yield* failure(prompts.remove("../agent/prompts/personal"))).detail,
        "Prompt not found.",
      );

      // An update replaces a prompt Piano created, and a new Pi offers the new description.
      const updated = yield* prompts.update({
        name: "review",
        description: "Review the branch",
        instructions: "Review the branch against main.",
        previous: readFileSync(join(dir, "review.md"), "utf8"),
      });
      assert.equal(updated.file, readFileSync(join(dir, "review.md"), "utf8"));
      assert.equal(updated.description, "Review the branch");
      const offered = (yield* sessions.probe(root)).commands.find((c) => c.name === "review");
      assert.equal(offered?.description, "Review the branch", "a new Pi loads the update");
      // Pi's own prompt, an unknown name and a path are refused, and nothing is created.
      for (const name of ["personal", "missing", "../agent/prompts/personal"]) {
        const refused = yield* failure(
          prompts.update({ name, description: "D.", instructions: "x", previous: "" }),
        );
        assert.equal(refused.field, "name", name);
        if (name !== "../agent/prompts/personal") assert.equal(refused.detail, "Prompt not found.");
      }
      assert.equal(
        readFileSync(join(agent, "prompts", "personal.md"), "utf8"),
        "Personal prompt\n",
      );
      assert.equal(existsSync(join(dir, "missing.md")), false, "an update never creates");

      yield* prompts.remove("review");
      assert.equal(
        (yield* failure(prompts.remove("review"))).detail,
        "Prompt not found.",
        "one already gone is refused, as a skill is",
      );
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
      Effect.provideService(PromptsEnvironment, {
        directory: dir,
        agentDir: () => agent,
      }),
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

test("an update replaces only the prompt the person saw, and of two from one file one wins", async () => {
  const dir = join(root, "precondition", "prompts");
  const path = join(dir, "triage.md");
  await Effect.runPromise(
    Effect.gen(function* () {
      const prompts = yield* Prompts;
      const shown = (yield* prompts.create({
        name: "triage",
        description: "Triage",
        instructions: "One.",
      })).file;
      const update = (instructions: string, previous: string) =>
        prompts.update({ name: "triage", description: "Triage", instructions, previous });

      const matching = yield* update("Two.", shown);
      assert.equal(readFileSync(path, "utf8"), matching.file, "an update from the file on disk");

      // Two sessions proposed from the same file: the second no longer replaces what it showed.
      const [a, b] = yield* Effect.all(
        [
          Effect.result(update("Three.", matching.file)),
          Effect.result(update("Four.", matching.file)),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual([a._tag, b._tag].sort(), ["Failure", "Success"], "exactly one wins");
      const winner =
        a._tag === "Success" ? a.success : b._tag === "Success" ? b.success : undefined;
      assert.equal(readFileSync(path, "utf8"), winner?.file, "the loser wrote nothing");
      const loser = a._tag === "Failure" ? a.failure : b._tag === "Failure" ? b.failure : undefined;
      assert.deepEqual(
        [loser?.detail, loser?.field],
        ["This prompt changed since it was shown. Review it again.", undefined],
      );

      const before = readFileSync(path, "utf8");
      assert.equal((yield* failure(update("Five.", shown))).detail, loser?.detail, "stale");
      assert.equal(readFileSync(path, "utf8"), before, "a stale update writes nothing");
    }).pipe(
      Effect.provide(PromptsLive),
      Effect.provideService(PromptsEnvironment, {
        directory: dir,
        agentDir: () => join(root, "precondition", "agent"),
      }),
    ),
  );
});

test("a name Pi already loads from another prompts folder is refused, so Piano's never loses to it", async () => {
  const dir = join(root, "taken", "piano", "prompts");
  const theirs = join(root, "taken", "agent", "prompts");
  mkdirSync(theirs, { recursive: true });
  // Pi merges Piano's folder after its own and keeps the first prompt of each name.
  writeFileSync(join(theirs, "review.md"), "Theirs\n");
  writeFileSync(join(theirs, "target.md"), "Linked\n");
  symlinkSync(join(theirs, "target.md"), join(theirs, "linked.md"));
  // Pi skips a file whose front matter does not parse, so its name is free.
  writeFileSync(join(theirs, "broken.md"), "---\ndescription: [\n---\nBroken\n");
  await Effect.runPromise(
    Effect.gen(function* () {
      const prompts = yield* Prompts;
      for (const name of ["review", "linked"]) {
        const taken = yield* failure(
          prompts.create({ name, description: "Mine", instructions: "Mine" }),
        );
        assert.deepEqual(
          [taken.field, taken.detail],
          ["name", `A prompt named ${name} already exists.`],
        );
      }
      assert.equal(existsSync(join(dir, "review.md")), false, "a refused create writes nothing");
      assert.equal(readFileSync(join(theirs, "review.md"), "utf8"), "Theirs\n");
      yield* prompts.create({ name: "broken", description: "Mine", instructions: "Mine" });
      assert.deepEqual(
        (yield* prompts.list).map((p) => p.name),
        ["broken"],
      );

      // Piano's prompt came first, then Pi's folder gained one of its name: Pi runs that one, so
      // a change to Piano's would never reach a session. It is refused, and deleting still works.
      yield* prompts.create({ name: "deploy", description: "Mine", instructions: "Mine" });
      const mine = readFileSync(join(dir, "deploy.md"), "utf8");
      writeFileSync(join(theirs, "deploy.md"), "Theirs\n");
      const draft = { name: "deploy", description: "Mine", instructions: "Changed" };
      const hidden = ["name", "Pi loads another prompt named deploy instead of this one."];
      const proposed = yield* failure(prompts.propose(draft));
      assert.deepEqual([proposed.field, proposed.detail], hidden);
      const updated = yield* failure(prompts.update({ ...draft, previous: mine }));
      assert.deepEqual([updated.field, updated.detail], hidden);
      assert.equal(
        readFileSync(join(dir, "deploy.md"), "utf8"),
        mine,
        "a refused update writes nothing",
      );
      assert.deepEqual(
        (yield* prompts.list).map((p) => p.name),
        ["broken", "deploy"],
        "listed, so it can be deleted",
      );
      yield* prompts.remove("deploy");
      assert.equal(existsSync(join(dir, "deploy.md")), false);
      assert.equal(readFileSync(join(theirs, "deploy.md"), "utf8"), "Theirs\n");
    }).pipe(
      Effect.provide(PromptsLive),
      Effect.provideService(PromptsEnvironment, {
        directory: dir,
        agentDir: () => join(root, "taken", "agent"),
      }),
    ),
  );
});

test("a name Pi loads from a folder its settings list is refused; one it turns off is free", async () => {
  const dir = join(root, "settings", "piano", "prompts");
  const agent = join(root, "settings", "agent");
  const listed = join(root, "settings", "listed-prompts");
  mkdirSync(listed, { recursive: true });
  mkdirSync(join(agent, "prompts"), { recursive: true });
  writeFileSync(join(listed, "listed.md"), "From settings\n");
  writeFileSync(join(agent, "prompts", "off.md"), "Turned off\n");
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ prompts: [listed, "-prompts/off.md"] }),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const prompts = yield* Prompts;
      const draft = { name: "listed", description: "Mine", instructions: "Mine" };
      for (const refused of [
        yield* failure(prompts.propose(draft)),
        yield* failure(prompts.create(draft)),
      ])
        assert.deepEqual(
          [refused.field, refused.detail],
          ["name", "A prompt named listed already exists."],
        );
      assert.equal(existsSync(join(dir, "listed.md")), false, "a refused create writes nothing");
      yield* prompts.create({ name: "off", description: "Mine", instructions: "Mine" });
      assert.deepEqual(
        (yield* prompts.list).map((p) => p.name),
        ["off"],
        "Pi does not load a prompt its settings turn off",
      );
    }).pipe(
      Effect.provide(PromptsLive),
      Effect.provideService(PromptsEnvironment, { directory: dir, agentDir: () => agent }),
    ),
  );
});

test("a prompt placed by hand under a name Piano would not create is listed and deleted as Pi loads it", async () => {
  const dir = join(root, "by-hand", "prompts");
  mkdirSync(dir, { recursive: true });
  // Pi offers this as /Review; New prompt would refuse the name, but the file is Piano's to delete.
  writeFileSync(join(dir, "Review.md"), "Review by hand\n");
  writeFileSync(join(dir, "elsewhere-target.md"), "Linked\n");
  symlinkSync(join(dir, "elsewhere-target.md"), join(dir, "link.md"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const prompts = yield* Prompts;
      assert.deepEqual(
        (yield* prompts.list).map((p) => p.name),
        ["elsewhere-target", "Review"],
        "a link is not listed",
      );
      yield* prompts.remove("Review");
      assert.equal(existsSync(join(dir, "Review.md")), false);
      assert.equal((yield* failure(prompts.remove("link"))).detail, "Prompt not found.");
      assert.ok(existsSync(join(dir, "link.md")), "a link is not deleted");
    }).pipe(
      Effect.provide(PromptsLive),
      Effect.provideService(PromptsEnvironment, {
        directory: dir,
        agentDir: () => join(root, "by-hand", "agent"),
      }),
    ),
  );
});

test("a prompt Piano cannot read refuses its own save, never another prompt's", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root reads any file");
  const dir = join(root, "unreadable", "prompts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "locked.md"), "Locked\n");
  chmodSync(join(dir, "locked.md"), 0o000);
  t.after(() => chmodSync(join(dir, "locked.md"), 0o600));
  await Effect.runPromise(
    Effect.gen(function* () {
      const prompts = yield* Prompts;
      const draft = { name: "open", description: "Open", instructions: "Read me." };
      assert.equal((yield* prompts.propose(draft)).change, "create");
      assert.equal((yield* prompts.create(draft)).name, "open");
      assert.equal(
        (yield* failure(prompts.propose({ ...draft, name: "locked" }))).detail,
        "Could not save prompt.",
      );
    }).pipe(
      Effect.provide(PromptsLive),
      Effect.provideService(PromptsEnvironment, {
        directory: dir,
        agentDir: () => join(root, "unreadable", "agent"),
      }),
    ),
  );
});
