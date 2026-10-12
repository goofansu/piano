import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { Effect } from "effect";
import { WorkspaceChanges, WorkspaceChangesLive } from "../server/WorkspaceChanges.ts";
import type { WorkspaceChanges as Observation } from "../shared/wire.ts";
import { parseUnifiedDiff } from "../web/src/lib/diff.ts";

function fixture(t: TestContext) {
  const repo = mkdtempSync(join(tmpdir(), "piano-live-changes-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const gitInput = (input: string | undefined, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      {
        input,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
  const git = (...args: string[]) => gitInput(undefined, ...args);
  git("init", "-q");
  const workspace = { id: "scratch", folder: repo, path: repo };
  const preview = (path?: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* WorkspaceChanges).preview(workspace, path);
      }).pipe(Effect.provide(WorkspaceChangesLive)),
    );
  return { repo, git, gitInput, preview };
}
function ready(value: Observation) {
  assert.equal(value.result.status, "ready", JSON.stringify(value.result));
  if (value.result.status !== "ready") throw new Error("Preview failed");
  return value.result;
}

test("live changes: >10k tracked paths do not gate a tiny edit; index remains untouched", async (t) => {
  const { repo, git, preview } = fixture(t);
  mkdirSync(join(repo, "files"));
  for (let i = 0; i < 10_010; i++) writeFileSync(join(repo, "files", `${i}.txt`), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const index = readFileSync(join(repo, ".git/index"));
  writeFileSync(join(repo, "files/7.txt"), "tiny edit\n");
  const result = ready(await preview());
  assert.deepEqual(result.files, [
    { path: "files/7.txt", additions: 1, deletions: 1, binary: false },
  ]);
  assert.match(result.diff, /\+tiny edit/);
  assert.equal(result.truncated, false);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});

test("live changes: unborn HEAD, literal unusual untracked paths, binary and ignored files", async (t) => {
  const { repo, git, preview } = fixture(t);
  const name = 'odd\n\t"雪[*].txt\\';
  writeFileSync(join(repo, name), "new source\n");
  writeFileSync(join(repo, "binary"), Buffer.from([0, 1, 2]));
  writeFileSync(join(repo, ".gitignore"), "ignored\n");
  writeFileSync(join(repo, "ignored"), "secret\n");
  const result = ready(await preview());
  assert.equal(result.head, null);
  assert.deepEqual(result.files.map((f) => f.path).sort(), [".gitignore", "binary", name].sort());
  assert.equal(result.files.find((f) => f.path === "binary")!.binary, true);
  const single = ready(await preview(name));
  assert.deepEqual(
    single.files.map((f) => f.path),
    [name],
  );
  assert.match(single.diff, /\+new source/);
  assert.equal(
    parseUnifiedDiff(single.diff)[0].path,
    name,
    "Git quoting must match the lazy file identity",
  );
  assert.equal(existsSync(join(repo, ".git/index")), false);
  git("add", ".");
  git("commit", "-qm", "base");
  assert.equal((await preview("../outside")).result.status, "error");
});

test("live changes: complete metadata survives bounded initial and per-file patches; lazy reads are fresh", async (t) => {
  const { repo, git, preview } = fixture(t);
  writeFileSync(join(repo, "base"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(join(repo, "a-large"), "line of source\n".repeat(100_000));
  writeFileSync(join(repo, "z-small"), "small\n");
  const initial = ready(await preview());
  assert.deepEqual(
    initial.files.map((f) => f.path),
    ["a-large", "z-small"],
  );
  assert.equal(initial.truncated, true);
  assert.ok(Buffer.byteLength(initial.diff) <= 120_000);
  const big = ready(await preview("a-large"));
  assert.equal(big.truncated, true);
  assert.ok(Buffer.byteLength(big.diff) <= 1_048_576);
  assert.ok(big.diff.length > 120_000);
  writeFileSync(join(repo, "z-small"), "fresh lazy read\n");
  const small = ready(await preview("z-small"));
  assert.equal(small.truncated, false);
  assert.match(small.diff, /\+fresh lazy read/);
});

test("live changes: metadata overflow is an error, never a partial or empty file list", async (t) => {
  const untracked = fixture(t);
  for (let i = 0; i < 5001; i++) writeFileSync(join(untracked.repo, `${i}.txt`), "");
  assert.equal(
    ready(await untracked.preview()).files.length,
    5001,
    "No silent untracked-count fallback",
  );
  assert.equal(existsSync(join(untracked.repo, ".git/index")), false);

  const { repo, git, gitInput, preview } = fixture(t);
  // Deleted index-only paths overflow numstat without creating/removing 28k files.
  // Avoid needless filesystem event pressure on unrelated strict capture tests.
  const directory = join("d".repeat(200), "e".repeat(200), "f".repeat(200));
  const blob = gitInput("base\n", "hash-object", "-w", "--stdin").trim();
  const entries = Array.from(
    { length: 28_000 },
    (_, i) => `100644 ${blob}\t${directory}/${i}.txt\0`,
  ).join("");
  gitInput(entries, "update-index", "--add", "-z", "--index-info");
  git("commit", "-qm", "index-only base");
  const index = readFileSync(join(repo, ".git/index"));
  const observation = await preview();
  assert.equal(observation.result.status, "error");
  if (observation.result.status === "error")
    assert.match(observation.result.detail, /metadata exceeds 16 MiB; no partial file list/);
  assert.equal("files" in observation.result, false);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});

test("live changes: local filters and diff programs never run and intent-to-add never modifies user index", async (t) => {
  const { repo, git, preview } = fixture(t);
  writeFileSync(join(repo, "tracked"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const index = readFileSync(join(repo, ".git/index"));
  writeFileSync(join(repo, ".gitattributes"), "* filter=trap diff=trap\n");
  git("config", "filter.trap.clean", "touch FILTER_RAN; cat");
  git("config", "filter.trap.process", "touch PROCESS_RAN; false");
  git("config", "filter.trap.required", "true");
  git("config", "diff.trap.command", "touch DIFF_RAN");
  git("config", "diff.trap.textconv", "touch TEXTCONV_RAN");
  writeFileSync(join(repo, "tracked"), "changed\n");
  writeFileSync(join(repo, "new"), "untracked\n");
  assert.match(ready(await preview()).diff, /\+changed/);
  for (const marker of ["FILTER_RAN", "PROCESS_RAN", "DIFF_RAN", "TEXTCONV_RAN"])
    assert.equal(existsSync(join(repo, marker)), false);
  assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
});
