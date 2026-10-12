import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { PiCli } from "../server/PiCli.ts";
import { PiRequestTimeoutMs, type PiSession, PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
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
        const watcher = watch(root, check);
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`audit deadline for ${id}`));
        }, 5000);
        function cleanup() {
          watcher.close();
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
  effect: Effect.Effect<A, E, SessionHosts | Registry>,
  options: {
    idleMs?: number;
    holdShutdown?: boolean;
    holdReadiness?: boolean;
    holdStats?: boolean;
    statsFile?: string;
    clock?: boolean;
    timeoutMs?: number;
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
    Effect.provideService(PiCli, {
      ...cli,
      extraArgs: [
        ...cli.extraArgs,
        ...(options.holdShutdown ? ["--hold-shutdown"] : []),
        ...(options.holdReadiness ? ["--hold-readiness"] : []),
        ...(options.holdStats ? ["--hold-stats"] : []),
        ...(options.statsFile ? ["--stats-file", options.statsFile] : []),
      ],
    }),
    Effect.provideService(PiRequestTimeoutMs, options.timeoutMs ?? 30000),
    Effect.provideService(RegistryDatabasePath, join(root, "registry.db")),
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
      const view = yield* hosts.peek(cwd, id);
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
      const unknown = (yield* hosts.peek(cwd, "uncached-stats")).snapshot.state;
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
      const stopped = (yield* hosts.peek(cwd, id)).snapshot.state;
      assert.equal(stopped.cost, 0);
      assert.equal(stopped.contextIsLastKnown, true);
    }),
    { statsFile, holdStats: true },
  );
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const cached = (yield* hosts.peek(cwd, id)).snapshot.state;
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
      assert.equal((yield* hosts.peek(cwd, id)).snapshot.state.context, undefined);
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
      assert.equal(yield* hosts.get(path, "missing-archive"), undefined);
      const view = yield* hosts.peek(path, "missing-archive");
      assert.equal(view.snapshot.messages[0].text, "preserved conversation");
      assert.equal(view.cwd, path);
      assert.equal(view.snapshot.state.checkoutMissing, true);
      assert.match(
        (yield* hosts.open({ cwd: path, sessionId: "missing-archive" }).pipe(Effect.flip)).detail,
        /checkout no longer exists/,
      );
      mkdirSync(path);
      assert.equal(
        (yield* hosts.peek(path, "missing-archive")).snapshot.state.checkoutMissing,
        false,
      );
      rmSync(path, { recursive: true });
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
        const view = yield* hosts.peek(path, id);
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
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const abandoned = yield* hosts
        .open({ cwd, sessionId: "abandoned-open", create: true, projectId: "launch" })
        .pipe(Effect.forkChild);
      yield* waitAudit("abandoned-open", (rs) => rs.some((r) => r.command === "get_state"));
      yield* Fiber.interrupt(abandoned);
      const entry = (yield* registry.get).sessions.find((s) => s.sessionId === "abandoned-open")!;
      assert.deepEqual(
        [entry.cwd, entry.projectId],
        [cwd, "launch"],
        "registration already includes membership while Pi is starting",
      );
      const returning = yield* hosts
        .open({ cwd: alias, sessionId: "abandoned-open", projectId: "ignored-on-reopen" })
        .pipe(Effect.forkChild);
      process.kill(records("abandoned-open")[0].pid, "SIGCONT");
      const session = yield* Fiber.join(returning);
      assert.equal((yield* session.state).sessionId, "abandoned-open");
      assert.equal(records("abandoned-open").filter((r) => r.event === "spawn").length, 1);
      assert.equal("projectId" in session.spec, false);
      assert.equal(
        (yield* registry.get).sessions.find((s) => s.sessionId === "abandoned-open")?.projectId,
        "launch",
      );
      yield* hosts.release(cwd, "abandoned-open");
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
      const first = yield* hosts.open({ cwd, sessionId: "reopen", create: true });
      const release = yield* hosts.release(cwd, "reopen").pipe(Effect.forkChild);
      yield* waitAudit("reopen", (rs) => rs.some((r) => r.event === "stdin-end"));
      const reopening = yield* hosts
        .open({ cwd: alias, sessionId: "reopen" })
        .pipe(Effect.forkChild);
      // Another checkout/session remains usable while this shutdown is blocked.
      const independent = yield* hosts.open({ cwd, sessionId: "independent", create: true });
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
        const s = yield* hosts.open({ cwd, sessionId: operation, create: true });
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

// PiHistory's tests own where alias history is found and what a conflict is; this one owns
// that the registry's reference keeps its spelling and that a conflict refuses before Pi starts.
test("INV-01/02: alias history opens under its registry owner; conflicting references or files refuse to start", async () => {
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
      const view = yield* hosts.peek(cwd, "legacy");
      assert.equal(view.cwd, alias);
      assert.equal(view.snapshot.messages[0].text, "alias history");
      assert.equal(
        (yield* registry.get).sessions.find((s) => s.sessionId === "legacy")?.cwd,
        alias,
      );
      seed(cwd, "legacy", "different history");
      assert.match(
        (yield* hosts.open({ cwd, sessionId: "legacy" }).pipe(Effect.flip)).detail,
        /Conflicting Pi files/,
      );
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
        const s = yield* hosts.open({ cwd, sessionId: id, create: true });
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
      const s = yield* hosts.open({ cwd, sessionId: "actually-idle", create: true });
      yield* prompt(s, "/settle");
      yield* quiescent(s);
      yield* TestClock.adjust(2000);
      yield* waitAudit("actually-idle", (rs) => rs.some((r) => r.event === "exit"));
      assert.equal(yield* hosts.get(cwd, "actually-idle"), undefined);
    }),
    { idleMs: 1000, clock: true, timeoutMs: 1000 },
  );
});

test("INV-02/03: hung readbacks time out visibly without blocking a later dialog or exit; crash history never resumes work", {
  timeout: 15000,
}, async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const s = yield* hosts.open({ cwd, sessionId: "hung-inspection", create: true });
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
          rs.filter((r) => r.command === "get_state").length >= 3 &&
          rs.filter((r) => r.command === "get_session_stats").length >= 2,
      );
      yield* TestClock.adjust(1000);
      yield* Fiber.join(command);
      yield* Fiber.join(next);
      assert.match((yield* s.state).stateRefreshError ?? "", /get_state.*1000ms/);
      assert.match((yield* s.state).statsRefreshError ?? "", /get_session_stats.*1000ms/);
      const closed = yield* observe(s, (e) => e._tag === "closed");
      process.kill(records("hung-inspection")[0].pid, "SIGUSR1");
      yield* Fiber.join(closed);
      const view = yield* hosts.peek(cwd, "hung-inspection");
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
