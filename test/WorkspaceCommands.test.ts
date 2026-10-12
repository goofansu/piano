import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { type SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { WorkspaceCommands, WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-commands-")));
const cwd = join(root, "checkout");
mkdirSync(cwd);
mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    stdio: "pipe",
  });
let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    WorkspaceCommands | SessionHosts | Registry | DirectoryFacts | Scope.Scope
  >,
  path = join(root, `registry-${++databases}.db`),
) => {
  const layer = WorkspaceCommandsLive.pipe(
    Layer.provideMerge(DirectoryFactsLive),
    Layer.provideMerge(SessionHostsLive({ idleMs: 0 })),
    Layer.provide(PiSessionsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide(NodeServices.layer),
  );
  return Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
      Effect.provideService(RegistryDatabasePath, path),
      Effect.timeout("10 seconds"),
    ),
  );
};
test("worktree commands require a registered folder and record a discovered checkout", async () => {
  const repo = join(root, "repo"),
    linked = join(root, "linked");
  mkdirSync(repo);
  git(repo, "init", "--quiet");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "init");
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  await run(
    Effect.gen(function* () {
      const commands = yield* WorkspaceCommands,
        registry = yield* Registry;
      for (const attempt of [
        commands.addWorktree(repo, linked),
        commands.createWorktree(repo, "other", {}),
      ]) {
        const error = yield* Effect.flip(attempt);
        assert.equal(error._tag, "WorktreeError");
        assert.equal(error.detail, "Select a registered folder first.");
      }
      assert.deepEqual((yield* registry.get).worktrees, []);
      yield* registry.addFolder(repo);
      assert.deepEqual(yield* commands.addWorktree(repo, linked), {
        status: "ready",
        folder: repo,
        path: linked,
        branch: "feature",
      });
      assert.deepEqual((yield* registry.get).worktrees, [
        { folder: repo, path: linked, branch: "feature" },
      ]);
    }),
  );
});

test("INV-01: a trust decision is saved in Pi's store and every client's model catalog is invalidated", async () => {
  // A project skill makes the directory's trust matter to Pi.
  mkdirSync(join(cwd, ".agents/skills/hello"), { recursive: true });
  writeFileSync(
    join(cwd, ".agents/skills/hello/SKILL.md"),
    "---\nname: hello\ndescription: say hello\n---\nSay hello.\n",
  );
  try {
    await run(
      Effect.gen(function* () {
        const commands = yield* WorkspaceCommands,
          facts = yield* DirectoryFacts;
        // Each socket forwards this stream as `catalogs_invalidated`.
        const invalidated = yield* facts.changes.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        const trusted = yield* commands.setTrust(cwd, true);
        assert.deepEqual([trusted.cwd, trusted.trust], [cwd, { required: true, trusted: true }]);
        assert.match(trusted.notice, /^Trusted\./);
        const untrusted = yield* commands.setTrust(cwd, false);
        assert.deepEqual(
          [untrusted.cwd, untrusted.trust],
          [cwd, { required: true, trusted: false }],
        );
        assert.match(untrusted.notice, /^Untrusted\./);
        assert.equal(
          [...(yield* Fiber.join(invalidated))].length,
          2,
          "one invalidation per decision",
        );
      }),
    );
  } finally {
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
  }
});
