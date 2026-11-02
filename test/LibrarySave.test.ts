import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Layer } from "effect";
import { type LibraryDeps, saveToLibrary } from "../extensions/piano-library/LibrarySave.ts";
import { PromptsDir } from "../server/Prompts.ts";
import { UserSkillsEnvironment } from "../server/UserSkills.ts";
import { type LibraryProposal, readProposal } from "../shared/library.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

// The production router and services in a scratch directory; Piano's folders are this test's own.
const scratch = mkdtempSync(join(tmpdir(), "piano-library-folders-"));
const skills = join(scratch, "piano", "skills");
const prompts = join(scratch, "piano", "prompts");
const elsewhere = join(scratch, ".agents", "skills");
let server: RouterFixture;
before(async () => {
  server = await startRouter(
    "piano-library-",
    Layer.mergeAll(
      Layer.succeed(UserSkillsEnvironment, { directory: () => skills, others: () => [elsewhere] }),
      Layer.succeed(PromptsDir, prompts),
    ),
  );
});
after(async () => {
  await server.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

/** The Piano a session's extension reaches, and a user who answers the proposal with `decide`. */
function user(decide: (proposal: LibraryProposal) => boolean | Promise<boolean>) {
  const asked: LibraryProposal[] = [];
  const deps: LibraryDeps = {
    request: (path, init) => server.handle(path, init),
    confirm: async (title, message) => {
      const proposal = readProposal({ method: "confirm", title, message });
      assert.ok(proposal, "the browser reads the dialog as a proposal");
      asked.push(proposal);
      return decide(proposal);
    },
  };
  return { asked, deps };
}

const listed = async (path: string) =>
  ((await (await server.handle(path)).json()) as Array<{ name: string; file: string }>).map(
    (item) => item.name,
  );

test("a prompt is saved only after the user's Save, and an update shows what it replaces", async () => {
  const draft = { name: "triage", description: "Triage an issue", instructions: "Triage #$1." };
  const cancelled = user(() => false);
  assert.deepEqual(await saveToLibrary("prompt", draft, cancelled.deps, undefined), {
    status: "cancelled",
    kind: "prompt",
    name: "triage",
  });
  assert.equal(cancelled.asked.length, 1);
  assert.equal(existsSync(join(prompts, "triage.md")), false, "a cancel writes nothing");

  const approved = user(() => true);
  const saved = await saveToLibrary("prompt", draft, approved.deps, undefined);
  assert.equal(saved.status, "saved");
  const file = readFileSync(join(prompts, "triage.md"), "utf8");
  assert.deepEqual(approved.asked, [{ kind: "prompt", change: "create", name: "triage", file }]);
  assert.equal(saved.status === "saved" && saved.file, file, "the proposal is the file saved");
  assert.deepEqual(
    await listed("/api/settings/prompts"),
    ["triage"],
    "Settings › Prompts lists it",
  );

  const changed = user(() => true);
  const update = await saveToLibrary(
    "prompt",
    { ...draft, instructions: "Triage issue #$1 by risk." },
    changed.deps,
    undefined,
  );
  assert.equal(update.status === "saved" && update.change, "update");
  assert.equal(changed.asked[0]?.change, "update");
  assert.equal(changed.asked[0]?.previous, file, "the proposal carries the file it replaces");
  assert.match(readFileSync(join(prompts, "triage.md"), "utf8"), /by risk\./);
});

test("a stop during the proposal writes nothing", async () => {
  const controller = new AbortController();
  const stopped = user(() => {
    // Stop/Abort cancels the dialog: Pi's confirm answers false once the signal aborts.
    controller.abort();
    return false;
  });
  const result = await saveToLibrary(
    "skill",
    { name: "stopped", description: "D.", instructions: "I." },
    stopped.deps,
    controller.signal,
  );
  assert.equal(result.status, "cancelled");
  assert.equal(existsSync(join(skills, "stopped")), false);

  // A Save racing the stop is not approval either.
  const racing = new AbortController();
  const late = user(() => {
    racing.abort();
    return true;
  });
  const raced = await saveToLibrary(
    "skill",
    { name: "raced", description: "D.", instructions: "I." },
    late.deps,
    racing.signal,
  );
  assert.equal(raced.status, "cancelled");
  assert.equal(existsSync(join(skills, "raced")), false);
});

test("a malformed draft is refused with its field before any dialog", async () => {
  const never = user(() => assert.fail("no dialog for a malformed draft"));
  for (const [draft, field] of [
    [{ name: "Bad Name", description: "D.", instructions: "I." }, "name"],
    [{ name: "ok", description: " ", instructions: "I." }, "description"],
    [{ name: "ok", description: "D.", instructions: "x".repeat(20_001) }, "instructions"],
  ] as const) {
    const result = await saveToLibrary("skill", draft, never.deps, undefined);
    assert.equal(result.status, "refused");
    assert.equal(result.status === "refused" && result.field, field);
  }
  const named = await saveToLibrary(
    "prompt",
    { name: "Bad Name", description: "D.", instructions: "I." },
    never.deps,
    undefined,
  );
  assert.equal(
    named.status === "refused" && named.detail,
    "Use lowercase letters, numbers and single hyphens, not at the start or end.",
  );
});

test("a skill is saved after approval, and a name Pi loads from another folder is refused", async () => {
  const approved = user(() => true);
  const saved = await saveToLibrary(
    "skill",
    { name: "fix-flaky", description: "Fix flaky tests.", instructions: "Rerun, then bisect." },
    approved.deps,
    undefined,
  );
  assert.equal(saved.status === "saved" && saved.change, "create");
  assert.equal(
    approved.asked[0]?.file,
    readFileSync(join(skills, "fix-flaky", "SKILL.md"), "utf8"),
  );
  assert.deepEqual(await listed("/api/settings/skills"), ["fix-flaky"]);

  // An update keeps the saved skill's Disable model invocation unless the draft says otherwise.
  const flagged = user(() => true);
  await saveToLibrary(
    "skill",
    { name: "fix-flaky", description: "D.", instructions: "I.", disableModelInvocation: true },
    flagged.deps,
    undefined,
  );
  const kept = user(() => true);
  await saveToLibrary(
    "skill",
    { name: "fix-flaky", description: "D.", instructions: "II." },
    kept.deps,
    undefined,
  );
  assert.match(kept.asked[0]?.file ?? "", /disable-model-invocation: true/);

  mkdirSync(join(elsewhere, "shared"), { recursive: true });
  writeFileSync(
    join(elsewhere, "shared", "SKILL.md"),
    "---\nname: shared\ndescription: Theirs.\n---\n\nTheirs.\n",
  );
  const refused = await saveToLibrary(
    "skill",
    { name: "shared", description: "Mine.", instructions: "Mine." },
    user(() => true).deps,
    undefined,
  );
  assert.deepEqual(refused, {
    status: "refused",
    kind: "skill",
    name: "shared",
    field: "name",
    detail: "A skill named shared already exists.",
  });
  assert.match(readFileSync(join(elsewhere, "shared", "SKILL.md"), "utf8"), /Theirs\./);
});
