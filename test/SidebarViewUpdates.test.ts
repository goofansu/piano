import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, type TestContext, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { DirectoryFacts } from "../server/DirectoryFacts.ts";
import { PianoCoreLive } from "../server/PianoServices.ts";
import { PiCli } from "../server/PiCli.ts";
import { Registry, RegistryDatabasePath } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { type SidebarMessage, SidebarView } from "../server/SidebarView.ts";
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
        return {
          status: "non-git",
          observedAt: new Date(1_700_000_000_000 + git.calls).toISOString(),
        };
      }),
  };
  return git;
};

let databases = 0;
const run = <A, E>(
  git: ReturnType<typeof slowGit>,
  effect: Effect.Effect<A, E, SidebarView | DirectoryFacts | Registry | SessionHosts | Scope.Scope>,
  cli = "./fake-pi.mjs",
  extraArgs: readonly string[] = [],
) => {
  const layer = PianoCoreLive({ idleMs: 0, discover: git.discover }).pipe(
    Layer.provide(NodeServices.layer),
  );
  return Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL(cli, import.meta.url).pathname,
        extraArgs,
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
      yield* registry.ensureFolder(first);
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
      yield* registry.ensureFolder(first);
      yield* registry.addSession(first, "s1", "Before");
      yield* view.fresh;
      const runs = git.calls;

      // A prompt or rename must not wait on discovery: hold Git and the new title still arrives.
      git.hold();
      yield* registry.mirrorSession(first, "s1", { sessionName: "After" });
      assert.equal(titleOf(yield* nextView(view, () => true)), "After");
      git.release();

      // A new folder needs discovery; the change starts a run and the view follows it.
      yield* registry.ensureFolder(second);
      const grown = yield* nextView(view, (m) => m.folders.length === 2);
      assert.deepEqual(grown.folders.map((f) => f.path).sort(), [first, second]);
      assert.ok(git.calls > runs, "the change after a finished run rediscovered");
    }),
  );
});

test("INV-01/06/07: a prompt, rename or pin starts no reader; membership and folders start only theirs", async (t) => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView;
      yield* registry.ensureFolder(first);
      yield* registry.addSession(first, "s1", "Before");
      yield* view.fresh;
      const quiet = git.calls;
      // Pi's history directory is availability's input; count its scans and header reads.
      let scans = 0,
        reads = 0;
      const readdir = fsPromises.readdir;
      t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });
      t.mock.method(fsPromises, "readdir", (...args: unknown[]) => {
        if (args[0] === join(root, "sessions")) scans++;
        return Reflect.apply(readdir, fsPromises, args);
      });
      syncBuiltinESMExports();
      const read = fs.read;
      t.mock.method(fs, "read", (...args: unknown[]) => {
        reads++;
        return Reflect.apply(read, fs, args);
      });

      // Exactly the writes a prompt (activity), a Pi rename and the sidebar's pin control make.
      // Each is visible, so each must publish; none is read by a discovery run.
      for (let i = 0; i < 5; i++) yield* registry.touchSession(first, "s1", `prompt ${i}`);
      yield* registry.mirrorSession(first, "s1", { sessionName: "After" });
      yield* registry.pinSession(first, "s1", true);
      // A project's own row is not an observation input either; only membership is.
      yield* registry.saveProject({ id: "outcome", name: "Outcome" });
      const shown = yield* nextView(view, () => true);
      assert.deepEqual(
        [titleOf(shown), shown.sessionReferences?.[0]?.pinned, shown.projects?.length],
        ["After", true, 1],
        "the metadata reached browsers from the last observation",
      );

      // Let already-forked discovery work run before checking its observable counter. Asking
      // for a fresh view here would itself request discovery and hide an erroneous request.
      yield* Effect.yieldNow;
      assert.equal(git.calls, quiet, "no discovery run for visible metadata or a project row");
      assert.equal(scans, 0, "no history scan for visible metadata or a project row");

      // Membership is availability's input, not Git's: assigning the session asks history
      // whether s1 is saved (it is not) and asks Git nothing.
      yield* registry.assignProject(first, "s1", "outcome");
      const judged = yield* nextView(
        view,
        (m) => m.sessionReferences?.[0]?.unavailable === "history",
      );
      assert.equal(judged.sessionReferences?.[0]?.projectId, "outcome");
      yield* Effect.yieldNow;
      assert.ok(scans > 0, "project membership rejudged availability");
      assert.equal(git.calls, quiet, "project membership started no Git discovery");

      // A folder is Git's input, not availability's: registering one discovers it and reads no history.
      const scanned = scans,
        headers = reads;
      yield* registry.ensureFolder(second);
      const grown = yield* nextView(view, (m) => m.folders.length === 2);
      assert.deepEqual(grown.folders.map((f) => f.path).sort(), [first, second]);
      yield* Effect.yieldNow;
      assert.ok(git.calls > quiet, "a new folder was discovered");
      assert.deepEqual(
        [scans - scanned, reads - headers],
        [0, 0],
        "a new folder started no history scan or header read",
      );
    }),
  );
});

test("INV-01: a registry write made outside any browser request reaches the sidebar; cached statistics and the Radius share do not, a pull request link does", async () => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView,
        hosts = yield* SessionHosts;
      yield* registry.ensureFolder(first);
      yield* view.fresh;
      yield* registry.addSession(first, "pi-named");
      const session = yield* hosts.open({ cwd: first, sessionId: "pi-named" });
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
      const named = (yield* registry.get).sessions.find((s) => s.sessionId === "pi-named")!;
      const shared = yield* registry.setSessionLink(named, "radiusShare", {
        organizationId: "org-a",
        artifactId: "artifact-a",
        url: "https://radius.earendil.com/a/artifact-a",
      });
      yield* registry.touchSession(first, "pi-named");
      const [, next] = [...(yield* Fiber.join(views))];
      const updatedAt = (yield* registry.get).sessions[0]?.updatedAt;
      assert.equal(
        next?.sessionReferences?.[0]?.updatedAt,
        updatedAt,
        "the view after the statistics and share writes is the touch",
      );
      const shown = next?.sessionReferences?.[0] ?? {};
      for (const hidden of ["stats", "pullRequest", "radiusShare"])
        assert.equal(hidden in shown, false, `${hidden} stays off the wire`);

      // A pull request link is what tells a browser to read the PR, so its write publishes
      // from the last observation: no discovery run.
      const runs = git.calls;
      const link = { url: "https://github.com/o/r/pull/1", source: "manual" } as const;
      const [linkedView] = yield* Effect.all(
        [
          nextView(view, (m) => m.sessionReferences?.[0]?.pullRequest?.url === link.url),
          registry.setSessionLink(shared!, "pullRequest", link),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(linkedView.sessionReferences?.[0]?.pullRequest, link);
      assert.equal(git.calls, runs, "a link write starts no Git run");
      const linkedEntry = (yield* registry.get).sessions.find((s) => s.sessionId === "pi-named")!;
      const [removedView] = yield* Effect.all(
        [
          nextView(view, (m) => m.sessionReferences?.[0]?.pullRequest === null),
          registry.setSessionLink(linkedEntry, "pullRequest", null),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(
        removedView.sessionReferences?.[0]?.pullRequest,
        null,
        "removal reaches the wire",
      );
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
      yield* registry.ensureFolder(first);
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

test("INV-01: a repeated observation that found nothing new publishes no view; a real change still does", async () => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView,
        facts = yield* DirectoryFacts;
      yield* registry.ensureFolder(first);
      yield* registry.addSession(first, "s1", "One");
      yield* view.fresh;

      // One browser is listening. Everything until the new session is another browser's page
      // load, its five-second checkout poll and a Pi resource invalidation: each re-observes,
      // none of them changes what this browser shows.
      const views = yield* view.subscribe.pipe(
        Effect.flatMap((s) =>
          s.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild({ startImmediately: true })),
        ),
      );
      const runs = git.calls;
      yield* view.fresh;
      yield* view.fresh;
      yield* facts.invalidate;
      assert.ok(git.calls > runs, "the repeated observations really ran");

      yield* registry.addSession(first, "s2", "Two");
      const [initial, next] = [...(yield* Fiber.join(views))];
      assert.equal(
        initial?.sessionReferences?.length,
        1,
        "the subscriber starts from the latest view",
      );
      assert.deepEqual(
        next?.sessionReferences?.map((s) => s.title),
        ["One", "Two"],
        "the next view is the new session, not a repeat of the one already shown",
      );
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
      yield* registry.ensureFolder(skilled);
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

test("INV-01/02/06: retirement rechecks saved history without waiting for Git or explicit refresh", async () => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        hosts = yield* SessionHosts,
        view = yield* SidebarView;
      yield* registry.saveProject({ id: "lifecycle", name: "Lifecycle" });
      // Registration is before Pi starts: force the real initial missing-history observation.
      yield* registry.onChange((before, after) =>
        after.sessions.length > before.sessions.length
          ? view.fresh.pipe(
              Effect.tap((m) =>
                Effect.sync(() => {
                  const id = after.sessions.at(-1)!.sessionId;
                  assert.equal(
                    m.sessionReferences?.find((s) => s.sessionId === id)?.unavailable,
                    "history",
                  );
                }),
              ),
            )
          : Effect.void,
      );
      const session = yield* hosts.create({ cwd: first, projectId: "lifecycle", options: {} });
      const id = session.spec.sessionId;
      const ref = (m: SidebarMessage) => m.sessionReferences?.find((s) => s.sessionId === id);
      yield* view.fresh;
      // Leave an older full refresh waiting on Git while Pi persists and then stops.
      const held = git.hold();
      const full = yield* view.fresh.pipe(Effect.forkChild({ startImmediately: true }));
      yield* held;
      const runs = git.calls;
      // Shape drift must not hold back history either: this folder waits for the queued Git
      // run, while availability may still publish against the already observed folder set.
      yield* registry.ensureFolder(second);
      try {
        const written = yield* session.events.pipe(
          Stream.filter((e) => e._tag === "message_end" && e.message.text === `Final ${id}`),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* session.act({ _tag: "prompt", text: "/final" });
        yield* Fiber.join(written);
        yield* hosts.release(first, id);
        // Pin exposes a stale cached negative immediately on the unfixed build. Subscribe after
        // that publication: only retirement's own availability read can correct it with Git held.
        yield* registry.pinSession(first, id, true);
        const available = yield* nextView(
          view,
          (m) => ref(m)?.unavailable === undefined && !!ref(m)?.pinned,
        );
        assert.equal(ref(available)?.unavailable, undefined);
        assert.equal(git.calls, runs, "retirement did not start Git discovery");
        const saved = yield* hosts.read(first, id);
        assert.equal(saved._tag, "saved");
        if (saved._tag === "saved")
          assert.deepEqual(
            saved.snapshot.messages.map((m) => m.text),
            [`Final ${id}`],
          );
      } finally {
        git.release();
      }
      // Completing the older Git observation cannot overwrite the newer availability.
      assert.equal(ref(yield* Fiber.join(full))?.unavailable, undefined);
    }),
    "./fake-host-pi.mjs",
  );
});

test("INV-01/02: failed acquisition rechecks history saved before readiness failed", async () => {
  await run(
    slowGit(),
    Effect.gen(function* () {
      const registry = yield* Registry,
        hosts = yield* SessionHosts,
        view = yield* SidebarView;
      yield* registry.saveProject({ id: "failed-start", name: "Failed start" });
      yield* registry.onChange((before, after) =>
        after.sessions.length > before.sessions.length ? view.fresh : Effect.void,
      );
      const result = yield* hosts
        .create({ cwd: second, projectId: "failed-start", options: {} })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.match(result.failure.detail, /fixture readiness failure/);
      const id = (yield* registry.get).sessions[0]!.sessionId;
      const available = yield* nextView(
        view,
        (m) => m.sessionReferences?.some((s) => s.sessionId === id && !s.unavailable) === true,
      );
      assert.equal(available.sessionReferences?.[0]?.unavailable, undefined);
      assert.deepEqual(yield* hosts.list, [], "failed acquisition left no running host");
      const saved = yield* hosts.read(second, id);
      assert.equal(saved._tag, "saved");
      if (saved._tag === "saved")
        assert.deepEqual(
          saved.snapshot.messages.map((m) => m.text),
          ["Saved before readiness failed"],
        );
    }),
    "./fake-host-pi.mjs",
    ["--persist-before-readiness-failure"],
  );
});

/** Withhold one real filesystem read's callback, after the bytes have been captured. Other
 * readers (including a concurrent host open) proceed normally. No SessionReferences mock. */
const holdHistoryRead = (t: TestContext) => {
  let entered: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => {};
  let armed = true;
  const read = fs.read;
  t.mock.method(fs, "read", (...args: unknown[]) => {
    const callback = args.pop() as (...result: unknown[]) => void;
    const hold = armed;
    armed = false;
    return Reflect.apply(read, fs, [
      ...args,
      (...result: unknown[]) => {
        if (!hold) return callback(...result);
        release = () => {
          release = () => {};
          callback(...result);
        };
        entered();
      },
    ]);
  });
  return { entered: Effect.promise(() => waiting), release: () => release() };
};

test("INV-01/05: fresh awaits availability; a lifetime during its read invalidates the old verdict", async (t) => {
  const git = slowGit();
  const cwd = join(root, "racing-history");
  mkdirSync(cwd);
  seedHistory(cwd, "marker");
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        hosts = yield* SessionHosts,
        view = yield* SidebarView;
      yield* registry.ensureFolder(cwd);
      yield* registry.saveProject({ id: "racing", name: "Racing" });
      yield* registry.addSession(cwd, "rapid", undefined, "racing");
      const before = yield* view.fresh;
      const ref = (m: SidebarMessage) => m.sessionReferences?.find((s) => s.sessionId === "rapid");
      assert.equal(ref(before)?.unavailable, "history");
      // A second folder is the next Git run's news: re-observing the same checkouts publishes
      // nothing, so the view that names both folders is what says that run installed.
      const gitUpdated = yield* nextView(view, (m) => m.folders.length === 2).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      // Ensure a real read even when unchanged headers from the previous refresh are cached.
      seedHistory(cwd, "new-marker");
      const held = holdHistoryRead(t);
      let freshDone = false;
      const full = yield* view.fresh.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            freshDone = true;
          }),
        ),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* held.entered;
      try {
        yield* registry.ensureFolder(second);
        yield* Fiber.join(gitUpdated);
        yield* Effect.yieldNow;
        assert.equal(freshDone, false, "Git completed, but fresh still owes an availability read");
        const runs = git.calls;
        const session = yield* hosts.open({ cwd, sessionId: "rapid" });
        const persisted = yield* session.events.pipe(
          Stream.filter((e) => e._tag === "message_end" && e.message.text === "Final rapid"),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* session.act({ _tag: "prompt", text: "/final" });
        yield* Fiber.join(persisted);
        yield* hosts.release(cwd, "rapid");
        yield* registry.pinSession(cwd, "rapid", true);
        // Consume only subsequent publications. The read already in flight saw no rapid file;
        // it must be discarded, not published before the corrective read queued by the lifetime.
        const next = yield* view.subscribe.pipe(
          Effect.flatMap((s) => s.pipe(Stream.drop(1), Stream.take(1), Stream.runCollect)),
          Effect.forkChild({ startImmediately: true }),
        );
        held.release();
        assert.equal(ref([...(yield* Fiber.join(next))][0]!)?.unavailable, undefined);
        assert.equal(ref(yield* Fiber.join(full))?.unavailable, undefined);
        assert.equal(git.calls, runs, "the whole host lifetime needed no additional Git run");
      } finally {
        held.release();
      }
    }),
    "./fake-host-pi.mjs",
  );
});

test("INV-01/06: established-host prompts do not rescan history; a never-written session stays unavailable after release", async (t) => {
  const git = slowGit();
  await run(
    git,
    Effect.gen(function* () {
      const registry = yield* Registry,
        hosts = yield* SessionHosts,
        view = yield* SidebarView;
      seedHistory(first, "performance-marker");
      yield* registry.saveProject({ id: "no-history", name: "No history" });
      const session = yield* hosts.create({ cwd: first, projectId: "no-history", options: {} });
      const id = session.spec.sessionId;
      const ref = (m: SidebarMessage) => m.sessionReferences?.find((s) => s.sessionId === id);
      yield* view.fresh;
      const runs = git.calls;
      let reads = 0,
        scans = 0;
      const readdir = fsPromises.readdir;
      t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });
      t.mock.method(fsPromises, "readdir", (...args: unknown[]) => {
        if (args[0] === join(root, "sessions")) scans++;
        return Reflect.apply(readdir, fsPromises, args);
      });
      syncBuiltinESMExports();
      const read = fs.read;
      t.mock.method(fs, "read", (...args: unknown[]) => {
        reads++;
        return Reflect.apply(read, fs, args);
      });
      for (let i = 0; i < 5; i++) {
        const barrier = yield* session.events.pipe(
          Stream.filter((e) => e._tag === "notice" && e.message === `barrier /prompt-${i}`),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* session.act({ _tag: "prompt", text: `/prompt-${i}` });
        yield* Fiber.join(barrier);
      }
      yield* Effect.yieldNow;
      assert.equal(git.calls, runs, "five prompts add no Git discovery");
      assert.equal(scans, 0, "five prompts start no history directory scans");
      assert.equal(reads, 0, "five prompts add no history header reads");
      t.diagnostic(
        `five established-host prompts: ${git.calls - runs} Git runs, ${scans} history scans, ${reads} header reads`,
      );
      // This fake handled the prompts without writing history. Retirement must actually check
      // disk, not infer that having had a live host guarantees a saved conversation.
      yield* hosts.release(first, id);
      const missing = yield* nextView(view, (m) => ref(m)?.unavailable === "history");
      assert.equal(ref(missing)?.unavailable, "history");
      assert.ok(scans > 0, "retirement did inspect the real history directory");
      t.diagnostic(
        `retirement: ${git.calls - runs} Git runs, ${scans} history scans, ${reads} header reads`,
      );
    }),
    "./fake-host-pi.mjs",
  );
});

/** A Pi session file whose header records `cwd`, as Pi writes it when its CLI starts there. */
const seedHistory = (cwd: string, id: string) =>
  writeFileSync(
    join(root, "sessions", `${id}.jsonl`),
    `${JSON.stringify({ type: "session", version: 3, id, cwd, timestamp: "2026-10-05T00:00:00Z" })}\n`,
  );

// SessionReferences' tests own which sessions are unavailable and that the opener agrees; this
// one owns that the sidebar shows that judgement for project members.
test("INV-01: the sidebar marks a project member unavailable when its history or checkout is gone", async () => {
  const kept = join(root, "kept"),
    gone = join(root, "gone");
  mkdirSync(kept);
  mkdirSync(gone);
  await run(
    slowGit(),
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView;
      yield* registry.ensureFolder(kept);
      yield* registry.ensureFolder(gone);
      yield* registry.saveProject({ id: "outcome", name: "Outcome" });
      seedHistory(kept, "written");
      seedHistory(gone, "removed");
      for (const [cwd, id] of [
        [kept, "written"],
        [kept, "never-written"],
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
        written: undefined,
        "never-written": "history",
        removed: "checkout",
      });
    }),
  );
});
