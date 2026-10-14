import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, Queue, type Scope, Stream } from "effect";
import { DirectoryFacts } from "../server/DirectoryFacts.ts";
import { PianoCoreLive } from "../server/PianoServices.ts";
import { PiCli } from "../server/PiCli.ts";
import { Registry, RegistryDatabasePath, RegistryError } from "../server/Registry.ts";
import type { SessionHosts } from "../server/SessionHosts.ts";
import { SidebarView } from "../server/SidebarView.ts";
import { WorkspaceCommands, WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";
import { listWorktrees, WorktrunkCommand } from "../server/Worktrees.ts";

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
/** Offered once per Git discovery the sidebar starts, while a test listens. */
let discovered: Queue.Queue<string> | undefined;
let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    WorkspaceCommands | SidebarView | SessionHosts | Registry | DirectoryFacts | Scope.Scope
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
/** Listens for the sidebar's next discovery, once the ones already started have finished. */
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
      // Some folder is registered, so the sidebar has something to rediscover.
      yield* registry.ensureFolder(cwd);
      for (const attempt of [
        commands.addWorktree(repo, linked),
        commands.createWorktree(repo, "other", {}),
      ]) {
        const discoveries = yield* listen;
        // Nothing ran, so the browser need not ask for rediscovery.
        assert.deepEqual(yield* attempt, {
          status: "error",
          detail: "Select a registered folder first.",
          unconfirmed: false,
        });
        // Without a rediscovery this waits until the test times out.
        yield* Queue.take(discoveries);
      }
      assert.deepEqual((yield* registry.get).worktrees, []);
      yield* registry.ensureFolder(repo);
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
    linked = join(root, "unconfirmed-linked"),
    wt = join(root, "wt"),
    reply = join(root, "wt-reply");
  mkdirSync(repo);
  git(repo, "init", "--quiet");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "init");
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  // A Worktrunk that creates nothing: it fails, or reports a creation, as `wt-reply` says.
  writeFileSync(
    wt,
    `#!${process.execPath}\nimport {readFileSync} from 'node:fs';
if(process.argv.includes('--version')) console.log('wt v0.80.0');
else{const r=readFileSync(${JSON.stringify(reply)},'utf8');if(r==='fail'){console.error('hook failed');process.exit(1);}console.log(r);}\n`,
    { mode: 0o755 },
  );
  const created = JSON.stringify({
    action: "created",
    branch: "next",
    path: join(root, "next"),
    created_branch: true,
    base_branch: "main",
  });
  // Worktrunk failing, then the registry or a defect failing after Worktrunk or Git answered.
  const failures = {
    worktrunk: { reply: "fail", record: Effect.void, detail: /hook failed/ },
    registry: {
      reply: created,
      record: Effect.fail(new RegistryError({ detail: "Registry write failed." })),
      detail: /^Registry write failed\.$/,
    },
    defect: {
      reply: created,
      record: Effect.die(new Error("Unexpected failure.")),
      detail: /^Unexpected failure\.$/,
    },
  };
  for (const [kind, { reply: answer, record, detail }] of Object.entries(failures)) {
    writeFileSync(reply, answer);
    await run(
      Effect.gen(function* () {
        const registry = yield* Registry;
        yield* registry.ensureFolder(repo);
        const commands = yield* Effect.gen(function* () {
          return yield* WorkspaceCommands;
        }).pipe(
          Effect.provide(Layer.fresh(WorkspaceCommandsLive)),
          Effect.provideService(Registry, { ...registry, addWorktree: () => record }),
        );
        const attempts = {
          create: commands.createWorktree(repo, "next", { hooks: false }),
          add: commands.addWorktree(repo, linked),
        };
        for (const [request, attempt] of Object.entries(attempts)) {
          // Adding an existing checkout runs no Worktrunk, so only a later failure applies.
          if (kind === "worktrunk" && request === "add") continue;
          const discoveries = yield* listen;
          const result = yield* attempt;
          assert.ok(result.status === "error", `${kind} ${request} failed`);
          assert.match(result.detail, detail);
          assert.equal(result.unconfirmed, true, `${kind} ${request} asks for rediscovery`);
          assert.equal(yield* Queue.take(discoveries), repo);
        }
      }).pipe(Effect.provideService(WorktrunkCommand, wt)),
    );
  }
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
