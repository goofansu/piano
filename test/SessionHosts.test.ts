import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Option, type Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { PreviewAdapter, type PreviewOwnerIdentity } from "../scripts/PreviewAdapter.ts";
import { ownerRequest } from "../scripts/PreviewClient.ts";
import { PiCli } from "../server/PiCli.ts";
import {
  PiRequestTimeoutMs,
  type PiSession,
  PiSessionError,
  PiSessions,
  PiSessionsLive,
  PreviewOwnerOptions,
} from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive, SessionNotCreated } from "../server/SessionHosts.ts";
import { WorktrunkCommand } from "../server/Worktrees.ts";
import { closureNeedsAttention } from "../shared/sessionStatus.ts";
import type { SessionEvent } from "../shared/wire.ts";

const root = mkdtempSync(join(tmpdir(), "piano-hosts-"));
const cwd = join(root, "checkout"),
  alias = join(root, "alias"),
  audit = join(root, "audit.jsonl");
mkdirSync(cwd);
symlinkSync(cwd, alias);
mkdirSync(join(root, "sessions"));
writeFileSync(audit, "");
assert.equal(spawnSync("git", ["init", "--quiet", cwd]).status, 0);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));
const cli = {
  node: process.execPath,
  cli: new URL("./fake-host-pi.mjs", import.meta.url).pathname,
  extraArgs: ["--audit", audit],
};
type Record = {
  event: string;
  pid: number;
  sessionId: string;
  command?: string;
  text?: string;
  previewOwner?: string;
  instructions?: string;
};
const records = (id: string): Record[] =>
  readFileSync(audit, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((r) => r.sessionId === id);
const waitAudit = (id: string, pred: (records: Record[]) => boolean) =>
  Effect.promise(
    (signal) =>
      new Promise<void>((resolve, reject) => {
        const poll = setInterval(check, 20);
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`audit deadline for ${id}`));
        }, 5000);
        function cleanup() {
          clearInterval(poll);
          clearTimeout(timer);
          signal.removeEventListener("abort", cleanup);
        }
        function check() {
          if (pred(records(id))) {
            cleanup();
            resolve();
          }
        }
        signal.addEventListener("abort", cleanup, { once: true });
        check();
      }),
  );
const run = <A, E>(
  effect: Effect.Effect<A, E, SessionHosts | Registry | Scope.Scope>,
  options: {
    idleMs?: number;
    holdShutdown?: boolean;
    holdReadiness?: boolean;
    failReadiness?: "empty" | "saved";
    missingNode?: boolean;
    unconfirmedStop?: boolean;
    holdStats?: boolean;
    statsFile?: string;
    clock?: boolean;
    timeoutMs?: number;
    fakePi?: string;
    previewAdapter?: PreviewAdapter;
    registry?: string;
  } = {},
) => {
  const layer = SessionHostsLive({ idleMs: options.idleMs ?? 0 }).pipe(
    Layer.provide(
      options.unconfirmedStop
        ? Layer.effect(
            PiSessions,
            Effect.map(PiSessions, (pi) => ({
              ...pi,
              open: (spec: Parameters<typeof pi.open>[0]) =>
                pi
                  .open(spec)
                  .pipe(
                    Effect.mapError(
                      (e) => new PiSessionError({ reason: e.reason, detail: e.detail }),
                    ),
                  ),
            })),
          ).pipe(Layer.provide(PiSessionsLive))
        : PiSessionsLive,
    ),
    Layer.provideMerge(RegistryLive),
    Layer.provide(NodeServices.layer),
  );
  const work = effect.pipe(
    Effect.scoped,
    Effect.provide(layer),
    Effect.provideService(
      PiCli,
      options.fakePi
        ? {
            node: process.execPath,
            cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
            extraArgs: [],
          }
        : {
            ...cli,
            ...(options.missingNode ? { node: join(root, "no-such-node") } : {}),
            extraArgs: [
              ...cli.extraArgs,
              ...(options.holdShutdown ? ["--hold-shutdown"] : []),
              ...(options.holdReadiness ? ["--hold-readiness"] : []),
              ...(options.failReadiness
                ? [
                    options.failReadiness === "saved"
                      ? "--persist-before-readiness-failure"
                      : "--fail-readiness",
                  ]
                : []),
              ...(options.holdStats ? ["--hold-stats"] : []),
              ...(options.statsFile ? ["--stats-file", options.statsFile] : []),
            ],
          },
    ),
    Effect.provideService(PiRequestTimeoutMs, options.timeoutMs ?? 30000),
    Effect.provideService(
      RegistryDatabasePath,
      join(root, `${options.registry ?? options.fakePi ?? "registry"}.db`),
    ),
    Effect.provideService(
      PreviewOwnerOptions,
      options.previewAdapter
        ? { adapter: options.previewAdapter, root: join(root, "previews") }
        : {},
    ),
  );
  return Effect.runPromise(options.clock ? work.pipe(Effect.provide(TestClock.layer())) : work);
};
test("INV-01/02: failed fresh startup removes only its conclusively empty reference after Pi exits", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const registry = yield* Registry;
      let id = "";
      yield* registry.onChange((before, after) =>
        Effect.sync(() => {
          if (after.sessions.length) id = after.sessions[0].sessionId;
          if (before.sessions.length && !after.sessions.length)
            assert.ok(
              records(id).some((r) => r.event === "exit"),
              "Pi stopped before removing the reference",
            );
        }),
      );
      const error = yield* Effect.flip(hosts.create({ cwd, options: {} }));
      assert.equal(error._tag, "SessionNotCreated");
      assert.deepEqual((yield* registry.get).sessions, []);
      assert.ok(records(id).some((r) => r.event === "exit"));
      assert.equal(records(id).filter((r) => r.command === "prompt").length, 0);
    }),
    { failReadiness: "empty", registry: "empty-start-failure" },
  );
});

test("INV-01/02: a failed fresh startup whose Pi had to be killed is still a confirmed stop", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const error = yield* Effect.flip(hosts.create({ cwd, options: {} }));
      assert.equal(error._tag, "SessionNotCreated");
      assert.deepEqual((yield* (yield* Registry).get).sessions, []);
    }),
    { failReadiness: "empty", holdShutdown: true, registry: "killed-start-failure" },
  );
});

test("INV-01/02: a fresh startup that never spawned Pi leaves no reference", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const error = yield* Effect.flip(hosts.create({ cwd, options: {} }));
      assert.equal(error._tag, "SessionNotCreated");
      assert.deepEqual((yield* (yield* Registry).get).sessions, []);
    }),
    { missingNode: true, registry: "never-spawned" },
  );
});

test("a failed fresh startup gives a done project its done mark back", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "shipped", name: "Shipped" });
      yield* registry.setProjectDone("shipped", true);
      const doneAt = (yield* registry.get).projects[0]!.doneAt;
      assert.ok(doneAt);
      let reopened = false;
      yield* registry.onChange((_before, after) =>
        Effect.sync(() => {
          if (after.sessions.length && after.projects[0]!.doneAt === undefined) reopened = true;
        }),
      );
      const error = yield* Effect.flip(hosts.create({ cwd, projectId: "shipped", options: {} }));
      assert.equal(error._tag, "SessionNotCreated");
      assert.ok(reopened, "the start reopened the project while its reference existed");
      assert.equal((yield* registry.get).projects[0]!.doneAt, doneAt);
    }),
    { failReadiness: "empty", registry: "done-start-failure" },
  );
});

for (const scenario of [
  "saved",
  "unreadable",
  "unattributed-history",
  "stop-unconfirmed",
] as const) {
  test(`INV-01/02: failed startup preserves evidence when ${scenario}`, async () => {
    const unreadable = join(root, "sessions", "unreadable-start.jsonl");
    if (scenario === "unreadable") mkdirSync(unreadable);
    try {
      await run(
        Effect.gen(function* () {
          const hosts = yield* SessionHosts;
          const registry = yield* Registry;
          if (scenario === "unattributed-history")
            yield* registry.onChange((_before, after) =>
              Effect.sync(() => {
                for (const ref of after.sessions)
                  writeFileSync(
                    join(root, "sessions", `unattributed-${ref.sessionId}.jsonl`),
                    JSON.stringify({ type: "session", version: 3, id: ref.sessionId }) + "\n",
                  );
              }),
            );
          const error = yield* Effect.flip(hosts.create({ cwd, options: {} }));
          assert.equal(error._tag, "PiSessionError", "unknown is not proof nothing happened");
          const [reference] = (yield* registry.get).sessions;
          assert.ok(reference && !reference.archived);
          assert.equal(
            records(reference.sessionId).filter((r) => r.command === "prompt").length,
            0,
          );
          if (scenario === "saved") {
            const view = yield* hosts.read(cwd, reference.sessionId);
            assert.equal(view._tag, "saved");
            if (view._tag === "saved")
              assert.equal(view.snapshot.messages[0]?.text, "Saved before readiness failed");
          }
        }),
        {
          failReadiness: scenario === "saved" ? "saved" : "empty",
          unconfirmedStop: scenario === "stop-unconfirmed",
          registry: `start-failure-${scenario}`,
        },
      );
    } finally {
      if (scenario === "unreadable") rmSync(unreadable, { recursive: true });
    }
  });
}

const observe = (session: PiSession, until: (e: SessionEvent) => boolean) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    const fiber = yield* session.events.pipe(
      Stream.tap((e) => (e._tag === "snapshot" ? Deferred.succeed(ready, undefined) : Effect.void)),
      Stream.takeUntil(until),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(ready);
    return fiber;
  });
const prompt = (s: PiSession, text: string) =>
  Effect.gen(function* () {
    const seen = yield* observe(s, (e) => e._tag === "notice" && e.message === `barrier ${text}`);
    yield* s.act({ _tag: "prompt", text });
    yield* Fiber.join(seen);
  });
const quiescent = (s: PiSession) =>
  Effect.gen(function* () {
    while (!(yield* s.state).isQuiescent) yield* Effect.yieldNow;
  });
const registered = (sessionId: string) =>
  Effect.gen(function* () {
    yield* (yield* Registry).addSession(cwd, sessionId);
    return yield* (yield* SessionHosts).open({ cwd, sessionId });
  });
const saved = Effect.fn("test.saved")(function* (
  hosts: SessionHosts["Service"],
  cwd: string,
  id: string,
) {
  const view = yield* hosts.read(cwd, id);
  assert.ok(view._tag === "saved", "expected a stopped session's saved readback");
  return view;
});
const seed = (path: string, id: string, name: string) => {
  const file = join(root, "sessions", `${name}.jsonl`);
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id, cwd: path, timestamp: "2026-10-05T00:00:00Z" },
      {
        type: "message",
        id: "saved",
        parentId: null,
        timestamp: "2026-10-05T00:00:01Z",
        message: { role: "user", content: name, timestamp: 1 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  return file;
};

test(
  "INV-01/03: last-known statistics survive host and registry restart without copying history",
  {
    timeout: 15000,
  },
  async () => {
    const id = "saved-stats",
      statsFile = join(root, "stats.json");
    const stats = {
      cost: 1.23,
      tokens: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, total: 150 },
      contextUsage: { tokens: 50, contextWindow: 1000, percent: 5 },
    };
    writeFileSync(statsFile, JSON.stringify(stats));
    const file = seed(alias, id, "authoritative history"),
      before = readFileSync(file, "utf8");
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        yield* (yield* Registry).addSession(alias, id);
        const s = yield* hosts.open({ cwd, sessionId: id });
        yield* quiescent(s);
        assert.equal((yield* s.state).cost, 1.23);
        assert.equal((yield* s.state).contextIsLastKnown, false);
        const entry = (yield* (yield* Registry).get).sessions.find((s) => s.sessionId === id)!;
        assert.equal(
          entry.stats?.cost,
          1.23,
          "persist while running, not only on graceful release",
        );
        assert.equal(
          entry.updatedAt,
          entry.createdAt,
          "statistics do not reorder session activity",
        );
        assert.deepEqual(Object.keys(entry.stats!).sort(), [
          "context",
          "cost",
          "statsUpdatedAt",
          "tokens",
        ]);
        yield* hosts.release(cwd, id);
      }),
      { statsFile },
    );
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        const view = yield* saved(hosts, cwd, id);
        assert.equal(view.cwd, alias);
        assert.equal(view.snapshot.state.cost, 1.23);
        assert.deepEqual(view.snapshot.state.context, stats.contextUsage);
        assert.deepEqual(view.snapshot.state.tokens, stats.tokens);
        assert.equal(view.snapshot.state.contextIsLastKnown, true);
        assert.equal(typeof view.snapshot.state.statsUpdatedAt, "number");
        assert.equal(view.snapshot.messages[0].text, "authoritative history");
        assert.equal(readFileSync(file, "utf8"), before);
        assert.equal(
          records(id).filter((r) => r.event === "spawn").length,
          1,
          "peeking never starts Pi",
        );
        yield* (yield* Registry).addSession(cwd, "uncached-stats");
        const unknown = (yield* saved(hosts, cwd, "uncached-stats")).snapshot.state;
        assert.equal(unknown.context, undefined);
        assert.equal(unknown.cost, undefined, "no invented zero or another session's cache");

        const s = yield* hosts.open({ cwd, sessionId: id });
        assert.equal(
          (yield* s.state).cost,
          1.23,
          "cached snapshot available before withheld stats reply",
        );
        assert.equal((yield* s.state).contextIsLastKnown, true);
        yield* waitAudit(
          id,
          (rs) => rs.filter((r) => r.command === "get_session_stats").length === 2,
        );
        const failed = yield* observe(s, (e) => e._tag === "state" && !!e.state.statsRefreshError);
        writeFileSync(statsFile, JSON.stringify({ error: "fixture unavailable" }));
        process.kill(records(id).findLast((r) => r.event === "spawn")!.pid, "SIGCONT");
        yield* Fiber.join(failed);
        assert.equal((yield* s.state).cost, 1.23);
        assert.deepEqual((yield* s.state).context, stats.contextUsage);
        assert.equal((yield* s.state).contextIsLastKnown, true);
        assert.equal(
          (yield* s.state).statsUpdatedAt,
          view.snapshot.state.statsUpdatedAt,
          "failed reads never advance observation time",
        );

        writeFileSync(
          statsFile,
          JSON.stringify({
            cost: 0,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            contextUsage: { tokens: null, contextWindow: 2000, percent: null },
          }),
        );
        const fresh = yield* observe(
          s,
          (e) =>
            e._tag === "state" &&
            e.state.context?.tokens === null &&
            e.state.contextIsLastKnown === false,
        );
        yield* prompt(s, "/settle");
        yield* Fiber.join(fresh);
        const state = yield* s.state;
        assert.equal(state.statsRefreshError, undefined);
        assert.equal(state.cost, 0, "fresh Pi values replace rather than sum or max the cache");
        assert.equal(state.tokens?.total, 0);
        const closed = yield* observe(s, (e) => e._tag === "closed");
        process.kill(records(id).findLast((r) => r.event === "spawn")!.pid, "SIGUSR1");
        yield* Fiber.join(closed);
        const stopped = (yield* saved(hosts, cwd, id)).snapshot.state;
        assert.equal(stopped.cost, 0);
        assert.equal(stopped.contextIsLastKnown, true);
      }),
      { statsFile, holdStats: true },
    );
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        const cached = (yield* saved(hosts, cwd, id)).snapshot.state;
        assert.deepEqual(cached.context, { tokens: null, contextWindow: 2000, percent: null });
        assert.equal(cached.cost, 0);
        writeFileSync(statsFile, JSON.stringify({ cost: 0 }));
        const s = yield* hosts.open({ cwd, sessionId: id });
        yield* quiescent(s);
        assert.equal(
          (yield* s.state).context,
          undefined,
          "Pi omission clears cached context when no model/window is available",
        );
        yield* hosts.release(cwd, id);
        assert.equal((yield* saved(hosts, cwd, id)).snapshot.state.context, undefined);
      }),
      { statsFile },
    );
  },
);

test("INV-01/02/06: deleted checkout history remains readable and can be archived or deleted without starting Pi", async () => {
  const path = join(root, "deleted-checkout");
  mkdirSync(path);
  const archived = seed(path, "missing-archive", "preserved conversation");
  const deleted = seed(path, "missing-delete", "discarded conversation");
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.addSession(path, "missing-archive");
      yield* registry.addSession(path, "missing-delete");
      rmSync(path, { recursive: true });
      assert.equal(yield* hosts.get(path, "missing-archive"), undefined);
      assert.equal(
        (yield* saved(hosts, path, "missing-archive")).snapshot.state.checkoutMissing,
        true,
      );
      assert.match(
        (yield* hosts.open({ cwd: path, sessionId: "missing-archive" }).pipe(Effect.flip)).detail,
        /checkout no longer exists/,
      );
      yield* hosts.archive(path, "missing-archive");
      yield* hosts.delete(path, "missing-delete");
      assert.ok(existsSync(archived));
      assert.equal(existsSync(deleted), false);
      assert.equal(
        (yield* registry.get).sessions.find((s) => s.sessionId === "missing-archive")?.archived,
        true,
      );
      assert.equal(
        (yield* registry.get).sessions.some((s) => s.sessionId === "missing-delete"),
        false,
      );
      assert.equal(records("missing-archive").length + records("missing-delete").length, 0);
    }),
  );
});

for (const removed of ["checkout", "alias"])
  test(`INV-02/06: ${removed} removal preserves live ownership and blocks further work before retirement`, async () => {
    const id = `live-deleted-${removed}`,
      path = join(root, id),
      link = join(root, `${id}-alias`);
    mkdirSync(path);
    symlinkSync(path, link);
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        yield* registry.addSession(link, id);
        const session = yield* hosts.open({ cwd: path, sessionId: id });
        yield* prompt(session, "/settle");
        yield* quiescent(session);
        const activity = Effect.map(registry.get, ({ sessions }) => {
          const entry = sessions.find((s) => s.sessionId === id);
          return { updatedAt: entry?.updatedAt, title: entry?.title };
        });
        const recorded = yield* activity;
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));
        rmSync(removed === "checkout" ? path : link, { recursive: true });
        assert.match(
          (yield* session.act({ _tag: "prompt", text: "must not send" }).pipe(Effect.flip)).detail,
          /checkout no longer exists/,
        );
        assert.deepEqual(yield* activity, recorded);
        assert.equal(yield* hosts.get(path, id), undefined);
        const view = yield* saved(hosts, path, id);
        assert.equal(view.cwd, link);
        assert.equal(view.snapshot.state.checkoutMissing, true);
        assert.equal(records(id).filter((r) => r.event === "exit").length, 1);
        assert.equal(records(id).filter((r) => r.text === "must not send").length, 0);
        yield* hosts.delete(link, id);
        assert.equal(
          (yield* registry.get).sessions.some((s) => s.sessionId === id),
          false,
        );
        assert.equal(records(id).filter((r) => r.event === "spawn").length, 1);
      }),
    );
  });

test("INV-02/06: Stop remains available for active work after its checkout is removed", async () => {
  const id = "stop-deleted-checkout",
    path = join(root, id);
  mkdirSync(path);
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      yield* (yield* Registry).addSession(path, id);
      const session = yield* hosts.open({ cwd: path, sessionId: id });
      yield* prompt(session, "/hold");
      rmSync(path, { recursive: true });
      assert.deepEqual(yield* session.act({ _tag: "stop" }), {
        _tag: "queue_restored",
        messages: [],
      });
      yield* quiescent(session);
      assert.equal((yield* session.state).isStreaming, false);
      assert.deepEqual(
        records(id)
          .filter((r) => r.command === "clear_queue" || r.command === "abort")
          .map((r) => r.command),
        ["clear_queue", "abort"],
      );
    }),
  );
});

test("archiving or deleting working Pi announces a quiet stop to every viewer; releasing it does not", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const closureSeenBy = (id: string, stop: Effect.Effect<void, unknown>) =>
        Effect.gen(function* () {
          const session = yield* registered(id);
          yield* prompt(session, "/hold");
          assert.equal((yield* session.state).isQuiescent, false, "Pi is working when it stops");
          const viewer = yield* observe(session, (e) => e._tag === "closed");
          yield* stop;
          const frames = yield* Fiber.join(viewer);
          const closed = frames.find((e) => e._tag === "closed");
          assert.ok(closed?._tag === "closed", `${id}: the viewer sees Pi stop`);
          return closed.closure;
        });
      for (const [id, stop] of [
        ["requested-archive", (id: string) => hosts.archive(cwd, id)],
        ["requested-delete", (id: string) => hosts.delete(cwd, id)],
      ] as const) {
        const closure = yield* closureSeenBy(id, stop(id));
        assert.equal(closureNeedsAttention(closure), false, `${id}: ${JSON.stringify(closure)}`);
      }
      const released = yield* closureSeenBy(
        "unrequested-release",
        hosts.release(cwd, "unrequested-release"),
      );
      assert.equal(closureNeedsAttention(released), true, JSON.stringify(released));
    }),
  );
});

test("archiving or deleting working Pi whose checkout is gone announces a quiet stop", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      for (const operation of ["archive", "delete"] as const) {
        const id = `missing-requested-${operation}`,
          path = join(root, id);
        mkdirSync(path);
        yield* (yield* Registry).addSession(path, id);
        const session = yield* hosts.open({ cwd: path, sessionId: id });
        yield* prompt(session, "/hold");
        assert.equal((yield* session.state).isQuiescent, false, "Pi is working when it stops");
        const viewer = yield* observe(session, (e) => e._tag === "closed");
        rmSync(path, { recursive: true });
        yield* hosts[operation](path, id);
        const closed = (yield* Fiber.join(viewer)).find((e) => e._tag === "closed");
        assert.ok(closed?._tag === "closed", `${operation}: the viewer sees Pi stop`);
        assert.equal(
          closureNeedsAttention(closed.closure),
          false,
          `${operation}: ${JSON.stringify(closed.closure)}`,
        );
      }
    }),
  );
});

test("a subscriber hears a session stop that happens before it reads the stream", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      yield* quiescent(yield* registered("subscribed-stop"));
      const running = yield* hosts.subscribe;
      yield* hosts.archive(cwd, "subscribed-stop");
      const lists = yield* running.pipe(
        Stream.takeUntil((list) => !list.some((h) => h.sessionId === "subscribed-stop")),
        Stream.runCollect,
        Effect.timeout("5 seconds"),
      );
      assert.equal(
        lists.at(-1)?.some((h) => h.sessionId === "subscribed-stop"),
        false,
        "the last list has no stopped session",
      );
    }),
  );
});

test("a lifecycle subscriber hears a retirement that completes before it reads the stream", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      yield* quiescent(yield* registered("subscribed-retire"));
      const changes = yield* hosts.lifecycleChanges;
      yield* hosts.archive(cwd, "subscribed-retire");
      const heard = yield* changes.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("5 seconds"),
      );
      assert.equal([...heard].length, 1, "the retirement invalidates history");
    }),
  );
});

test("INV-02: concurrent public opens through real/symlink paths have one child lifetime", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      yield* (yield* Registry).addSession(cwd, "coalesced");
      const sessions = yield* Effect.all(
        Array.from({ length: 8 }, (_, i) =>
          hosts.open({ cwd: i % 2 ? alias : cwd, sessionId: "coalesced" }),
        ),
        { concurrency: "unbounded" },
      );
      assert.equal(records("coalesced").filter((r) => r.event === "spawn").length, 1);
      assert.ok(sessions.every((s) => s === sessions[0]));
      yield* hosts.release(alias, "coalesced");
      assert.equal(records("coalesced").filter((r) => r.event === "exit").length, 1);
    }),
  );
});

test(
  "INV-02: a disconnected opener cannot interrupt or duplicate server-owned acquisition",
  {
    timeout: 10000,
  },
  async () => {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        yield* registry.saveProject({ id: "abandoned", name: "Abandoned" });
        const registered = yield* Deferred.make<string>();
        yield* registry.onChange((_, after) => {
          const entry = after.sessions.find((s) => s.projectId === "abandoned");
          return entry ? Deferred.succeed(registered, entry.sessionId) : Effect.void;
        });
        const abandoned = yield* hosts
          .create({ cwd, projectId: "abandoned", options: {} })
          .pipe(Effect.forkChild);
        const id = yield* Deferred.await(registered);
        yield* waitAudit(id, (rs) => rs.some((r) => r.command === "get_state"));
        yield* Fiber.interrupt(abandoned);
        const entry = (yield* registry.get).sessions.find((s) => s.sessionId === id)!;
        assert.deepEqual(
          [entry.cwd, entry.projectId],
          [cwd, "abandoned"],
          "registration already includes membership while Pi is starting",
        );
        const returning = yield* hosts.open({ cwd: alias, sessionId: id }).pipe(Effect.forkChild);
        process.kill(records(id)[0].pid, "SIGCONT");
        const session = yield* Fiber.join(returning);
        assert.equal((yield* session.state).sessionId, id);
        assert.equal(records(id).filter((r) => r.event === "spawn").length, 1);
        assert.equal("projectId" in session.spec, false);
        assert.equal(
          (yield* registry.get).sessions.find((s) => s.sessionId === id)?.projectId,
          "abandoned",
        );
        yield* hosts.release(cwd, id);
      }),
      { holdReadiness: true, registry: "abandoned" },
    );
  },
);

test(
  "INV-02: release holds ownership through blocked shutdown; a late close cannot retire the replacement",
  {
    timeout: 10000,
  },
  async () => {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        const first = yield* registered("reopen");
        const release = yield* hosts.release(cwd, "reopen").pipe(Effect.forkChild);
        yield* waitAudit("reopen", (rs) => rs.some((r) => r.event === "stdin-end"));
        const reopening = yield* hosts
          .open({ cwd: alias, sessionId: "reopen" })
          .pipe(Effect.forkChild);
        const independent = yield* registered("independent");
        assert.equal(records("reopen").filter((r) => r.event === "spawn").length, 1);
        assert.equal(
          (yield* first.act({ _tag: "prompt", text: "must not send" }).pipe(Effect.result))._tag,
          "Failure",
        );
        process.kill(records("reopen")[0].pid, "SIGUSR2");
        yield* Fiber.join(release);
        const second = yield* Fiber.join(reopening);
        const log = records("reopen");
        assert.equal(log.filter((r) => r.event === "spawn").length, 2);
        assert.ok(
          log.findIndex((r) => r.event === "exit") < log.findLastIndex((r) => r.event === "spawn"),
        );
        yield* prompt(second, "/alive");
        assert.equal(records("reopen").filter((r) => r.text === "must not send").length, 0);
        process.kill(records("reopen").findLast((r) => r.event === "spawn")!.pid, "SIGUSR2");
        process.kill(records("independent")[0].pid, "SIGUSR2");
        yield* independent.events.pipe(
          Stream.takeUntil((e) => e._tag === "closed"),
          Stream.runDrain,
        );
      }),
      { holdShutdown: true },
    );
  },
);

test("INV-02/06: archive/delete retain the session on preview cleanup failure; explicit release retries", async () => {
  const stateRoot = join(root, "broken-preview-state");
  mkdirSync(stateRoot);
  const previous = process.env.PIANO_PREVIEW_STATE;
  process.env.PIANO_PREVIEW_STATE = stateRoot;
  const id = "preview-cleanup-failure";
  const intent = join(
    stateRoot,
    `piano-preview-${createHash("sha256").update(realpathSync(cwd)).digest("hex").slice(0, 24)}.json`,
  );
  try {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        const registry = yield* Registry;
        yield* registered(id);
        const endpoint = records(id).find((r) => r.event === "spawn")?.previewOwner;
        assert.ok(endpoint);
        writeFileSync(intent, "corrupt launch intent");
        yield* Effect.promise(() =>
          assert.rejects(
            ownerRequest(endpoint, {
              action: "start",
              command: [process.execPath, "-e", "process.exit(1)"],
            }),
          ),
        );
        for (const operation of ["archive", "delete"] as const) {
          const error = yield* hosts[operation](cwd, id).pipe(Effect.flip);
          assert.match(error.detail, /Preview cleanup failed/);
          const reference = (yield* registry.get).sessions.find((s) => s.sessionId === id);
          assert.ok(reference && !reference.archived, "failed cleanup does not change retention");
          assert.equal(records(id).filter((r) => r.event === "exit").length, 0);
        }
        rmSync(intent);
        yield* hosts.release(cwd, id);
        assert.equal(yield* hosts.get(cwd, id), undefined);
        assert.ok((yield* registry.get).sessions.some((s) => s.sessionId === id));
      }),
    );
  } finally {
    if (previous === undefined) delete process.env.PIANO_PREVIEW_STATE;
    else process.env.PIANO_PREVIEW_STATE = previous;
  }
});

for (const operation of ["archive", "delete"] as const)
  test(
    `INV-01/02: ${operation} owns shutdown and retention; racing reopen cannot resurrect work`,
    {
      timeout: 10000,
    },
    async () => {
      await run(
        Effect.gen(function* () {
          const hosts = yield* SessionHosts;
          const s = yield* registered(operation);
          yield* prompt(s, "/hold");
          const file = (yield* s.state).sessionFile!;
          const retirement = yield* hosts[operation](cwd, operation).pipe(Effect.forkChild);
          yield* waitAudit(operation, (rs) => rs.some((r) => r.event === "stdin-end"));
          const reopening = yield* hosts
            .open({ cwd: alias, sessionId: operation })
            .pipe(Effect.result, Effect.forkChild);
          process.kill(records(operation)[0].pid, "SIGUSR2");
          yield* Fiber.join(retirement);
          const result = yield* Fiber.join(reopening);
          assert.equal(result._tag, "Failure");
          if (result._tag === "Failure")
            assert.match(
              result.failure.detail,
              operation === "archive" ? /archived/ : /no longer registered/,
            );
          assert.equal(records(operation).filter((r) => r.event === "spawn").length, 1);
          assert.equal(existsSync(file), operation === "archive");
          const entries = (yield* (yield* Registry).get).sessions.filter(
            (s) => s.sessionId === operation,
          );
          assert.equal(entries.length, operation === "archive" ? 1 : 0);
          if (entries.length) assert.equal(entries[0].archived, true);
        }),
        { holdShutdown: true },
      );
    },
  );

test("PIN-152: bulk archive keeps live and pinned sessions, includes closed/missing checkouts, and unarchive starts nothing", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const missing = join(root, "bulk-missing");
      yield* registry.addFolder(cwd);
      for (const id of ["bulk-idle", "bulk-working", "bulk-pinned", "bulk-saved"])
        yield* registry.addSession(alias, id, id);
      yield* registry.addSession(missing, "bulk-missing");
      yield* registry.pinSession(alias, "bulk-pinned", true);
      const idle = yield* hosts.open({ cwd, sessionId: "bulk-idle" });
      const working = yield* hosts.open({ cwd, sessionId: "bulk-working" });
      yield* prompt(working, "/hold");
      const file = seed(alias, "bulk-saved", "saved history");
      const history = readFileSync(file, "utf8");
      yield* registry.removeFolder(cwd);
      assert.equal(yield* hosts.archiveCount, 2);
      assert.equal(yield* hosts.archiveAll, 2);
      assert.deepEqual(
        (yield* registry.get).sessions.filter((s) => s.archived).map((s) => s.sessionId),
        ["bulk-saved", "bulk-missing"],
      );
      assert.equal(yield* hosts.get(cwd, "bulk-idle"), idle);
      assert.equal(yield* hosts.get(cwd, "bulk-working"), working);
      assert.equal((yield* working.state).isQuiescent, false);
      assert.equal(
        records("bulk-idle").some((r) => r.event === "exit"),
        false,
      );
      assert.equal(
        records("bulk-working").some((r) => r.event === "exit"),
        false,
      );
      assert.equal(yield* hosts.unarchive(cwd, "bulk-saved"), true);
      assert.equal(records("bulk-saved").length, 0, "restoration starts no child");
      assert.equal(readFileSync(file, "utf8"), history);
      assert.deepEqual((yield* registry.get).folders, []);
      const read = yield* hosts.read(cwd, "bulk-saved");
      assert.equal(read._tag, "saved");
      assert.equal(records("bulk-saved").length, 0);
      const restored = yield* hosts.open({ cwd, sessionId: "bulk-saved" });
      assert.equal(restored.spec.cwd, alias);
      assert.equal(records("bulk-saved").filter((r) => r.event === "spawn").length, 1);
    }),
    { registry: "bulk" },
  );
});

test(
  "PIN-152: bulk archive skips starting Pi and a held canonical ownership lock through an alias",
  { timeout: 15000 },
  async () => {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        yield* registry.addSession(alias, "bulk-starting");
        yield* registry.addSession(cwd, "bulk-other");
        const opening = yield* hosts
          .open({ cwd, sessionId: "bulk-starting" })
          .pipe(Effect.forkChild);
        yield* waitAudit("bulk-starting", (rs) => rs.some((r) => r.command === "get_state"));
        assert.equal(
          (yield* hosts.list).length,
          0,
          "the ownership lock protects startup before the host broadcast",
        );
        assert.equal(yield* hosts.archiveCount, 1);
        assert.equal(yield* hosts.archiveAll, 1);
        assert.equal(
          (yield* registry.get).sessions.find((s) => s.sessionId === "bulk-starting")?.archived,
          false,
        );
        process.kill(records("bulk-starting")[0].pid, "SIGCONT");
        const opened = yield* Fiber.join(opening);
        assert.equal(opened.spec.cwd, alias);
        assert.equal(yield* hosts.archiveAll, 0);
        const registered = yield* Deferred.make<string>();
        yield* registry.onChange((_, after) => {
          const fresh = after.sessions.find(
            (s) => s.sessionId !== "bulk-starting" && s.sessionId !== "bulk-other",
          );
          return fresh ? Deferred.succeed(registered, fresh.sessionId) : Effect.void;
        });
        const creating = yield* hosts.create({ cwd, options: {} }).pipe(Effect.forkChild);
        const id = yield* Deferred.await(registered);
        yield* waitAudit(id, (rs) => rs.some((r) => r.command === "get_state"));
        assert.ok((yield* hosts.list).some((h) => h.sessionId === id && h.starting));
        assert.equal(yield* hosts.archiveAll, 0, "a fresh starting session is kept too");
        process.kill(records(id)[0].pid, "SIGCONT");
        yield* Fiber.join(creating);
      }),
      { holdReadiness: true, registry: "bulk-starting" },
    );
  },
);

test("INV-01/02: alias history opens under its registry owner; a conflict refuses to start", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const file = seed(alias, "legacy", "alias history");
      yield* registry.addSession(alias, "legacy");
      const s = yield* hosts.open({ cwd, sessionId: "legacy" });
      assert.equal(s.spec.cwd, alias);
      assert.equal((yield* s.state).sessionFile, file);
      yield* hosts.release(cwd, "legacy");
      yield* registry.addSession(cwd, "legacy");
      assert.match(
        (yield* hosts.open({ cwd, sessionId: "legacy" }).pipe(Effect.flip)).detail,
        /Conflicting session references/,
      );
      assert.equal(records("legacy").filter((r) => r.event === "spawn").length, 1);
      yield* registry.archiveSession(alias, "legacy");
      assert.match(
        (yield* Effect.flip(hosts.unarchive(cwd, "legacy"))).detail,
        /Conflicting session references/,
      );
    }),
  );
});

test("INV-01/02: Archive all skips a session whose saved references conflict through an alias", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.addSession(alias, "bulk-conflict");
      yield* registry.addSession(cwd, "bulk-conflict");
      yield* registry.addSession(cwd, "bulk-plain");
      assert.equal(yield* hosts.archiveCount, 1);
      assert.equal(yield* hosts.archiveAll, 1);
      const sessions = (yield* registry.get).sessions;
      assert.deepEqual(
        sessions.filter((s) => s.sessionId === "bulk-conflict").map((s) => [s.cwd, s.archived]),
        [
          [alias, false],
          [cwd, false],
        ],
        "neither conflicting reference is archived",
      );
      assert.equal(sessions.find((s) => s.sessionId === "bulk-plain")?.archived, true);
      assert.equal(yield* hosts.archiveCount, 0);
    }),
    { registry: "bulk-conflict" },
  );
});

test(
  "INV-02/03/04: idle deadline respects queue, retry, compaction, dialogs and older uncertain commands",
  {
    timeout: 15000,
  },
  async () => {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        for (const mode of ["queue", "retry", "compact", "dialog", "uncertain"]) {
          const id = `idle-${mode}`;
          const s = yield* registered(id);
          if (mode === "uncertain") {
            const received = yield* observe(
              s,
              (e) => e._tag === "notice" && e.message.includes("without acknowledgement"),
            );
            const pending = yield* s
              .act({ _tag: "prompt", text: "/uncertain" })
              .pipe(Effect.result, Effect.forkChild);
            yield* Fiber.join(received);
            yield* TestClock.adjust(1000);
            yield* Fiber.join(pending);
            yield* prompt(s, "/newer-handled");
          } else yield* prompt(s, `/${mode}`);
          yield* TestClock.adjust(2000);
          assert.equal(yield* hosts.get(alias, id), s, `${mode} cannot be retired`);
          assert.equal(records(id).filter((r) => r.event === "exit").length, 0);
          yield* hosts.release(cwd, id);
        }
        const s = yield* registered("actually-idle");
        yield* prompt(s, "/settle");
        yield* quiescent(s);
        yield* TestClock.adjust(2000);
        yield* waitAudit("actually-idle", (rs) => rs.some((r) => r.event === "exit"));
        assert.equal(yield* hosts.get(cwd, "actually-idle"), undefined);
      }),
      { idleMs: 1000, clock: true, timeoutMs: 1000 },
    );
  },
);

test("the hosts list calls a session working while it holds queued work Pi is not running yet", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const s = yield* registered("listed-queue");
      const working = Effect.map(
        hosts.list,
        (list) => list.find((h) => h.sessionId === "listed-queue")?.working,
      );
      yield* prompt(s, "/queue");
      assert.equal((yield* s.state).isStreaming, false);
      assert.equal(yield* working, true);
      yield* prompt(s, "/settle");
      yield* quiescent(s);
      assert.equal(yield* working, false);
      yield* hosts.release(cwd, "listed-queue");
    }),
  );
});

test("the browser hears a session's working state change when only its queue changes", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const s = yield* registered("pushed-queue");
      yield* quiescent(s);
      let seen = false;
      const pushed = yield* (yield* hosts.subscribe).pipe(
        Stream.drop(1),
        Stream.map((list) => list.find((h) => h.sessionId === "pushed-queue")?.working),
        Stream.takeUntil((working) => {
          seen ||= working === true;
          return seen && working === false;
        }),
        Stream.runCollect,
        Effect.timeoutOption("3 seconds"),
        Effect.forkChild,
      );
      yield* prompt(s, "/queue");
      yield* s.act({ _tag: "restore_queue" });
      const working = Option.getOrUndefined(yield* Fiber.join(pushed));
      assert.equal(working?.at(-1), false, `pushed: ${JSON.stringify(working)}`);
      yield* hosts.release(cwd, "pushed-queue");
    }),
  );
});

test(
  "INV-02: one host's failing idle check does not keep the next idle host from release",
  {
    timeout: 15000,
  },
  async () => {
    class UnknownPreview extends PreviewAdapter {
      override async request(): Promise<never> {
        throw new Error("no supervisor in this test");
      }
      override async retire(_: PreviewOwnerIdentity, __: string, idle = false) {
        if (idle) throw new Error("preview state unreadable");
        return true;
      }
    }
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        const failing = yield* registered("idle-check-fails");
        const endpoint = records("idle-check-fails").find((r) => r.event === "spawn")?.previewOwner;
        assert.ok(endpoint);
        yield* Effect.promise(() =>
          assert.rejects(
            ownerRequest(endpoint, {
              action: "start",
              command: [process.execPath, "-e", "process.exit(1)"],
            }),
          ),
        );
        yield* hosts.archiveAll;
        assert.equal(
          records("idle-check-fails").some((r) => r.event === "exit"),
          false,
          "bulk cannot retire an app-owning Pi, even when the supervisor is unreadable",
        );
        assert.equal(
          (yield* (yield* Registry).get).sessions.find((s) => s.sessionId === "idle-check-fails")
            ?.archived,
          false,
        );
        const other = yield* registered("idle-after-failure");
        for (const s of [failing, other]) {
          yield* prompt(s, "/settle");
          yield* quiescent(s);
        }
        yield* TestClock.adjust(2000);
        yield* waitAudit("idle-after-failure", (rs) => rs.some((r) => r.event === "exit"));
        assert.equal(yield* hosts.get(cwd, "idle-after-failure"), undefined);
        assert.equal(yield* hosts.get(cwd, "idle-check-fails"), failing, "unknown is not idle");
        assert.equal(records("idle-check-fails").filter((r) => r.event === "exit").length, 0);
      }),
      {
        idleMs: 100,
        clock: true,
        timeoutMs: 1000,
        previewAdapter: new UnknownPreview(),
        registry: "app-owner-bulk",
      },
    );
  },
);

test(
  "INV-02/03: idle release waits for in-flight input; a retired host rejects input",
  {
    timeout: 15000,
  },
  async () => {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        const held = yield* registered("busy-held");
        const received = yield* observe(
          held,
          (e) => e._tag === "notice" && e.message.includes("without acknowledgement"),
        );
        const pending = yield* held
          .act({ _tag: "prompt", text: "/uncertain" })
          .pipe(Effect.forkChild);
        yield* Fiber.join(received);
        yield* TestClock.adjust(500);
        assert.equal(yield* hosts.get(cwd, "busy-held"), held, "in-flight input is not idle");
        yield* hosts.release(cwd, "busy-held");
        yield* Fiber.await(pending);
        const s = yield* registered("busy-settled");
        yield* prompt(s, "/final");
        yield* quiescent(s);
        yield* TestClock.adjust(2000);
        yield* waitAudit("busy-settled", (rs) => rs.some((r) => r.event === "exit"));
        assert.equal(yield* hosts.get(cwd, "busy-settled"), undefined);
        assert.match(
          (yield* s.act({ _tag: "prompt", text: "after retirement" }).pipe(Effect.flip)).detail,
          /closing|stopped/,
        );
        assert.equal(
          records("busy-settled").filter((r) => r.text === "after retirement").length,
          0,
        );
      }),
      { idleMs: 100, clock: true, timeoutMs: 1000 },
    );
  },
);

test(
  "INV-02/03: hung readbacks time out visibly without blocking a later dialog or exit; crash history never resumes work",
  {
    timeout: 15000,
  },
  async () => {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        const s = yield* registered("hung-inspection");
        const initialStateReads = records("hung-inspection").filter(
          (r) => r.command === "get_state",
        ).length;
        const silenced = yield* observe(
          s,
          (e) => e._tag === "notice" && e.message === "barrier /silence",
        );
        const command = yield* s.act({ _tag: "prompt", text: "/silence" }).pipe(Effect.forkChild);
        yield* Fiber.join(silenced);
        const dialog = yield* observe(s, (e) => e._tag === "dialog");
        const next = yield* s.act({ _tag: "prompt", text: "/events" }).pipe(Effect.forkChild);
        const events = yield* Fiber.join(dialog);
        assert.ok(
          events.some(
            (e) => e._tag === "message_end" && e.message.text.includes("behind hung readback"),
          ),
        );
        yield* waitAudit(
          "hung-inspection",
          (rs) =>
            rs.filter((r) => r.command === "get_state").length >= initialStateReads + 2 &&
            rs.filter((r) => r.command === "get_session_stats").length >= 2,
        );
        yield* TestClock.adjust(1000);
        yield* waitAudit(
          "hung-inspection",
          (rs) => rs.filter((r) => r.command === "get_state").length >= initialStateReads + 4,
        );
        yield* TestClock.adjust(1000);
        yield* Fiber.join(command);
        yield* Fiber.join(next);
        assert.match((yield* s.state).stateRefreshError ?? "", /get_state.*1000ms/);
        assert.match((yield* s.state).statsRefreshError ?? "", /get_session_stats.*1000ms/);
        const closed = yield* observe(s, (e) => e._tag === "closed");
        process.kill(records("hung-inspection")[0].pid, "SIGUSR1");
        yield* Fiber.join(closed);
        const view = yield* saved(hosts, cwd, "hung-inspection");
        const closure = view.snapshot.state.closure;
        assert.equal(
          closure?._tag === "exited" && closure.code,
          7,
          "a crash is reported as an exit, not a release",
        );
        assert.ok(view.snapshot.messages.some((m) => m.text.includes("behind hung readback")));
        const reopened = yield* hosts.open({ cwd, sessionId: "hung-inspection" });
        assert.equal((yield* reopened.state).isStreaming, false);
        assert.equal(
          records("hung-inspection").filter((r) => r.command === "prompt").length,
          2,
          "reopen never replays a prompt",
        );
      }),
      { clock: true, timeoutMs: 1000 },
    );
  },
);

const unavailableProject = "Project is unavailable. Choose a current project before starting.";

test("INV-01: creating with a deleted or unknown project registers no folder, reference or child", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "old", name: "Old" });
      yield* registry.deleteProject("old");
      for (const projectId of ["old", "missing", ""]) {
        const error = yield* hosts.create({ cwd, projectId, options: {} }).pipe(Effect.flip);
        assert.ok(error instanceof SessionNotCreated);
        assert.equal(error.detail, unavailableProject);
      }
      const data = yield* registry.get;
      assert.deepEqual([data.sessions.length, data.folders.length], [0, 0]);
      assert.deepEqual(yield* hosts.list, []);
    }),
    { fakePi: "create-refused" },
  );
});

test("INV-01/02: a project deleted after preflight refuses registration before Pi starts", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      yield* registry.onChange((before, after) =>
        after.folders.length > before.folders.length
          ? registry.deleteProject("launch").pipe(Effect.orDie)
          : Effect.void,
      );
      const error = yield* hosts
        .create({ cwd, projectId: "launch", options: {} })
        .pipe(Effect.flip);
      assert.ok(error instanceof SessionNotCreated, "nothing was registered, so nothing started");
      assert.equal(error.detail, unavailableProject);
      assert.equal(error.checkoutUnconfirmed, false);
      const data = yield* registry.get;
      assert.deepEqual(data.folders, [cwd], "the race happened after the folder was registered");
      assert.deepEqual(data.sessions, [], "no rejected reference is inserted");
      assert.deepEqual(yield* hosts.list, [], "no rejected child is started");
    }),
    { fakePi: "create-raced" },
  );
});

test("dispatch reads saved membership without opening the parent and refuses ambiguous identity", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const missing = join(root, "unavailable-parent-checkout");
      yield* registry.saveProject({
        id: "parent-project",
        name: "Parent project",
        instructions: "Answer in French.",
      });
      yield* registry.addSession(missing, "saved-parent", undefined, "parent-project");
      const child = yield* hosts.create({ cwd, options: { dispatchedFrom: "saved-parent" } });
      assert.equal(
        (yield* registry.get).sessions.find((s) => s.sessionId === child.spec.sessionId)?.projectId,
        "parent-project",
      );
      assert.deepEqual(
        records(child.spec.sessionId)
          .filter((r) => r.event === "spawn")
          .map((r) => r.instructions),
        ["Answer in French."],
      );
      assert.deepEqual(
        records("saved-parent"),
        [],
        "inheritance never opens the unavailable parent",
      );

      yield* registry.addSession(cwd, "saved-parent");
      const before = yield* registry.get;
      const failure = yield* hosts
        .create({ cwd, options: { dispatchedFrom: "saved-parent" } })
        .pipe(Effect.flip);
      assert.ok(failure instanceof SessionNotCreated);
      assert.match(failure.detail, /parent session is unlisted or ambiguous/);
      assert.deepEqual(
        yield* registry.get,
        before,
        "ambiguous identity has no registration effects",
      );
      const loose = yield* hosts.create({
        cwd,
        inheritProject: false,
        options: { dispatchedFrom: "saved-parent" },
      });
      assert.equal(
        (yield* registry.get).sessions.find((s) => s.sessionId === loose.spec.sessionId)?.projectId,
        undefined,
      );
    }),
    { registry: "dispatch-saved-membership" },
  );
});

test("a member session's Pi gets its project's instructions at each launch; other sessions get none", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const launches = (id: string) =>
        records(id)
          .filter((r) => r.event === "spawn")
          .map((r) => r.instructions ?? null);
      yield* registry.saveProject({ id: "guided", name: "Guided" });
      yield* registry.updateProject("guided", { instructions: "Answer in French." });
      const member = (yield* hosts.create({ cwd, projectId: "guided", options: {} })).spec
        .sessionId;
      const loose = (yield* hosts.create({ cwd, options: {} })).spec.sessionId;
      assert.deepEqual(launches(member), ["Answer in French."]);
      assert.deepEqual(launches(loose), [null]);

      yield* registry.updateProject("guided", { instructions: "Answer in German." });
      assert.deepEqual(launches(member), ["Answer in French."], "a running Pi is not restarted");
      yield* hosts.release(cwd, member);
      yield* hosts.open({ cwd, sessionId: member });
      assert.deepEqual(launches(member), ["Answer in French.", "Answer in German."]);

      yield* registry.assignProject(cwd, member, null);
      yield* hosts.release(cwd, member);
      yield* hosts.open({ cwd, sessionId: member });
      assert.equal(launches(member).at(-1), null, "a session that left the project gets none");
    }),
    { registry: "guided" },
  );
});

test("a Piano started inside a project member's session passes its parent's instructions to no Pi", async () => {
  process.env.PIANO_PROJECT_INSTRUCTIONS = "Inherited from the parent session.";
  try {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        const launches = (id: string) =>
          records(id)
            .filter((r) => r.event === "spawn")
            .map((r) => r.instructions ?? null);
        yield* registry.saveProject({ id: "inheriting", name: "Inheriting" });
        yield* registry.updateProject("inheriting", { instructions: "Answer in Dutch." });
        const loose = (yield* hosts.create({ cwd, options: {} })).spec.sessionId;
        const member = (yield* hosts.create({ cwd, projectId: "inheriting", options: {} })).spec
          .sessionId;
        assert.deepEqual(launches(loose), [null]);
        assert.deepEqual(launches(member), ["Answer in Dutch."]);
      }),
    );
  } finally {
    delete process.env.PIANO_PROJECT_INSTRUCTIONS;
  }
});

test("INV-01: a prompt or steer records activity on every path to a running session; other input does not", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const session = yield* hosts.create({ cwd, projectId: "launch", options: {} });
      const id = session.spec.sessionId;
      const entry = (yield* registry.get).sessions.find((s) => s.sessionId === id)!;
      assert.deepEqual([entry.cwd, entry.projectId], [cwd, "launch"]);
      assert.equal("projectId" in session.spec, false, "membership is not part of Pi's spec");
      const bumps: string[] = [];
      yield* registry.onChange((before, after) =>
        Effect.sync(() => {
          for (const s of after.sessions)
            if (
              before.sessions.some(
                (b) => b.sessionId === s.sessionId && b.updatedAt !== s.updatedAt,
              )
            )
              bumps.push(s.sessionId);
        }),
      );
      const tick = Effect.sleep("2 millis");
      yield* tick;
      yield* session.act({ _tag: "prompt", text: "  First prompt  " });
      yield* tick;
      yield* (yield* hosts.get(cwd, id))!.act({ _tag: "steer", text: "Steer" });
      assert.deepEqual(bumps, [id, id], "each records activity");
      yield* tick;
      yield* session.act({ _tag: "set_thinking_level", level: "low" });
      yield* hosts.commands(cwd, id);
      assert.equal(bumps.length, 2, "other input and queries are not activity");
    }),
    { fakePi: "activity" },
  );
});

test("INV-01/02: input refused because its Pi is closing records no activity", async () => {
  let entered!: () => void, finish!: () => void;
  const cleaning = new Promise<void>((resolve) => (entered = resolve));
  const cleaned = new Promise<void>((resolve) => (finish = resolve));
  class HeldCleanup extends PreviewAdapter {
    override async request(): Promise<never> {
      throw new Error("no supervisor in this test");
    }
    override async retire() {
      entered();
      await cleaned;
      return true;
    }
  }
  const id = "refused-activity";
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const session = yield* registered(id);
      const endpoint = records(id).find((r) => r.event === "spawn")?.previewOwner;
      assert.ok(endpoint);
      yield* Effect.promise(() =>
        assert.rejects(
          ownerRequest(endpoint, {
            action: "start",
            command: [process.execPath, "-e", "process.exit(1)"],
          }),
        ),
      );
      const bumps: string[] = [];
      yield* registry.onChange((before, after) =>
        Effect.sync(() => {
          for (const s of after.sessions)
            if (
              s.sessionId === id &&
              before.sessions.some(
                (b) => b.sessionId === s.sessionId && b.updatedAt !== s.updatedAt,
              )
            )
              bumps.push(s.sessionId);
        }),
      );
      yield* Effect.sleep("2 millis");
      yield* prompt(session, "accepted");
      assert.equal(bumps.length, 1, "accepted input records activity");
      const closing = yield* hosts.release(cwd, id).pipe(Effect.forkChild);
      yield* Effect.promise(() => cleaning);
      assert.equal(
        yield* hosts.archiveAll,
        0,
        "bulk never waits for or takes over preview cleanup's held ownership",
      );
      assert.equal((yield* registry.get).sessions[0]?.archived, false);
      yield* Effect.sleep("2 millis");
      const refused = yield* session
        .act({ _tag: "prompt", text: "while closing" })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Effect.sleep("100 millis");
      yield* Effect.sync(finish);
      yield* Fiber.join(closing);
      assert.match((yield* Fiber.join(refused)).detail, /closing or has stopped/);
      assert.equal(bumps.length, 1, "refused input records no activity");
      assert.equal(records(id).filter((r) => r.text === "while closing").length, 0);
    }).pipe(Effect.ensuring(Effect.sync(finish))),
    { previewAdapter: new HeldCleanup(), registry: id },
  );
});

test("INV-02: a session's slash commands come from its running child; a stopped one is refused, not started", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* hosts.create({ cwd, options: {} })).spec.sessionId;
      const names = (yield* hosts.commands(cwd, id)).map((c) => c.name);
      assert.ok(names.includes("live-only") && !names.includes("probe-only"), names.join());
      yield* hosts.release(cwd, id);
      const refused = yield* hosts.commands(cwd, id).pipe(Effect.flip);
      assert.deepEqual(
        [refused._tag, refused.detail],
        ["SessionCommandsError", "Session is no longer running. Reopen the suggestions."],
      );
      assert.deepEqual(yield* hosts.list, [], "no child was started to answer");
    }),
    { fakePi: "commands" },
  );
});

test("INV-01: renaming goes through Pi, even for a stopped session, and the registry mirrors Pi's name as written", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const name = "Rotate token: abc12345";
      const id = (yield* hosts.create({ cwd, options: {} })).spec.sessionId;
      yield* hosts.release(cwd, id);
      assert.equal(yield* hosts.rename(cwd, id, name), name);
      const running = (yield* hosts.get(cwd, id))!;
      assert.equal((yield* running.state).sessionName, name, "Pi recorded the name");
      assert.equal((yield* registry.get).sessions.find((s) => s.sessionId === id)?.title, name);
    }),
    { fakePi: "rename" },
  );
});

test("INV-01/06: a new session in a linked worktree is listed under its main checkout's folder, never as a folder of its own", async () => {
  const git = (dir: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const repo = join(root, "repo"),
    linked = join(root, "linked"),
    repoAlias = join(root, "repo-alias"),
    linkedAlias = join(root, "linked-alias"),
    bare = join(root, "bare.git"),
    bareLinked = join(root, "bare-linked");
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
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  symlinkSync(repo, repoAlias);
  symlinkSync(linked, linkedAlias);
  mkdirSync(join(linked, "nested"));
  git(root, "clone", "--quiet", "--bare", repo, bare);
  git(bare, "worktree", "add", "--quiet", bareLinked, "main");
  const physical = (path: string) => realpathSync(path);
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const session = yield* hosts.create({ cwd: linkedAlias, options: {} });
      assert.equal(session.spec.cwd, physical(linked));
      let data = yield* registry.get;
      assert.deepEqual(data.folders, [physical(repo)]);
      assert.deepEqual(data.worktrees, [
        { folder: physical(repo), path: physical(linked), branch: "feature" },
      ]);
      for (const cwd of [join(linked, "nested"), bareLinked])
        yield* hosts.create({ cwd, options: {} });
      data = yield* registry.get;
      assert.deepEqual(data.folders, [physical(repo), join(linked, "nested"), bareLinked]);
      assert.equal(data.worktrees.length, 1);
    }),
    { fakePi: "place-worktree" },
  );
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.addFolder(repoAlias);
      yield* hosts.create({ cwd: linked, options: {} });
      const data = yield* registry.get;
      assert.deepEqual(data.folders, [repoAlias]);
      assert.deepEqual(data.worktrees, [
        { folder: repoAlias, path: physical(linked), branch: "feature" },
      ]);
    }),
    { fakePi: "place-alias" },
  );
});

test("INV-01: a closed folder's registered worktree reopens its folder, under its own spelling or another", async () => {
  const git = (dir: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const base = realpathSync(root),
    repo = join(base, "closed-repo"),
    linked = join(base, "closed-linked"),
    linkedAlias = join(base, "closed-linked-alias");
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
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  symlinkSync(linked, linkedAlias);
  for (const [name, spelling] of [
    ["closed-own", linked],
    ["closed-alias", linkedAlias],
  ] as const)
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        yield* hosts.create({ cwd: linked, options: {} });
        yield* registry.removeFolder(repo);
        const session = yield* hosts.create({ cwd: spelling, options: {} });
        assert.equal(session.spec.cwd, linked, `${spelling} starts in the registered worktree`);
        const data = yield* registry.get;
        assert.deepEqual(data.folders, [repo], `${spelling} reopens the worktree's folder`);
        assert.deepEqual(data.worktrees, [{ folder: repo, path: linked, branch: "feature" }]);
      }),
      { fakePi: name },
    );
});

test("INV-01: a new session in an open folder that is also a closed folder's worktree reopens nothing", async () => {
  const base = realpathSync(root),
    owner = join(base, "dual-owner"),
    dual = join(base, "dual-open"),
    dualAlias = join(base, "dual-open-alias");
  mkdirSync(owner);
  mkdirSync(dual);
  symlinkSync(dual, dualAlias);
  for (const [name, spelling] of [
    ["dual-own", dual],
    ["dual-alias", dualAlias],
  ] as const)
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        yield* registry.addFolder(dual);
        yield* registry.addFolder(owner);
        yield* registry.addWorktree({ folder: owner, path: dual, branch: "feature" });
        yield* registry.removeFolder(owner);
        const session = yield* hosts.create({ cwd: spelling, options: {} });
        assert.equal(session.spec.cwd, dual, `${spelling} starts in the open folder`);
        assert.deepEqual((yield* registry.get).folders, [dual], "the closed folder stays closed");
      }),
      { fakePi: name },
    );
});

test("INV-01: a new session in a main checkout reached by another spelling starts in its registered folder", async () => {
  const repo = join(root, "aliased-repo"),
    repoAlias = join(root, "aliased-repo-alias");
  mkdirSync(repo);
  assert.equal(spawnSync("git", ["init", "--quiet", repo]).status, 0);
  symlinkSync(repo, repoAlias);
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* hosts.create({ cwd: repoAlias, options: {} });
      const session = yield* hosts.create({ cwd: repo, options: {} });
      assert.equal(session.spec.cwd, repoAlias, "the session's cwd is the registered spelling");
      assert.deepEqual((yield* registry.get).folders, [repoAlias], "the folder is not duplicated");
    }),
    { fakePi: "place-main-alias" },
  );
});

test("INV-01: a closed folder reached by another spelling reopens under its registered spelling", async () => {
  const git = (dir: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const base = realpathSync(root),
    repo = join(base, "closed-aliased-repo"),
    repoAlias = join(base, "closed-aliased-repo-alias"),
    linked = join(base, "closed-aliased-linked");
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
  git(repo, "worktree", "add", "--quiet", "-b", "feature", linked);
  symlinkSync(repo, repoAlias);
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* hosts.create({ cwd: repoAlias, options: {} });
      yield* registry.removeFolder(repoAlias);
      const session = yield* hosts.create({ cwd: repo, options: {} });
      assert.equal(session.spec.cwd, repoAlias, "the session starts under the registered spelling");
      assert.deepEqual(
        (yield* registry.get).folders,
        [repoAlias],
        "the folder is reopened, not duplicated",
      );
    }),
    { fakePi: "closed-main-alias" },
  );
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* hosts.create({ cwd: repoAlias, options: {} });
      yield* registry.removeFolder(repoAlias);
      yield* hosts.create({ cwd: linked, options: {} });
      const data = yield* registry.get;
      assert.deepEqual(data.folders, [repoAlias]);
      assert.deepEqual(data.worktrees, [{ folder: repoAlias, path: linked, branch: "feature" }]);
    }),
    { fakePi: "closed-linked-alias" },
  );
});

test(
  "INV-02/06: a requester that leaves while Worktrunk runs cannot interrupt creation into a half-made checkout",
  {
    timeout: 30_000,
  },
  async () => {
    const git = (dir: string, ...args: string[]) => {
      const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const repo = join(root, "slow-repo");
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
    const config = join(root, "wt-config", "worktrunk");
    mkdirSync(config, { recursive: true });
    writeFileSync(join(config, "config.toml"), "");
    const isolated = {
      HOME: join(root, "wt-home"),
      XDG_CONFIG_HOME: join(root, "wt-config"),
      XDG_CACHE_HOME: join(root, "wt-cache"),
      XDG_STATE_HOME: join(root, "wt-state"),
      WORKTRUNK_CONFIG_PATH: join(config, "config.toml"),
    };
    mkdirSync(isolated.HOME);
    const real = spawnSync("which", ["wt"], { encoding: "utf8" }).stdout.trim();
    const started = join(root, "wt-started");
    const wt = join(root, "slow-wt");
    writeFileSync(
      wt,
      `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';
const a=process.argv.slice(2);
if(a.includes('switch')){writeFileSync(${JSON.stringify(started)},'');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
const r=spawnSync(${JSON.stringify(real)},a,{stdio:'inherit',env:{...process.env,...${JSON.stringify(isolated)}}});process.exit(r.status??1);\n`,
      { mode: 0o755 },
    );
    const until = <A>(read: Effect.Effect<A | undefined>, what: string) =>
      Effect.gen(function* () {
        for (let n = 0; n < 500; n++) {
          const value = yield* read;
          if (value !== undefined) return value;
          yield* Effect.sleep("20 millis");
        }
        return yield* Effect.die(new Error(`never observed: ${what}`));
      });
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts,
          registry = yield* Registry;
        const requester = yield* hosts
          .create({ cwd: repo, options: {}, worktree: { branch: "slow" } })
          .pipe(Effect.forkChild);
        yield* until(
          Effect.sync(() => (existsSync(started) ? true : undefined)),
          "Worktrunk running",
        );
        yield* Fiber.interrupt(requester);
        const entry = yield* until(
          Effect.map(registry.get, (data) => data.sessions.find((s) => s.cwd !== repo)),
          "a session registered in the new worktree",
        );
        assert.ok(git(repo, "worktree", "list", "--porcelain").includes(`worktree ${entry.cwd}\n`));
        assert.equal(git(entry.cwd, "branch", "--show-current"), "slow");
        assert.deepEqual((yield* registry.get).worktrees, [
          { folder: realpathSync(repo), path: entry.cwd, branch: "slow", baseBranch: "main" },
        ]);
        yield* until(
          Effect.map(hosts.list, (list) =>
            list.some((h) => h.sessionId === entry.sessionId) ? true : undefined,
          ),
          "the session's child running",
        );
        yield* hosts.release(entry.cwd, entry.sessionId);
      }).pipe(Effect.provideService(WorktrunkCommand, wt)),
      { fakePi: "slow-worktree" },
    );
  },
);
