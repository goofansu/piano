import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { PiCli } from "../server/PiCli.ts";
import { PiRequestTimeoutMs, type PiSession, PiSessionsLive } from "../server/PiSessions.ts";
import {
  Registry,
  RegistryDatabasePath,
  RegistryLive,
  RegistryLookupError,
} from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
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
type Record = { event: string; pid: number; sessionId: string; command?: string; text?: string };
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
        // Poll: on a loaded machine fs.watch can drop the event for the append that matters.
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
    holdStats?: boolean;
    statsFile?: string;
    clock?: boolean;
    timeoutMs?: number;
    /** The general fake Pi, which keeps names and messages, with a fresh registry of this name. */
    fakePi?: string;
  } = {},
) => {
  const layer = SessionHostsLive({ idleMs: options.idleMs ?? 0 }).pipe(
    Layer.provide(PiSessionsLive),
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
            extraArgs: [
              ...cli.extraArgs,
              ...(options.holdShutdown ? ["--hold-shutdown"] : []),
              ...(options.holdReadiness ? ["--hold-readiness"] : []),
              ...(options.holdStats ? ["--hold-stats"] : []),
              ...(options.statsFile ? ["--stats-file", options.statsFile] : []),
            ],
          },
    ),
    Effect.provideService(PiRequestTimeoutMs, options.timeoutMs ?? 30000),
    Effect.provideService(RegistryDatabasePath, join(root, `${options.fakePi ?? "registry"}.db`)),
  );
  return Effect.runPromise(options.clock ? work.pipe(Effect.provide(TestClock.layer())) : work);
};
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
/** A registered session, running. */
const registered = (sessionId: string) =>
  Effect.gen(function* () {
    yield* (yield* Registry).addSession(cwd, sessionId);
    return yield* (yield* SessionHosts).open({ cwd, sessionId });
  });
/** Assert stopped readbacks through the same boundary selection uses. */
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

test("INV-01/03: last-known statistics survive host and registry restart without copying history", {
  timeout: 15000,
}, async () => {
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
      assert.equal(entry.stats?.cost, 1.23, "persist while running, not only on graceful release");
      assert.equal(entry.updatedAt, entry.createdAt, "statistics do not reorder session activity");
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
  // A new layer rereads the registry from disk, not the previous host's memory.
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
});

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
      // SessionReferences' tests own how a removed checkout's history is found and read.
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
        rmSync(removed === "checkout" ? path : link, { recursive: true });
        assert.match(
          (yield* session.act({ _tag: "prompt", text: "must not send" }).pipe(Effect.flip)).detail,
          /checkout no longer exists/,
        );
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

test("INV-02: a disconnected opener cannot interrupt or duplicate server-owned acquisition", {
  timeout: 10000,
}, async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "abandoned", name: "Abandoned" });
      // Registration precedes Pi, so the fresh ID is learned from the registry write.
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
    { holdReadiness: true },
  );
});

test("INV-02: release holds ownership through blocked shutdown; a late close cannot retire the replacement", {
  timeout: 10000,
}, async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const first = yield* registered("reopen");
      const release = yield* hosts.release(cwd, "reopen").pipe(Effect.forkChild);
      yield* waitAudit("reopen", (rs) => rs.some((r) => r.event === "stdin-end"));
      const reopening = yield* hosts
        .open({ cwd: alias, sessionId: "reopen" })
        .pipe(Effect.forkChild);
      // Another checkout/session remains usable while this shutdown is blocked.
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
});

for (const operation of ["archive", "delete"] as const)
  test(`INV-01/02: ${operation} owns shutdown and retention; racing reopen cannot resurrect work`, {
    timeout: 10000,
  }, async () => {
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
  });

// SessionReferences' tests own which reference and file a session resolves to and what a
// conflict is; this one owns that Pi starts under the owner's spelling and a refusal starts none.
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
    }),
  );
});

test("INV-02/03/04: idle deadline respects queue, retry, compaction, dialogs and older uncertain commands", {
  timeout: 15000,
}, async () => {
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
          yield* prompt(s, "/newer-handled"); // must not erase uncertainty of the older command
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
});

test("INV-02/03: idle release and branch export agree on busy; a retired host rejects input", {
  timeout: 15000,
}, async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const busy = /Wait for this session to finish/;
      // An admitted action Pi has not answered keeps the session busy for both.
      const held = yield* registered("busy-held");
      const received = yield* observe(
        held,
        (e) => e._tag === "notice" && e.message.includes("without acknowledgement"),
      );
      const pending = yield* held
        .act({ _tag: "prompt", text: "/uncertain" })
        .pipe(Effect.forkChild);
      yield* Fiber.join(received);
      assert.match((yield* hosts.exportBranch(cwd, "busy-held").pipe(Effect.flip)).detail, busy);
      yield* TestClock.adjust(500); // past the idle deadline, before the command times out
      assert.equal(yield* hosts.get(cwd, "busy-held"), held, "in-flight input is not idle");
      yield* hosts.release(cwd, "busy-held");
      yield* Fiber.await(pending); // release interrupts the admitted action
      // Settled with no action in flight: both see it as not busy.
      const s = yield* registered("busy-settled");
      yield* prompt(s, "/final");
      yield* quiescent(s);
      assert.match(yield* hosts.exportBranch(cwd, "busy-settled"), /Final busy-settled/);
      yield* TestClock.adjust(2000);
      yield* waitAudit("busy-settled", (rs) => rs.some((r) => r.event === "exit"));
      assert.equal(yield* hosts.get(cwd, "busy-settled"), undefined);
      assert.match(
        (yield* s.act({ _tag: "prompt", text: "after retirement" }).pipe(Effect.flip)).detail,
        /closing|stopped/,
      );
      assert.equal(records("busy-settled").filter((r) => r.text === "after retirement").length, 0);
    }),
    { idleMs: 100, clock: true, timeoutMs: 1000 },
  );
});

test("INV-02/03: hung readbacks time out visibly without blocking a later dialog or exit; crash history never resumes work", {
  timeout: 15000,
}, async () => {
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
      const events = yield* Fiber.join(dialog); // BEFORE advancing the withheld state/stats deadline
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
      // The handled command also reconciles context. Its fresh activity read must time out
      // independently; a previous state timeout is not evidence that this query has completed.
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
});

const unavailableProject =
  "Project is unavailable or archived. Choose a current project before starting.";

test("INV-01: creating with an archived or unknown project registers no folder, reference or child", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "old", name: "Old" });
      yield* registry.archiveProject("old", true);
      for (const projectId of ["old", "missing", ""]) {
        const error = yield* hosts.create({ cwd, projectId, options: {} }).pipe(Effect.flip);
        assert.ok(error instanceof RegistryLookupError);
        assert.equal(error.message, unavailableProject);
      }
      const data = yield* registry.get;
      assert.deepEqual([data.sessions.length, data.folders.length], [0, 0]);
      assert.deepEqual(yield* hosts.list, []);
    }),
    { fakePi: "create-refused" },
  );
});

test("INV-01/02: a project archived after preflight refuses registration before Pi starts", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      // Another tab archives the project once creation has passed its check and registered the folder.
      yield* registry.onChange((before, after) =>
        after.folders.length > before.folders.length
          ? registry.archiveProject("launch", true).pipe(Effect.orDie)
          : Effect.void,
      );
      const error = yield* hosts
        .create({ cwd, projectId: "launch", options: {} })
        .pipe(Effect.flip);
      assert.equal(error.detail, unavailableProject);
      const data = yield* registry.get;
      assert.deepEqual(data.folders, [cwd], "the race happened after the folder was registered");
      assert.deepEqual(data.sessions, [], "no rejected reference is inserted");
      assert.deepEqual(yield* hosts.list, [], "no rejected child is started");
    }),
    { fakePi: "create-raced" },
  );
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
      // Activity times have millisecond resolution; keep each step on its own tick so every bump is a change.
      const tick = Effect.sleep("2 millis");
      yield* tick;
      yield* session.act({ _tag: "prompt", text: "  First prompt  " });
      yield* tick;
      // Another caller, such as the HTTP router, reaches the same running session through `get`.
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

test("INV-02: a session's slash commands come from its running child; a stopped one is refused, not started", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* hosts.create({ cwd, options: {} })).spec.sessionId;
      // The fake Pi lists `live-only` in a session and `probe-only` when started without one.
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

test("INV-01: renaming goes through Pi, even for a stopped session, and the registry mirrors Pi's name", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const id = (yield* hosts.create({ cwd, options: {} })).spec.sessionId;
      yield* hosts.release(cwd, id);
      assert.equal(yield* hosts.rename(cwd, id, "Release notes"), "Release notes");
      const running = (yield* hosts.get(cwd, id))!;
      assert.equal((yield* running.state).sessionName, "Release notes", "Pi recorded the name");
      assert.equal(
        (yield* registry.get).sessions.find((s) => s.sessionId === id)?.title,
        "Release notes",
      );
    }),
    { fakePi: "rename" },
  );
});
