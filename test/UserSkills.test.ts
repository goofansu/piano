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
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { UserSkills, UserSkillsEnvironment, UserSkillsLive } from "../server/UserSkills.ts";
import { checkSkillDraft, SKILL_INSTRUCTIONS_MAX } from "../shared/skills.ts";

/** A throwaway home: the skills directory Piano writes and Pi's own user skills directory. */
function home(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "piano-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, ".agents", "skills");
  const piDirectory = join(root, ".pi", "agent", "skills");
  const run = <A, E>(f: (skills: UserSkills["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.flatMap(UserSkills, f).pipe(
        Effect.provide(UserSkillsLive),
        Effect.provideService(UserSkillsEnvironment, {
          directory: () => directory,
          piDirectory: () => piDirectory,
        }),
        Effect.result,
      ),
    );
  return { directory, piDirectory, run };
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
  for (const [name, onlyWhenNamed] of [
    ["release-notes", false],
    ["deploy", true],
  ] as const)
    assert.equal(
      (
        await run((skills) =>
          skills.create({ name, description, instructions: `${instructions}\n`, onlyWhenNamed }),
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
    "Only when named is Pi's disable-model-invocation",
  );
  assert.match(readFileSync(join(directory, "release-notes", "SKILL.md"), "utf8"), /Read PRs\.\n$/);
  const listed = await run((skills) => skills.list);
  assert.deepEqual(listed._tag === "Success" && listed.success, [
    { name: "deploy", description, instructions, onlyWhenNamed: true },
    { name: "release-notes", description, instructions, onlyWhenNamed: false },
  ]);
});

test("only skills Piano created are listed or deleted", async (t) => {
  const { directory, run } = home(t);
  write(directory, "installed", "name: installed\ndescription: From a repository.");
  // A linked directory is the user's repository, even if it carries the marker.
  const elsewhere = mkdtempSync(join(tmpdir(), "piano-skills-repo-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  write(elsewhere, "linked", "name: linked\ndescription: Linked.\nmetadata:\n  created-by: piano");
  symlinkSync(join(elsewhere, "linked"), join(directory, "linked"));
  await run((skills) => skills.create({ name: "mine", description: "Mine.", instructions: "Go." }));

  const listed = await run((skills) => skills.list);
  assert.deepEqual(listed._tag === "Success" && listed.success.map((s) => s.name), ["mine"]);

  for (const name of ["installed", "linked", "../installed"])
    assert.equal(
      refusal(await run((skills) => skills.remove(name))).detail,
      "Piano did not create this skill.",
    );
  assert.ok(existsSync(join(directory, "installed", "SKILL.md")));
  assert.ok(existsSync(join(elsewhere, "linked", "SKILL.md")));

  assert.equal((await run((skills) => skills.remove("mine")))._tag, "Success");
  assert.equal(existsSync(join(directory, "mine")), false);
});

test("a create names the field it refuses and never overwrites a skill", async (t) => {
  const { directory, piDirectory, run } = home(t);
  write(directory, "taken", "name: taken\ndescription: Already here.", "Original.");
  write(piDirectory, "pi-own", "name: pi-own\ndescription: Pi's own.");
  const create = (name: string, description = "D.", instructions = "I.") =>
    run((skills) => skills.create({ name, description, instructions }));

  for (const name of ["Release", "-x", "a--b", "a_b", "../escape", "a".repeat(65)])
    assert.equal(refusal(await create(name)).field, "name", name);
  const taken = refusal(await create("taken"));
  assert.deepEqual([taken.detail, taken.field], ["A skill named taken already exists.", "name"]);
  assert.equal(refusal(await create("pi-own")).field, "name", "a name Pi already loads");
  assert.equal(refusal(await create("ok", "  ")).field, "description");
  assert.equal(refusal(await create("ok", "D.", "\n")).field, "instructions");
  const max = "x".repeat(SKILL_INSTRUCTIONS_MAX);
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
