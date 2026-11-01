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
import { TEXT_MAX } from "../shared/drafts.ts";
import { checkPromptDraft } from "../shared/prompts.ts";
import { checkSkillDraft } from "../shared/skills.ts";

/** A throwaway home: Piano's skills folder, and the folders Pi loads user skills from besides it. */
function home(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "piano-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "piano", "skills");
  const agentsDirectory = join(root, ".agents", "skills");
  const piDirectory = join(root, ".pi", "agent", "skills");
  const run = <A, E>(f: (skills: UserSkills["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.flatMap(UserSkills, f).pipe(
        Effect.provide(UserSkillsLive),
        Effect.provideService(UserSkillsEnvironment, {
          directory: () => directory,
          others: () => [agentsDirectory, piDirectory],
        }),
        Effect.result,
      ),
    );
  return { directory, agentsDirectory, piDirectory, run };
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
  assert.deepEqual(listed._tag === "Success" && listed.success, [
    { name: "deploy", description, instructions, disableModelInvocation: true },
    { name: "release-notes", description, instructions, disableModelInvocation: false },
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
  const draft = (name: string) => checkSkillDraft({ name, description: "D.", instructions: "I." });
  for (const name of ["a", "release-notes", "v2-api", "x".repeat(64)])
    assert.ok(draft(name).saved, name);
  for (const name of ["-a", "a-", "a--b", "A", "a b", "a_b", "x".repeat(65)])
    assert.equal(draft(name).saved, undefined, name);
  assert.equal(draft("Release").malformedName, true);
  assert.equal(draft("").malformedName, false, "a blank name is missing, not malformed");
  assert.equal(draft("  ok  ").saved?.name, "ok", "the saved draft is trimmed");
  assert.equal(
    checkSkillDraft({ name: "ok", description: "D.", instructions: " " }).saved,
    undefined,
    "every field is required",
  );
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
    skills.create({ name: "release-notes", description: "Writes notes.", instructions: "Go." }),
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

test("skills and prompts share one draft rule, except that a prompt's description is optional", () => {
  const skill = (description: string) =>
    checkSkillDraft({ name: "same", description, instructions: "Text." });
  const prompt = (description: string) =>
    checkPromptDraft({ name: "same", description, body: "Text." });
  assert.deepEqual(skill("").problem, { field: "description", detail: "Enter a description." });
  assert.ok(prompt("").saved, "a prompt needs no description");
  for (const [name, description, text] of [
    ["Bad", "D.", "T."],
    ["a--b", "D.", "T."],
    ["x".repeat(65), "D.", "T."],
    ["ok", "d".repeat(1025), "T."],
    ["ok", "D.", "t".repeat(TEXT_MAX + 1)],
    ["ok", "D.", "  "],
  ] as const) {
    const s = checkSkillDraft({ name, description, instructions: text }).problem;
    const p = checkPromptDraft({ name, description, body: text }).problem;
    assert.ok(s && p, name);
    assert.deepEqual(
      [s.field === "instructions" ? "text" : s.field, s.detail.replace("instructions", "_")],
      [p.field === "body" ? "text" : p.field, p.detail.replace("the prompt", "_")],
      `${name}: one rule, one answer`,
    );
  }
});
