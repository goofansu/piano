import assert from "node:assert/strict";
import {
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
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { defaultPiCli, PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { UserSkills, UserSkillsEnvironment, UserSkillsLive } from "../server/UserSkills.ts";
import { checkDraft, TEXT_MAX } from "../shared/drafts.ts";

/**
 * A throwaway home: Piano's skills folder, and the folders Pi loads user skills from besides it.
 * Pi reads `~/.agents/skills` from `HOME`, so the test's home is `HOME` until it ends.
 */
function home(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "piano-skills-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  t.after(() => {
    process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  });
  const directory = join(root, "piano", "skills");
  const agentsDirectory = join(root, ".agents", "skills");
  const piDirectory = join(root, ".pi", "agent", "skills");
  const run = <A, E>(f: (skills: UserSkills["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.flatMap(UserSkills, f).pipe(
        Effect.provide(UserSkillsLive),
        Effect.provideService(UserSkillsEnvironment, {
          directory: () => directory,
          agentDir: () => join(root, ".pi", "agent"),
        }),
        Effect.result,
      ),
    );
  return { root, directory, agentsDirectory, piDirectory, run };
}

const write = (dir: string, name: string, frontmatter: string, body = "Do it.") => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
};

const refusal = (result: { _tag: string; failure?: unknown }) => {
  assert.equal(result._tag, "Failure");
  return result.failure as { detail: string; field?: string };
};

test("a created skill is one Pi loads as written, and is listed with its instructions", async (t) => {
  const { directory, run } = home(t);
  // Quotes, a colon and a newline would break a hand-written YAML scalar.
  const description = 'Writes "release notes": use when asked.\nAlso changelogs.';
  const instructions = "# Notes\n\nRead PRs.";
  for (const [name, disableModelInvocation] of [
    ["release-notes", false],
    ["deploy", true],
  ] as const)
    assert.equal(
      (
        await run((skills) =>
          skills.create({
            name,
            description,
            instructions: `${instructions}\n`,
            disableModelInvocation,
          }),
        )
      )._tag,
      "Success",
    );
  const loaded = loadSkillsFromDir({ dir: directory, source: "user" });
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(
    loaded.skills
      .map(({ name, description, disableModelInvocation }) => ({
        name,
        description,
        disableModelInvocation,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "deploy", description, disableModelInvocation: true },
      { name: "release-notes", description, disableModelInvocation: false },
    ],
    "the flag is written as Pi's disable-model-invocation",
  );
  const file = readFileSync(join(directory, "release-notes", "SKILL.md"), "utf8");
  assert.match(file, /Read PRs\.\n$/);
  assert.doesNotMatch(file, /created-by/, "Piano's folder marks its skills; the file need not");
  const listed = await run((skills) => skills.list);
  // Each skill comes with its SKILL.md exactly as saved, which View shows and copies.
  const saved = (name: string) => readFileSync(join(directory, name, "SKILL.md"), "utf8");
  assert.deepEqual(listed._tag === "Success" && listed.success, [
    {
      name: "deploy",
      description,
      file: saved("deploy"),
      disableModelInvocation: true,
    },
    {
      name: "release-notes",
      description,
      file: saved("release-notes"),
      disableModelInvocation: false,
    },
  ]);
});

test("only skills in Piano's folder are listed or deleted", async (t) => {
  const { directory, agentsDirectory, run } = home(t);
  // A skill in another folder Pi loads, even one an earlier Piano marked, is not Piano's to list.
  write(
    agentsDirectory,
    "elsewhere",
    "name: elsewhere\ndescription: Not here.\nmetadata:\n  created-by: piano",
  );
  // A linked directory in Piano's folder is the user's repository.
  const repo = mkdtempSync(join(tmpdir(), "piano-skills-repo-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  write(repo, "linked", "name: linked\ndescription: Linked.");
  mkdirSync(directory, { recursive: true });
  symlinkSync(join(repo, "linked"), join(directory, "linked"));
  // Written by hand into Piano's folder: no marker, still Piano's.
  write(directory, "by-hand", "name: by-hand\ndescription: By hand.");
  await run((skills) => skills.create({ name: "mine", description: "Mine.", instructions: "Go." }));

  const listed = await run((skills) => skills.list);
  assert.deepEqual(listed._tag === "Success" && listed.success.map((s) => s.name), [
    "by-hand",
    "mine",
  ]);

  for (const name of ["elsewhere", "linked", "../elsewhere"])
    assert.equal(refusal(await run((skills) => skills.remove(name))).detail, "Skill not found.");
  assert.ok(existsSync(join(agentsDirectory, "elsewhere", "SKILL.md")));
  assert.ok(existsSync(join(repo, "linked", "SKILL.md")));

  assert.equal((await run((skills) => skills.remove("mine")))._tag, "Success");
  assert.equal(existsSync(join(directory, "mine")), false);
});

test("a skill whose SKILL.md names it differently from its directory is listed, updated and deleted as Pi loads it", async (t) => {
  const { directory, run } = home(t);
  // Edited by hand (or by an agent): the directory says notes, the file says other.
  write(directory, "notes", "name: other\ndescription: Renamed.");
  assert.deepEqual(
    loadSkillsFromDir({ dir: directory, source: "user" }).skills.map((skill) => skill.name),
    ["other"],
    "Pi loads it as other",
  );

  const listed = await run((skills) => skills.list);
  assert.deepEqual(listed._tag === "Success" && listed.success.map((s) => s.name), ["other"]);

  const path = join(directory, "notes", "SKILL.md");
  const updated = await run((skills) =>
    skills.update({
      name: "other",
      description: "Renamed.",
      instructions: "Again.",
      previous: readFileSync(path, "utf8"),
    }),
  );
  assert.equal(updated._tag, "Success");
  assert.match(readFileSync(path, "utf8"), /Again\.\n$/);

  assert.equal((await run((skills) => skills.remove("other")))._tag, "Success");
  assert.equal(existsSync(join(directory, "notes")), false, "its directory goes with it");
  assert.deepEqual(loadSkillsFromDir({ dir: directory, source: "user" }).skills, []);
});

test("of two skills in Piano's folder that declare one name, only the one Pi loads is acted on", async (t) => {
  const { directory, run } = home(t);
  // Pi reads the nested one first and drops the top-level one as a collision.
  write(join(directory, "a-group"), "x", "name: x\ndescription: Nested.");
  write(directory, "x", "name: x\ndescription: Top level.");
  assert.deepEqual(
    loadSkillsFromDir({ dir: directory, source: "user" }).skills.map((s) => s.description),
    ["Nested.", "Top level."],
  );
  const listed = await run((skills) => skills.list);
  assert.deepEqual(
    listed._tag === "Success" && listed.success,
    [],
    "the skill Pi ignores is not listed",
  );
  assert.equal(refusal(await run((skills) => skills.remove("x"))).detail, "Skill not found.");
  assert.ok(existsSync(join(directory, "x", "SKILL.md")));
});

test("a Piano skill Pi loads another of first is refused an update and can still be deleted", async (t) => {
  const { directory, agentsDirectory, run } = home(t);
  await run((skills) =>
    skills.create({ name: "deploy", description: "Mine.", instructions: "Go." }),
  );
  const mine = readFileSync(join(directory, "deploy", "SKILL.md"), "utf8");
  // Installed later into a folder Pi loads before Piano's: every session now runs this one.
  write(agentsDirectory, "deploy", "name: deploy\ndescription: Theirs.");
  const draft = { name: "deploy", description: "Mine.", instructions: "Changed." };
  const hidden = ["Pi loads another skill named deploy instead of this one.", "name"];
  const proposed = refusal(await run((skills) => skills.propose(draft)));
  assert.deepEqual([proposed.detail, proposed.field], hidden);
  const updated = refusal(await run((skills) => skills.update({ ...draft, previous: mine })));
  assert.deepEqual([updated.detail, updated.field], hidden);
  assert.equal(readFileSync(join(directory, "deploy", "SKILL.md"), "utf8"), mine);
  const listed = await run((skills) => skills.list);
  assert.deepEqual(listed._tag === "Success" && listed.success.map((s) => s.name), ["deploy"]);
  assert.equal((await run((skills) => skills.remove("deploy")))._tag, "Success");
  assert.equal(existsSync(join(directory, "deploy")), false);
  assert.ok(existsSync(join(agentsDirectory, "deploy", "SKILL.md")), "theirs is untouched");
});

test("a name Pi loads from a folder or package its settings list is refused; one it turns off is free", async (t) => {
  const { root, directory, piDirectory, run } = home(t);
  // Pi's settings add a folder and a package before Piano's, and turn off one of Pi's own skills.
  const listed = join(root, "listed-skills");
  write(listed, "listed", "name: listed\ndescription: From settings.");
  const pkg = join(root, "a-package");
  write(join(pkg, "skills"), "packaged", "name: packaged\ndescription: From a package.");
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "a-package", pi: { skills: ["./skills"] } }),
  );
  write(piDirectory, "off", "name: off\ndescription: Turned off.");
  writeFileSync(
    join(root, ".pi", "agent", "settings.json"),
    JSON.stringify({ skills: [listed, "-skills/off"], packages: [pkg] }),
  );
  for (const name of ["listed", "packaged"]) {
    const draft = { name, description: "Mine.", instructions: "Go." };
    for (const result of [await run((s) => s.propose(draft)), await run((s) => s.create(draft))])
      assert.deepEqual(
        [refusal(result).detail, refusal(result).field],
        [`A skill named ${name} already exists.`, "name"],
        name,
      );
    assert.equal(existsSync(join(directory, name)), false, "a refused create writes nothing");
  }
  const free = await run((s) =>
    s.create({ name: "off", description: "Mine.", instructions: "Go." }),
  );
  assert.equal(free._tag, "Success", "Pi does not load a skill its settings turn off");
});

test("a create names the field it refuses and never overwrites a skill", async (t) => {
  const { directory, agentsDirectory, piDirectory, run } = home(t);
  write(directory, "taken", "name: taken\ndescription: Already here.", "Original.");
  write(piDirectory, "pi-own", "name: pi-own\ndescription: Pi's own.");
  write(agentsDirectory, "agents-own", "name: agents-own\ndescription: Shared.");
  const create = (name: string, description = "D.", instructions = "I.") =>
    run((skills) => skills.create({ name, description, instructions }));

  for (const name of ["Release", "-x", "a--b", "a_b", "../escape", "a".repeat(65)])
    assert.equal(refusal(await create(name)).field, "name", name);
  const taken = refusal(await create("taken"));
  assert.deepEqual([taken.detail, taken.field], ["A skill named taken already exists.", "name"]);
  assert.equal(refusal(await create("pi-own")).field, "name", "a name Pi already loads");
  assert.equal(refusal(await create("agents-own")).field, "name", "a name Pi loads from ~/.agents");
  assert.equal(refusal(await create("ok", "  ")).field, "description");
  assert.equal(refusal(await create("ok", "D.", "\n")).field, "instructions");
  const max = "x".repeat(TEXT_MAX);
  assert.equal(refusal(await create("ok", "D.", `${max}x`)).field, "instructions");
  assert.equal(refusal(await create("ok", "d".repeat(1025))).field, "description");
  assert.match(readFileSync(join(directory, "taken", "SKILL.md"), "utf8"), /Original\./);
  // The limit counts what is saved: surrounding whitespace does not push a body over it.
  assert.equal((await create("at-limit", "D.", `\n${max}\n\n`))._tag, "Success");
  assert.equal(existsSync(join(directory, "ok")), false);
});

test("the New skill rule accepts only a filled, well-formed, in-bounds draft", () => {
  const draft = (name: string) => checkDraft({ name, description: "D.", instructions: "I." });
  for (const name of ["a", "release-notes", "v2-api", "x".repeat(64)])
    assert.ok(draft(name).saved, name);
  for (const name of ["-a", "a-", "a--b", "A", "a b", "a_b", "x".repeat(65)])
    assert.equal(draft(name).saved, undefined, name);
  assert.equal(draft("Release").malformedName, true);
  assert.equal(draft("").malformedName, false, "a blank name is missing, not malformed");
  assert.equal(draft("  ok  ").saved?.name, "ok", "the saved draft is trimmed");
  assert.equal(
    checkDraft({ name: "ok", description: "D.", instructions: " " }).saved,
    undefined,
    "every field is required",
  );
});

test("an update replaces only the SKILL.md the person saw, and of two from one file one wins", async (t) => {
  const { directory, run } = home(t);
  const created = await run((skills) =>
    skills.create({ name: "notes", description: "D.", instructions: "One." }),
  );
  assert.ok(created._tag === "Success");
  const shown = created.success.file;
  const path = join(directory, "notes", "SKILL.md");
  const update = (instructions: string, previous: string) =>
    run((skills) =>
      skills.update({
        name: "notes",
        description: "D.",
        instructions,
        previous,
      }),
    );

  const matching = await update("Two.", shown);
  assert.ok(matching._tag === "Success", "an update from the file on disk is written");
  assert.equal(readFileSync(path, "utf8"), matching.success.file);

  // Two sessions proposed from the same file: the second no longer replaces what it showed.
  const [a, b] = await Promise.all([
    update("Three.", matching.success.file),
    update("Four.", matching.success.file),
  ]);
  assert.deepEqual([a._tag, b._tag].sort(), ["Failure", "Success"], "exactly one wins");
  const winner = a._tag === "Success" ? a.success : b._tag === "Success" ? b.success : undefined;
  assert.equal(readFileSync(path, "utf8"), winner?.file, "the loser wrote nothing");
  const loser = refusal(a._tag === "Failure" ? a : b);
  assert.deepEqual(
    [loser.detail, loser.field],
    ["This skill changed since it was shown. Review it again.", undefined],
  );

  const before = readFileSync(path, "utf8");
  assert.equal(
    refusal(await update("Five.", shown)).detail,
    loser.detail,
    "a stale file is refused",
  );
  assert.equal(readFileSync(path, "utf8"), before, "and nothing is written");
});

test("a name YAML would read as a number is written and listed as the skill's name", async (t) => {
  const { directory, run } = home(t);
  const created = await run((skills) =>
    skills.create({ name: "123", description: "456", instructions: "456" }),
  );
  assert.equal(created._tag, "Success");
  assert.deepEqual(
    loadSkillsFromDir({ dir: directory, source: "user" }).skills.map((skill) => skill.name),
    ["123"],
  );
  // A skill written before names were quoted: Pi falls back to the directory's name, and so does Piano.
  write(directory, "2024", 'name: 2024\ndescription: "D."\nmetadata:\n  created-by: piano');
  const listed = await run((skills) => skills.list);
  assert.deepEqual(listed._tag === "Success" && listed.success.map((skill) => skill.name), [
    "123",
    "2024",
  ]);
  assert.equal((await run((skills) => skills.remove("2024")))._tag, "Success");
});

test("Pi loads the skills in Piano's folder through --skill, and only Piano's Pi does", async (t) => {
  const { directory, run } = home(t);
  await run((skills) =>
    skills.create({
      name: "release-notes",
      description: "Writes notes.",
      instructions: "Go.",
    }),
  );
  const root = mkdtempSync(join(tmpdir(), "piano-skills-pi-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // A Pi isolated from this machine's settings, credentials and network.
  const shim = join(root, "cli.mjs");
  writeFileSync(
    shim,
    `for (const key of Object.keys(process.env)) if (key !== "PATH") delete process.env[key];
process.env.HOME = ${JSON.stringify(root)};
process.env.PI_CODING_AGENT_DIR = ${JSON.stringify(join(root, "agent"))};
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";
globalThis.fetch = () => Promise.resolve(new Response("offline", { status: 404 }));
await import(${JSON.stringify(pathToFileURL(defaultPiCli().cli).href)});`,
  );
  const skillCommands = (skills: readonly string[]) =>
    Effect.runPromise(
      Effect.flatMap(PiSessions, (sessions) => sessions.probe(root)).pipe(
        Effect.map((probe) =>
          probe.commands.filter((c) => c.source === "skill").map((c) => [c.name, c.description]),
        ),
        Effect.provide(PiSessionsLive),
        Effect.provide(NodeServices.layer),
        Effect.provideService(PiCli, {
          node: process.execPath,
          cli: shim,
          extraArgs: ["--no-extensions"],
          skills,
        }),
        Effect.timeout("40 seconds"),
      ),
    );
  assert.deepEqual(await skillCommands([directory]), [["skill:release-notes", "Writes notes."]]);
  assert.deepEqual(await skillCommands([]), [], "a Pi run without Piano's folder does not load it");
});

test("an update replaces only a skill Piano created, and a new Pi loads the new content", async (t) => {
  const { directory, agentsDirectory, piDirectory, run } = home(t);
  write(agentsDirectory, "agents-own", "name: agents-own\ndescription: Shared.", "Theirs.");
  write(piDirectory, "pi-own", "name: pi-own\ndescription: Pi's own.", "Pi's.");
  await run((skills) =>
    skills.create({
      name: "notes",
      description: "Writes notes.",
      instructions: "Old.",
    }),
  );
  // Each update replaces the file as it is on disk; a name with no Piano skill has none.
  const shown = (name: string) => {
    const path = join(directory, name, "SKILL.md");
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  const update = (name: string, description = "D.", instructions = "I.") =>
    run((skills) => skills.update({ name, description, instructions, previous: shown(name) }));

  const updated = await update("notes", "Writes release notes.", "New.");
  assert.equal(updated._tag, "Success");
  const file = readFileSync(join(directory, "notes", "SKILL.md"), "utf8");
  assert.equal(
    updated._tag === "Success" && updated.success.file,
    file,
    "it answers the file as saved",
  );
  assert.match(file, /New\.\n$/);
  assert.deepEqual(
    loadSkillsFromDir({ dir: directory, source: "user" }).skills.map((s) => [
      s.name,
      s.description,
    ]),
    [["notes", "Writes release notes."]],
  );

  for (const name of ["agents-own", "pi-own", "missing"]) {
    const refused = refusal(await update(name));
    assert.deepEqual([refused.detail, refused.field], ["Skill not found.", "name"], name);
  }
  assert.equal(refusal(await update("../escape")).field, "name", "the name rule keeps it inside");
  assert.match(readFileSync(join(agentsDirectory, "agents-own", "SKILL.md"), "utf8"), /Theirs\./);
  assert.match(readFileSync(join(piDirectory, "pi-own", "SKILL.md"), "utf8"), /Pi's\./);
  assert.equal(existsSync(join(directory, "missing")), false, "an update never creates");
  assert.equal(refusal(await update("notes", "  ")).field, "description");

  // A real, isolated Pi started from now loads what the update wrote.
  const root = mkdtempSync(join(tmpdir(), "piano-skills-update-pi-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shim = join(root, "cli.mjs");
  writeFileSync(
    shim,
    `for (const key of Object.keys(process.env)) if (key !== "PATH") delete process.env[key];
process.env.HOME = ${JSON.stringify(root)};
process.env.PI_CODING_AGENT_DIR = ${JSON.stringify(join(root, "agent"))};
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";
globalThis.fetch = () => Promise.resolve(new Response("offline", { status: 404 }));
await import(${JSON.stringify(pathToFileURL(defaultPiCli().cli).href)});`,
  );
  const commands = await Effect.runPromise(
    Effect.flatMap(PiSessions, (sessions) => sessions.probe(root)).pipe(
      Effect.map((probe) =>
        probe.commands.filter((c) => c.source === "skill").map((c) => [c.name, c.description]),
      ),
      Effect.provide(PiSessionsLive),
      Effect.provide(NodeServices.layer),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: shim,
        extraArgs: ["--no-extensions"],
        skills: [directory],
      }),
      Effect.timeout("40 seconds"),
    ),
  );
  assert.deepEqual(commands, [["skill:notes", "Writes release notes."]]);
});
