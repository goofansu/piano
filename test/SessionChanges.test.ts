import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionChanges, SessionChangesLive } from "../server/SessionChanges.ts";
import { WorkspaceChangesLive } from "../server/WorkspaceChanges.ts";
import type { WorkspaceChanges as Observation } from "../shared/wire.ts";

/** A folder on `main` with a worktree on `feature` Piano registered with its base, and a session there. */
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-session-changes-")),
    repo = join(root, "repo"),
    worktree = join(root, "repo.feature");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      },
    ).trim();
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "a"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "branch", "-q", "release");
  git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
  writeFileSync(join(worktree, "a"), "edited\n");
  git(worktree, "commit", "-qam", "work");
  const layer = SessionChangesLive.pipe(
    Layer.provideMerge(WorkspaceChangesLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide(Layer.succeed(RegistryDatabasePath, join(root, "registry.db"))),
  );
  const runtime = ManagedRuntime.make(layer);
  const registry = await runtime.runPromise(Registry);
  await runtime.runPromise(registry.addFolder(repo));
  await runtime.runPromise(
    registry.addWorktree({ folder: repo, path: worktree, branch: "feature", baseBranch: "main" }),
  );
  await runtime.runPromise(registry.addSession(worktree, "one"));
  await runtime.runPromise(registry.addSession(repo, "root"));
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  // Stand in for the router: the workspace and session entry resolved by ID.
  const resolve = (cwd: string, sessionId: string) =>
    Effect.gen(function* () {
      const data = yield* registry.get;
      return {
        workspace: data.workspaces.find((w) => w.path === cwd)!,
        session: data.sessions.find((s) => s.cwd === cwd && s.sessionId === sessionId)!,
      };
    });
  const read = (cwd: string, sessionId: string, options?: { scope?: "branch" | "uncommitted" }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { workspace, session } = yield* resolve(cwd, sessionId);
        return yield* (yield* SessionChanges).read(workspace, session, options);
      }),
    );
  const setScope = (cwd: string, sessionId: string, scope: "branch" | "uncommitted" | null) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { workspace, session } = yield* resolve(cwd, sessionId);
        return yield* (yield* SessionChanges).setScope(workspace, session, scope);
      }),
    );
  return { repo, worktree, git, runtime, registry, read, setScope, resolve };
}

function ready(value: Observation) {
  assert.equal(value.result.status, "ready", JSON.stringify(value.result));
  if (value.result.status !== "ready") throw new Error("Read failed");
  return value.result;
}

test("a session's Changes compare its worktree with the base Piano recorded, keep committed work, and follow a linked pull request's base", async (t) => {
  const f = await fixture(t);
  const auto = ready(await f.read(f.worktree, "one"));
  assert.equal(auto.comparison.scope, "branch");
  assert.deepEqual(
    [auto.comparison.target?.name, auto.comparison.target?.from],
    ["main", "worktree"],
  );
  assert.deepEqual(
    auto.files.map((file) => file.path),
    ["a"],
  );
  assert.deepEqual(ready(await f.read(f.worktree, "one", { scope: "uncommitted" })).files, []);
  // The session's pull request names its base: used only once GitHub has reported the branches.
  await f.runtime.runPromise(
    Effect.gen(function* () {
      const { session } = yield* f.resolve(f.worktree, "one");
      yield* f.registry.setSessionLink(session, "pullRequest", {
        url: "https://github.com/example/repo/pull/1",
        source: "branch",
        head: "feature",
        base: "release",
      });
    }),
  );
  const fromPr = ready(await f.read(f.worktree, "one"));
  assert.deepEqual(
    [fromPr.comparison.target?.name, fromPr.comparison.target?.from],
    ["release", "pull-request"],
  );
  // On the folder's root, main is the target itself: automatic is Uncommitted; Branch says why.
  assert.equal(ready(await f.read(f.repo, "root")).comparison.scope, "uncommitted");
  const refused = await f.read(f.repo, "root", { scope: "branch" });
  assert.equal(refused.result.status, "unavailable");
});

test("the chosen scope is saved for the session and read with until returned to automatic", async (t) => {
  const f = await fixture(t);
  assert.equal(
    ready(await f.setScope(f.worktree, "one", "uncommitted")).comparison.scope,
    "uncommitted",
  );
  assert.equal(ready(await f.read(f.worktree, "one")).comparison.scope, "uncommitted");
  const saved = (await f.runtime.runPromise(f.registry.get)).sessions.find(
    (s) => s.sessionId === "one",
  );
  assert.equal(saved?.changesScope, "uncommitted");
  // A read may still ask for another scope without changing the saved one.
  assert.equal(
    ready(await f.read(f.worktree, "one", { scope: "branch" })).comparison.scope,
    "branch",
  );
  assert.equal(ready(await f.setScope(f.worktree, "one", null)).comparison.scope, "branch");
  const cleared = (await f.runtime.runPromise(f.registry.get)).sessions.find(
    (s) => s.sessionId === "one",
  );
  assert.equal(cleared?.changesScope, undefined);
  // A saved scope the checkout cannot read is refused, never swapped for another.
  await f
    .setScope(f.repo, "root", "branch")
    .then((value) => assert.equal(value.result.status, "unavailable"));
  assert.equal((await f.read(f.repo, "root")).result.status, "unavailable");
});
