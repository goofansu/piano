import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { Effect } from "effect";
import {
  checkoutHint,
  createWorktree,
  listWorktrees,
  WorktrunkCommand,
} from "../server/Worktrees.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
function fixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-worktrees-")),
    repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "baseline",
  );
  t.after(() => {
    for (const line of git(repo, "worktree", "list", "--porcelain").split("\n")) {
      if (line.startsWith("worktree ") && line.slice(9) !== repo)
        git(repo, "worktree", "remove", "--force", line.slice(9));
    }
    for (const branch of git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads").split(
      "\n",
    )) {
      if (branch && branch !== "main") git(repo, "branch", "-D", branch);
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, repo };
}
test("INV-06: discovery reads Git worktrees without Worktrunk and reports failures without healthy fallbacks", async (t) => {
  const { root, repo } = fixture(t);
  git(repo, "worktree", "add", "--quiet", "-b", "feature", join(root, "feature"));
  git(repo, "worktree", "add", "--quiet", "--detach", join(root, "detached"));
  git(repo, "worktree", "add", "--quiet", "-b", "gone", join(root, "gone"));
  rmSync(join(root, "gone"), { recursive: true, force: true });
  // Discovery must not need Worktrunk at all.
  const observe = (path: string) =>
    Effect.runPromise(
      listWorktrees(path).pipe(Effect.provideService(WorktrunkCommand, join(root, "unavailable"))),
    );
  const result = await observe(repo);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.currentPath, repo);
  assert.deepEqual(
    result.worktrees,
    [
      { path: repo, branch: "main", detached: false, prunable: false },
      { path: join(root, "detached"), branch: null, detached: true, prunable: false },
      { path: join(root, "feature"), branch: "feature", detached: false, prunable: false },
      { path: join(root, "gone"), branch: "gone", detached: false, prunable: true },
    ].sort((x, y) => (x.path === repo ? -1 : y.path === repo ? 1 : x.path.localeCompare(y.path))),
  );
  mkdirSync(join(repo, "subdirectory"));
  const subdir = await observe(join(repo, "subdirectory"));
  assert.ok(subdir.status === "ready" && subdir.currentPath === repo);
  const linked = await observe(join(root, "feature"));
  assert.ok(linked.status === "ready" && linked.currentPath === join(root, "feature"));
  const nonGit = join(root, "notes");
  mkdirSync(nonGit);
  assert.equal((await observe(nonGit)).status, "non-git");
  writeFileSync(join(nonGit, ".git"), "gitdir: /not/a/repository\n");
  const broken = await observe(nonGit);
  assert.equal(broken.status, "error");
  assert.equal("worktrees" in broken, false);
});

test("INV-06: inherited GIT_* state cannot redirect discovery or directory hints", async (t) => {
  const { root, repo } = fixture(t);
  git(repo, "worktree", "add", "--quiet", "-b", "feature", join(root, "feature"));
  const other = join(root, "other");
  mkdirSync(other);
  git(other, "init", "--quiet", "-b", "elsewhere");
  git(
    other,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "redirected",
  );
  const inherited = {
    GIT_DIR: join(other, ".git"),
    GIT_WORK_TREE: other,
    GIT_COMMON_DIR: join(other, ".git"),
  };
  const saved = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  Object.assign(process.env, inherited);
  try {
    const result = await Effect.runPromise(listWorktrees(repo));
    assert.ok(result.status === "ready", JSON.stringify(result));
    assert.equal(result.currentPath, repo);
    assert.deepEqual(result.worktrees.map((w) => w.branch).sort(), ["feature", "main"]);
    assert.deepEqual(await Effect.runPromise(checkoutHint(repo)), {
      root: repo,
      subject: "baseline",
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("INV-06: creation requires a complete structured new-branch result and never retries prose or bypasses approval", async (t) => {
  const { root, repo } = fixture(t),
    cli = join(root, "wt"),
    config = join(root, "result.json"),
    audit = join(root, "calls.jsonl");
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport {readFileSync,appendFileSync} from 'node:fs';
const a=process.argv.slice(2);appendFileSync(${JSON.stringify(audit)},JSON.stringify(a)+'\\n');
if(a.includes('--version')) console.log('wt v0.80.0');else{const f=JSON.parse(readFileSync(${JSON.stringify(config)},'utf8'));if(f.error){console.error(f.error);process.exit(1);}console.log(f.raw??JSON.stringify(f));}\n`,
    { mode: 0o755 },
  );
  const create = (value: object, hooks = true) => {
    writeFileSync(config, JSON.stringify(value));
    return Effect.runPromise(
      createWorktree(repo, "feature", { hooks }).pipe(
        Effect.result,
        Effect.provideService(WorktrunkCommand, cli),
      ),
    );
  };
  const good = {
    action: "created",
    branch: "feature",
    path: join(root, "custom-path"),
    created_branch: true,
    base_branch: "main",
  };
  const ok = await create(good, false);
  assert.equal(ok._tag, "Success");
  if (ok._tag === "Success")
    assert.deepEqual(ok.success, {
      branch: "feature",
      path: good.path,
      baseBranch: "main",
      hooks: "skipped",
    });
  for (const bad of [
    { ...good, action: "switched" },
    { ...good, path: "relative" },
    { ...good, base_branch: null },
    { raw: `noise\n${JSON.stringify(good)}` },
    { error: "Branch feature already exists" },
  ]) {
    const result = await create(bad);
    assert.equal(result._tag, "Failure");
    // Worktrunk ran, so a checkout may exist; the error must say so.
    if (result._tag === "Failure")
      assert.match(result.failure.detail, /Creation was not confirmed/);
  }
  const calls = readFileSync(audit, "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
    .filter((a) => a.includes("switch"));
  assert.equal(calls.length, 6);
  assert.ok(
    calls.every((a) => !a.includes("-y") && !a.includes("--yes") && a.includes("--create")),
  );
  assert.ok(calls[0].includes("--no-hooks"));
  assert.ok(!calls[1].includes("--no-hooks"));
});

test("INV-06: Worktrunk 0.80.0 and later create worktrees; older or unrecognized versions do not", async (t) => {
  const { root, repo } = fixture(t),
    cli = join(root, "wt"),
    version = join(root, "version");
  const created = JSON.stringify({
    action: "created",
    branch: "feature",
    path: join(root, "feature"),
    created_branch: true,
    base_branch: "main",
  });
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport {readFileSync} from 'node:fs';
console.log(process.argv.includes('--version')?readFileSync(${JSON.stringify(version)},'utf8'):${JSON.stringify(created)});\n`,
    { mode: 0o755 },
  );
  const create = (reported: string) => {
    writeFileSync(version, reported);
    return Effect.runPromise(
      createWorktree(repo, "feature").pipe(
        Effect.result,
        Effect.provideService(WorktrunkCommand, cli),
      ),
    );
  };
  for (const reported of ["wt v0.80.0", "wt v0.81.0", "wt v0.80.1", "wt v1.0.0"])
    assert.equal((await create(reported))._tag, "Success", reported);
  for (const reported of ["wt v0.79.9", "wt v0.9.0", "worktrunk 0.81.0", ""]) {
    const result = await create(reported);
    assert.equal(result._tag, "Failure", reported);
    if (result._tag === "Failure") {
      assert.match(result.failure.detail, /0\.80\.0 or later/);
      // The version check runs before Worktrunk creates anything.
      assert.doesNotMatch(result.failure.detail, /Creation was not confirmed/);
    }
  }
});

test("a Piano started inside a project member's session passes no launch variable to Worktrunk", async (t) => {
  const { root, repo } = fixture(t),
    cli = join(root, "wt"),
    seen = join(root, "env.json");
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';
if(process.argv.includes('--version')) console.log('wt v0.80.0');
else{writeFileSync(${JSON.stringify(seen)},JSON.stringify(process.env));
console.log(JSON.stringify({action:'created',branch:'feature',path:${JSON.stringify(join(root, "feature"))},created_branch:true,base_branch:'main'}));}\n`,
    { mode: 0o755 },
  );
  const inherited = {
    PIANO_PROJECT_INSTRUCTIONS: "Parent project's instructions",
    PIANO_PREVIEW_OWNER: "http://127.0.0.1:1/parent-preview",
    PIANO_SESSION_WS_URL: "ws://127.0.0.1:1/ws",
    PIANO_SESSION_ORIGIN: "http://127.0.0.1:1",
    PIANO_INHERITED_MARKER: "kept",
  };
  const saved = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
  Object.assign(process.env, inherited);
  try {
    await Effect.runPromise(
      createWorktree(repo, "feature").pipe(Effect.provideService(WorktrunkCommand, cli)),
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const env = JSON.parse(readFileSync(seen, "utf8"));
  // The rest of Piano's environment still reaches Worktrunk.
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(inherited).flatMap((key) => (key in env ? [[key, env[key]]] : [])),
    ),
    { PIANO_INHERITED_MARKER: "kept" },
  );
});
