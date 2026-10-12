import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { setProjectTrust } from "../server/ProjectTrust.ts";
import { RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHostsLive } from "../server/SessionHosts.ts";
import { SidebarView, SidebarViewLive } from "../server/SidebarView.ts";
import { WorktrunkCommand } from "../server/Worktrees.ts";
import { seedRegistry } from "./fixtures/registry.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();

/** Two registered projects: one with `.agents/skills`, one plain. Pi's agent dir is isolated so the real trust file is untouched. */
function fixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-trust-")),
    skilled = join(root, "skilled"),
    plain = join(root, "plain"),
    agent = join(root, "agent");
  for (const repo of [skilled, plain]) {
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
  }
  mkdirSync(join(skilled, ".agents/skills/hello"), { recursive: true });
  writeFileSync(
    join(skilled, ".agents/skills/hello/SKILL.md"),
    "---\nname: hello\ndescription: say hello\n---\nSay hello.\n",
  );
  mkdirSync(agent);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  seedRegistry(join(root, "registry.db"), { folders: [skilled, plain] });
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  return { root, skilled, plain, agent };
}

test("INV-01: project trust is read from and written to Pi's trust file, per directory", async (t) => {
  const { root, skilled, plain, agent } = fixture(t);
  const layer = SidebarViewLive().pipe(
    Layer.provide(DirectoryFactsLive),
    Layer.provideMerge(SessionHostsLive({ idleMs: 0 })),
    Layer.provide(PiSessionsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide(NodeServices.layer),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const buildFolders = Effect.map((yield* SidebarView).fresh, (view) => view.folders);
      const trustOf = (path: string) =>
        Effect.map(
          buildFolders,
          (projects) => projects.flatMap((p) => p.worktrees).find((w) => w.path === path)!.trust,
        );

      // Headless Pi skips protected resources until a decision is saved; a plain checkout needs no decision.
      assert.deepEqual(yield* trustOf(skilled), { required: true, trusted: false });
      assert.deepEqual(yield* trustOf(plain), { required: false, trusted: true });

      yield* setProjectTrust(skilled, true);
      assert.deepEqual(yield* trustOf(skilled), { required: true, trusted: true });
      // The file is Pi's: canonical path keys with boolean decisions, as `/trust` writes them.
      assert.deepEqual(JSON.parse(readFileSync(join(agent, "trust.json"), "utf8")), {
        [skilled]: true,
      });

      // Untrust is an explicit "do not trust", so it also overrides a trusted ancestor.
      yield* setProjectTrust(root, true);
      yield* setProjectTrust(skilled, false);
      assert.deepEqual(yield* trustOf(skilled), { required: true, trusted: false });
      assert.deepEqual(JSON.parse(readFileSync(join(agent, "trust.json"), "utf8")), {
        [root]: true,
        [skilled]: false,
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(RegistryDatabasePath, join(root, "registry.db")),
      Effect.provideService(WorktrunkCommand, join(root, "unavailable")),
    ),
  );
});
