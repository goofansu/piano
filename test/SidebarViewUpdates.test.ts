import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { type SidebarMessage, SidebarView, SidebarViewLive } from "../server/SidebarView.ts";
import type { WorktreeDiscovery } from "../shared/wire.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-sidebar-")));
const first = join(root, "first"),
  second = join(root, "second");
mkdirSync(first);
mkdirSync(second);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
mkdirSync(join(root, "sessions"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Git discovery is the slow external boundary: count runs and hold them until the test opens the gate. */
const slowGit = () => {
  let open: () => void = () => {};
  let entered: () => void = () => {};
  let gate: Promise<void> | undefined;
  const git = {
    calls: 0,
    /** Hold the next runs; resolves once one of them is waiting in Git. */
    hold: () => {
      gate = new Promise((resolve) => {
        open = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      return Effect.promise(() => waiting);
    },
    release: () => {
      gate = undefined;
      open();
    },
    discover: (_folder: string) =>
      Effect.promise(async (): Promise<WorktreeDiscovery> => {
        git.calls++;
        if (gate) entered();
        await gate;
        return { status: "non-git", observedAt: new Date().toISOString() };
      }),
  };
  return git;
};

let databases = 0;
const run = <A, E>(
  git: ReturnType<typeof slowGit>,
  effect: Effect.Effect<A, E, SidebarView | DirectoryFacts | Registry | SessionHosts | Scope.Scope>,
) => {
  const layer = SidebarViewLive({ discover: git.discover }).pipe(
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
      Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)),
      Effect.timeout("10 seconds"),
    ),
  );
};
const nextView = (view: SidebarView["Service"], match: (m: SidebarMessage) => boolean) =>
  view.subscribe.pipe(
    Effect.flatMap((s) => s.pipe(Stream.filter(match), Stream.take(1), Stream.runCollect)),
    Effect.map((c) => [...c][0]!),
  );
const titleOf = (m: SidebarMessage) => m.sessionReferences?.[0]?.title;

test("INV-06: changes during discovery coalesce into one more run; a late subscriber gets the latest view", async () => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView;
      yield* registry.addFolder(first);
      yield* view.fresh;
      const before = git.calls;
      // Hold a run in Git; every change below lands while it runs.
      const held = git.hold();
      yield* view.refresh;
      yield* held;
      yield* Effect.forEach(
        Array.from({ length: 20 }, (_, i) => i),
        (i) => registry.addSession(first, `s${i}`),
        { concurrency: "unbounded" },
      );
      // Asked for while the run is still held, so the run after it answers.
      const fresh = yield* Effect.forkChild(view.fresh, { startImmediately: true });
      git.release();
      const built = yield* Fiber.join(fresh);
      assert.equal(
        git.calls - before,
        2,
        "the held run plus one run for everything that changed during it",
      );
      assert.equal(built.sessionReferences?.length, 20);

      const late = yield* nextView(view, () => true);
      assert.deepEqual(
        [late.folders.map((f) => f.path), late.sessionReferences?.length],
        [[first], 20],
        "a late subscriber starts from the latest view",
      );
    }),
  );
});

test("INV-06: a registry-only change publishes before Git answers; a later change starts a fresh run", async () => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView;
      yield* registry.addFolder(first);
      yield* registry.addSession(first, "s1", "Before");
      yield* view.fresh;
      const runs = git.calls;

      // A prompt or rename must not wait on discovery: hold Git and the new title still arrives.
      git.hold();
      yield* registry.mirrorSession(first, "s1", { sessionName: "After" });
      assert.equal(titleOf(yield* nextView(view, () => true)), "After");
      git.release();

      // A new folder needs discovery; the change starts a run and the view follows it.
      yield* registry.addFolder(second);
      const grown = yield* nextView(view, (m) => m.folders.length === 2);
      assert.deepEqual(grown.folders.map((f) => f.path).sort(), [first, second]);
      assert.ok(git.calls > runs, "the change after a finished run rediscovered");
    }),
  );
});

test("INV-01: a registry write made outside any browser request reaches the sidebar; cached statistics do not", async () => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView,
        hosts = yield* SessionHosts;
      yield* registry.addFolder(first);
      yield* view.fresh;
      const session = yield* hosts.open({ cwd: first, sessionId: "pi-named", create: true });
      // Pi renames the session (a /name command or an extension); SessionHosts mirrors the name into the registry.
      yield* session.act({ _tag: "set_name", name: "Named by Pi" });
      assert.equal(
        titleOf(yield* nextView(view, (m) => titleOf(m) === "Named by Pi")),
        "Named by Pi",
      );

      // A statistics cache write publishes nothing, so the next view after it is the next visible change.
      yield* view.fresh; // No discovery run is left to publish in between.
      const views = yield* view.subscribe.pipe(
        Effect.flatMap((s) =>
          s.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true })),
        ),
      );
      yield* registry.mirrorSession(first, "pi-named", {
        stats: { cost: 1, statsUpdatedAt: Date.now() },
      });
      yield* registry.setSessionRadiusShare(
        (yield* registry.get).sessions.find((s) => s.sessionId === "pi-named")!,
        {
          organizationId: "org-a",
          artifactId: "artifact-a",
          url: "https://radius.earendil.com/a/artifact-a",
        },
      );
      yield* registry.touchSession(first, "pi-named");
      const [, next] = [...(yield* Fiber.join(views))];
      const updatedAt = (yield* registry.get).sessions[0]?.updatedAt;
      assert.equal(
        next?.sessionReferences?.[0]?.updatedAt,
        updatedAt,
        "the view after the statistics and sharing writes is the touch",
      );
      assert.equal("radiusShare" in (next?.sessionReferences?.[0] ?? {}), false);
    }),
  );
});

test("INV-01/INV-07: a session reference keeps its registry creation time and workspace after its folder closes", async () => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView;
      yield* registry.addFolder(first);
      yield* registry.addSession(first, "kept", "Kept");
      const entry = (yield* registry.get).sessions[0]!;
      const workspaceId = (yield* registry.get).workspaces.find((w) => w.path === first)!.id;
      const open = (yield* view.fresh).sessionReferences?.[0];
      assert.deepEqual(
        open && [open.createdAt, open.workspaceId, open.branch],
        [entry.createdAt, workspaceId, null],
        "non-Git discovery knows no branch",
      );

      yield* registry.removeFolder(first);
      const closed = yield* view.fresh;
      assert.deepEqual(closed.folders, []);
      const ref = closed.sessionReferences?.[0];
      assert.deepEqual(ref && [ref.sessionId, ref.createdAt, ref.workspaceId, ref.branch], [
        "kept",
        entry.createdAt,
        workspaceId,
        null,
      ]);
    }),
  );
});

test("INV-01: a trust decision reaches the sidebar without a registry write", async () => {
  const skilled = join(root, "skilled");
  // A project skill makes the directory's trust matter to Pi.
  mkdirSync(join(skilled, ".agents/skills/hello"), { recursive: true });
  writeFileSync(
    join(skilled, ".agents/skills/hello/SKILL.md"),
    "---\nname: hello\ndescription: say hello\n---\nSay hello.\n",
  );
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView,
        facts = yield* DirectoryFacts;
      yield* registry.addFolder(skilled);
      const trustIn = (m: SidebarMessage) => m.folders[0]?.worktrees[0]?.trust;
      assert.deepEqual(trustIn(yield* view.fresh), { required: true, trusted: false });
      const runs = git.calls;

      // Pi's store is not the registry: DirectoryFacts announces the decision, and the view follows without Git.
      git.hold();
      const next = yield* nextView(view, (m) => trustIn(m)?.trusted === true).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* facts.setTrust(skilled, true);
      assert.deepEqual(trustIn(yield* Fiber.join(next)), { required: true, trusted: true });
      assert.equal(git.calls, runs, "no discovery run was needed");
      git.release();
    }),
  );
});

/** A Pi session file whose header records `cwd`, as Pi writes it when its CLI starts there. */
const seedHistory = (cwd: string, id: string) =>
  writeFileSync(
    join(root, "sessions", `${id}.jsonl`),
    `${JSON.stringify({ type: "session", version: 3, id, cwd, timestamp: "2026-10-05T00:00:00Z" })}\n`,
  );

test("INV-01: the sidebar marks a project member unavailable exactly when SessionHosts cannot find its history or checkout", async () => {
  const physical = join(root, "physical"),
    alias = join(root, "alias"),
    gone = join(root, "gone");
  mkdirSync(physical);
  symlinkSync(physical, alias);
  mkdirSync(gone);
  await run(
    slowGit(),
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView,
        hosts = yield* SessionHosts;
      yield* registry.addFolder(alias);
      yield* registry.addFolder(gone);
      yield* registry.saveProject({ id: "outcome", name: "Outcome" });
      // Pi was started in the physical directory, so its file names that spelling, not the registry's.
      seedHistory(physical, "aliased");
      seedHistory(gone, "removed");
      for (const [cwd, id] of [
        [alias, "aliased"],
        [alias, "never-written"],
        [gone, "removed"],
      ]) {
        yield* registry.addSession(cwd, id);
        yield* registry.assignProject(cwd, id, "outcome");
      }
      rmSync(gone, { recursive: true });
      const unavailable = new Map(
        (yield* view.fresh).sessionReferences?.map((s) => [s.sessionId, s.unavailable]),
      );
      assert.deepEqual(Object.fromEntries(unavailable), {
        aliased: undefined,
        "never-written": "history",
        removed: "checkout",
      });
      // The opener agrees: it finds the aliased session's file under the physical spelling.
      assert.equal(
        (yield* hosts.peek(alias, "aliased")).snapshot.state.sessionFile,
        join(root, "sessions", "aliased.jsonl"),
      );
    }),
  );
});
