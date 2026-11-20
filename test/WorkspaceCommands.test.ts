import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Fiber, Layer, Queue, type Scope, Stream } from "effect";
import { DirectoryFacts } from "../server/DirectoryFacts.ts";
import { FolderWorktrees, FolderWorktreesLive } from "../server/FolderWorktrees.ts";
import { worktreeInstance } from "../server/GitCheckout.ts";
import { PianoCoreLive } from "../server/PianoServices.ts";
import { PiCli } from "../server/PiCli.ts";
import { Registry, RegistryDatabasePath, RegistryError } from "../server/Registry.ts";
import type { SessionHosts } from "../server/SessionHosts.ts";
import { SidebarView } from "../server/SidebarView.ts";
import { GitCommand } from "../server/Subprocess.ts";
import { WorkspaceCommands, WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";
import { listWorktrees } from "../server/Worktrees.ts";

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
let discovered: Queue.Queue<string> | undefined;
let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | WorkspaceCommands
    | FolderWorktrees
    | SidebarView
    | SessionHosts
    | Registry
    | DirectoryFacts
    | Scope.Scope
  >,
  path = join(root, `registry-${++databases}.db`),
) => {
  discovered = undefined;
  const discover = (folder: string) =>
    Effect.suspend(() => {
      if (discovered) Queue.offerUnsafe(discovered, folder);
      return listWorktrees(folder);
    });
  const layer = PianoCoreLive({ idleMs: 0, discover }).pipe(Layer.provide(NodeServices.layer));
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
const listen = Effect.gen(function* () {
  yield* (yield* SidebarView).fresh;
  const queue = yield* Queue.unbounded<string>();
  discovered = queue;
  return queue;
});

test("INV-06: worktree commands require a registered folder, answer the refusal as confirmed, and record a discovered checkout", async () => {
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
      yield* registry.addFolder(cwd);
      const discoveries = yield* listen;
      assert.deepEqual(yield* commands.addWorktree(repo, linked), {
        status: "error",
        detail: "Select a registered folder first.",
        unconfirmed: false,
      });
      yield* Queue.take(discoveries);
      const refused = yield* (yield* FolderWorktrees).create(repo, "other").pipe(Effect.flip);
      assert.equal(refused.detail, "Select a registered folder first.");
      assert.notEqual(refused.unconfirmed, true);
      assert.equal(git(repo, "branch", "--list", "other").toString(), "");
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

test("INV-06: a worktree request that may have left a checkout is answered unconfirmed, then rediscovered", async () => {
  const repo = join(root, "unconfirmed"),
    linked = join(root, "unconfirmed-linked");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "init");
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  const failures = {
    registry: {
      record: Effect.fail(new RegistryError({ detail: "Registry write failed." })),
      detail: /^Registry write failed\./,
    },
    defect: {
      record: Effect.die(new Error("Unexpected failure.")),
      detail: /^Unexpected failure\.$/,
    },
  };
  for (const [kind, { record, detail }] of Object.entries(failures)) {
    await run(
      Effect.gen(function* () {
        const registry = yield* Registry;
        yield* registry.addFolder(repo);
        const failing = {
          ...registry,
          addWorktree: () => record,
          recordCreatedWorktree: () => record,
        };
        const built = yield* Layer.build(
          Layer.fresh(WorkspaceCommandsLive.pipe(Layer.provideMerge(FolderWorktreesLive))),
        ).pipe(Effect.provideService(Registry, failing));
        const discoveries = yield* listen;
        const result = yield* Context.get(built, WorkspaceCommands).addWorktree(repo, linked);
        assert.ok(result.status === "error", `${kind} add failed`);
        assert.match(result.detail, detail);
        assert.equal(result.unconfirmed, true, `${kind} add asks for rediscovery`);
        assert.equal(yield* Queue.take(discoveries), repo);
        if (kind !== "registry") return;
        const branch = "kept";
        const created = yield* Context.get(built, FolderWorktrees)
          .create(repo, branch)
          .pipe(Effect.flip);
        assert.equal(created.unconfirmed, true, "a checkout left unrecorded is unconfirmed");
        assert.equal(created.detail, `Registry write failed. ${repo}.${branch}`);
        assert.ok(existsSync(`${repo}.${branch}`));
      }),
    );
  }
});

test("INV-02/06: a requester that leaves while Git creates the worktree still gets it registered", async () => {
  const repo = join(root, "held"),
    heldGit = join(root, "held-git"),
    started = join(root, "held-started"),
    release = join(root, "held-release"),
    path = `${repo}.next`;
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "init");
  writeFileSync(
    heldGit,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';
const a=process.argv.slice(2);
if(a.includes('worktree')&&a.includes('add')){writeFileSync(${JSON.stringify(started)},'');
while(!existsSync(${JSON.stringify(release)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
const r=spawnSync('git',a,{stdio:'inherit'});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  const until = <A>(read: Effect.Effect<A | undefined>, what: string) =>
    Effect.gen(function* () {
      for (let n = 0; n < 250; n++) {
        const value = yield* read;
        if (value !== undefined) return value;
        yield* Effect.sleep("20 millis");
      }
      return yield* Effect.die(new Error(`never observed: ${what}`));
    });
  await run(
    Effect.gen(function* () {
      const worktrees = yield* FolderWorktrees,
        registry = yield* Registry;
      yield* registry.addFolder(repo);
      const requester = yield* worktrees.create(repo, "next").pipe(Effect.forkChild);
      yield* until(
        Effect.sync(() => (existsSync(started) ? true : undefined)),
        "git worktree add running",
      );
      yield* Fiber.interrupt(requester);
      writeFileSync(release, "");
      const registered = yield* until(
        registry.get.pipe(Effect.map((d) => d.worktrees.find((w) => w.path === path))),
        "the worktree registered",
      );
      assert.deepEqual(registered, {
        folder: repo,
        path,
        branch: "next",
        created: {
          branch: "next",
          baseBranch: "main",
          commit: git(repo, "rev-parse", "HEAD").toString().trim(),
          instance: yield* Effect.promise(() =>
            worktreeInstance(git(path, "rev-parse", "--absolute-git-dir").toString().trim()),
          ),
        },
      });
    }).pipe(Effect.provideService(GitCommand, heldGit)),
  );
});

test("INV-01: a trust decision is saved in Pi's store and every client's model catalog is invalidated", async () => {
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
        const invalidated = yield* (yield* facts.changes).pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
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
