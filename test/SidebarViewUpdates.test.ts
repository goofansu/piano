import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHostsLive } from "../server/SessionHosts.ts";
import { type SidebarMessage, SidebarView, SidebarViewLive } from "../server/SidebarView.ts";
import type { WorktreeDiscovery } from "../shared/wire.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-sidebar-")));
const first = join(root, "first"), second = join(root, "second");
mkdirSync(first); mkdirSync(second);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
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
      gate = new Promise(resolve => { open = resolve; });
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      return Effect.promise(() => waiting);
    },
    release: () => { gate = undefined; open(); },
    discover: (_folder: string) => Effect.promise(async (): Promise<WorktreeDiscovery> => {
      git.calls++;
      if (gate) entered();
      await gate;
      return { status: "non-git", observedAt: new Date().toISOString() };
    }),
  };
  return git;
};

let databases = 0;
const run = <A, E>(git: ReturnType<typeof slowGit>, effect: Effect.Effect<A, E, SidebarView | Registry | Scope.Scope>) => {
  const layer = SidebarViewLive({ discover: git.discover }).pipe(
    Layer.provideMerge(SessionHostsLive({ idleMs: 0 })), Layer.provide(PiSessionsLive), Layer.provideMerge(RegistryLive), Layer.provide(NodeServices.layer));
  return Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer),
    Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)), Effect.timeout("10 seconds")));
};
const nextView = (view: SidebarView["Service"], match: (m: SidebarMessage) => boolean) =>
  view.subscribe.pipe(Effect.flatMap(s => s.pipe(Stream.filter(match), Stream.take(1), Stream.runCollect)), Effect.map(c => [...c][0]!));
const titleOf = (m: SidebarMessage) => m.folders[0]?.sessions[0]?.title;

test("INV-06: changes during discovery coalesce into one more run; a late subscriber gets the latest view", async () => {
  const git = slowGit();
  await run(git, Effect.gen(function* () {
    const registry = yield* Registry, view = yield* SidebarView;
    yield* registry.addFolder(first);
    yield* view.fresh;
    const before = git.calls;
    // Hold a run in Git; every change below lands while it runs.
    const held = git.hold();
    yield* view.refresh;
    yield* held;
    yield* Effect.forEach(Array.from({ length: 20 }, (_, i) => i), i =>
      registry.addSession(first, `s${i}`).pipe(Effect.andThen(view.changed)), { concurrency: "unbounded" });
    // Asked for while the run is still held, so the run after it answers.
    const fresh = yield* Effect.forkChild(view.fresh, { startImmediately: true });
    git.release();
    const built = yield* Fiber.join(fresh);
    assert.equal(git.calls - before, 2, "the held run plus one run for everything that changed during it");
    assert.equal(built.folders[0]?.sessions.length, 20);

    const late = yield* nextView(view, () => true);
    assert.deepEqual(late.folders.map(f => [f.path, f.sessions.length]), [[first, 20]], "a late subscriber starts from the latest view");
  }));
});

test("INV-06: a registry-only change publishes before Git answers; a later change starts a fresh run", async () => {
  const git = slowGit();
  await run(git, Effect.gen(function* () {
    const registry = yield* Registry, view = yield* SidebarView;
    yield* registry.addFolder(first);
    yield* registry.addSession(first, "s1", "Before");
    yield* view.fresh;
    const runs = git.calls;

    // A prompt or rename must not wait on discovery: hold Git and the new title still arrives.
    git.hold();
    yield* registry.renameSession(first, "s1", "After");
    yield* view.changed;
    assert.equal(titleOf(yield* nextView(view, () => true)), "After");
    git.release();

    // A new folder needs discovery; the change starts a run and the view follows it.
    yield* registry.addFolder(second);
    yield* view.changed;
    const grown = yield* nextView(view, m => m.folders.length === 2);
    assert.deepEqual(grown.folders.map(f => f.path).sort(), [first, second]);
    assert.ok(git.calls > runs, "the change after a finished run rediscovered");
  }));
});
