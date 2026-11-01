import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Queue, type Scope, Stream } from "effect";
import { PreviewAdapter } from "../scripts/PreviewAdapter.ts";
import { ownerRequest } from "../scripts/PreviewClient.ts";
import { makeClientSessions } from "../server/ClientSessions.ts";
import { PiCli } from "../server/PiCli.ts";
import { type PiSession, PiSessionsLive, PreviewOwnerOptions } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { WorktrunkCommand } from "../server/Worktrees.ts";
import type { ServerMessage } from "../shared/wire.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-client-sessions-")));
const cwd = join(root, "checkout");
mkdirSync(cwd);
mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<A, E, SessionHosts | Registry | Scope.Scope>,
  path = join(root, `registry-${++databases}.db`),
  pi: { readonly cli: string; readonly extraArgs: ReadonlyArray<string> } = {
    cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
    extraArgs: [],
  },
) => {
  const layer = SessionHostsLive({ idleMs: 0 }).pipe(
    Layer.provide(PiSessionsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provide(NodeServices.layer),
  );
  return Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(PiCli, { node: process.execPath, ...pi }),
      Effect.provideService(RegistryDatabasePath, path),
      Effect.timeout("10 seconds"),
    ),
  );
};

/** A client whose messages are recorded in order and can be awaited. */
const client = Effect.gen(function* () {
  const sent: ServerMessage[] = [];
  const queue = yield* Queue.unbounded<ServerMessage>();
  const sessions = yield* makeClientSessions({
    send: (m) =>
      Effect.sync(() => sent.push(m)).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
    overflow: (e) => Effect.die(e),
  });
  const next = (pred: (m: ServerMessage) => boolean) =>
    Effect.gen(function* () {
      for (;;) {
        const m = yield* Queue.take(queue);
        if (pred(m)) return m;
      }
    });
  return { sessions, sent, next };
});
const started = (id?: string) =>
  Effect.gen(function* () {
    const sessionId = id ?? crypto.randomUUID();
    yield* (yield* Registry).addSession(cwd, sessionId);
    return yield* (yield* SessionHosts).open({ cwd, sessionId });
  });
/** An action whose result (an empty restored queue) reaches only its requester. */
const restoreQueue = { _tag: "restore_queue" } as const;
const resultFor = (sent: ServerMessage[]) =>
  sent
    .filter((m) => m._tag === "action_result")
    .map((m) => m._tag === "action_result" && m.sessionId);

test("INV-01/02: selecting saved history spends one discovery read budget without starting Pi", async (t) => {
  const store = mkdtempSync(join(root, "selection-history-"));
  const id = "saved-selection";
  let discoveryBytes = 0;
  for (const sessionId of [id, ...Array.from({ length: 8 }, (_, i) => `neighbor-${i}`)]) {
    const contents =
      [
        {
          type: "session",
          version: 3,
          id: sessionId,
          cwd,
          timestamp: "2026-10-05T00:00:00Z",
          // Small files fit within a header read; their combined size defines a one-pass budget.
          padding: "x".repeat(2048),
        },
        {
          type: "message",
          id: "saved",
          parentId: null,
          timestamp: "2026-10-05T00:00:01Z",
          message: { role: "user", content: "Saved conversation", timestamp: 1 },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n";
    writeFileSync(join(store, `${sessionId}.jsonl`), contents);
    discoveryBytes += Buffer.byteLength(contents);
  }
  // Observe real filesystem bytes at the selection boundary, not calls between services.
  // Allow a little slack, but not a second directory discovery. Pi's saved-view read is sync.
  const read = fs.read;
  let bytes = 0;
  t.mock.method(fs, "read", (...args: unknown[]) => {
    const callback = args.pop() as (...result: unknown[]) => void;
    return Reflect.apply(read, fs, [
      ...args,
      (...result: unknown[]) => {
        bytes += Number(result[1] ?? 0);
        callback(...result);
      },
    ]);
  });
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = store;
  try {
    await run(
      Effect.gen(function* () {
        const hosts = yield* SessionHosts;
        yield* (yield* Registry).addSession(cwd, id);
        const { sessions, next } = yield* client;
        yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "saved" });
        const selected = yield* next((m) => m._tag === "selected");
        assert.ok(selected._tag === "selected" && !selected.hosted);
        assert.deepEqual(
          selected.snapshot.messages.map((m) => m.text),
          ["Saved conversation"],
        );
        assert.deepEqual(yield* hosts.list, [], "selection must not start Pi");
        t.diagnostic(
          `selection discovery read ${bytes} bytes; one-pass fixture ${discoveryBytes} bytes`,
        );
        assert.ok(
          bytes > 0 && bytes <= discoveryBytes + 1024,
          `selection discovery read ${bytes} bytes; budget ${discoveryBytes + 1024}`,
        );
      }),
    );
  } finally {
    process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  }
});

test("INV-05: a lookup that finishes after a reselect shows nothing and keeps the newer attachment", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const a = (yield* started()).spec.sessionId,
        b = yield* started();
      yield* hosts.release(cwd, a);
      const { sessions, sent, next } = yield* client;
      // Both selections are claimed in receive order; the older lookup finishes last.
      const showA = yield* sessions.select({ cwd, sessionId: a, selectionId: "A" });
      const showB = yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
      yield* showB;
      yield* showA;
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected");
      assert.deepEqual(
        [selected.selectionId, selected.sessionId, selected.hosted],
        ["B", b.spec.sessionId, true],
      );
      // B stays attached: its live frames still arrive.
      yield* b.act({ _tag: "prompt", text: "for B" });
      yield* next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.deepEqual(
        sent.filter((m) => "selectionId" in m && m.selectionId === "A"),
        [],
      );
    }),
  );
});

test("acting for a selection that was replaced is refused as stale and reaches no session", async () => {
  await run(
    Effect.gen(function* () {
      const a = yield* started(),
        b = yield* started();
      const { sessions, sent } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
      yield* sessions.act("A", restoreQueue);
      assert.deepEqual(resultFor(sent), [a.spec.sessionId]);
      yield* yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
      const error = yield* Effect.flip(sessions.act("A", restoreQueue, {}));
      assert.deepEqual(
        [error._tag, error._tag === "ActRefused" && error.reason],
        ["ActRefused", "stale"],
      );
      assert.deepEqual(
        resultFor(sent),
        [a.spec.sessionId],
        "the stale action reached neither session",
      );
      yield* sessions.act("B", restoreQueue);
      assert.deepEqual(resultFor(sent), [a.spec.sessionId, b.spec.sessionId]);
    }),
  );
});

test("INV-05: act reuses the selection claim, not a fresh request id", async () => {
  await run(
    Effect.gen(function* () {
      const { sessions, sent, next } = yield* client;
      const missing = yield* Effect.flip(sessions.act("fresh-act", restoreQueue, {}));
      assert.ok(missing._tag === "ActRefused" && missing.reason === "stale");

      const session = yield* started();
      yield* yield* sessions.select({
        cwd,
        sessionId: session.spec.sessionId,
        selectionId: "selected-claim",
      });
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected" && selected.hosted);
      const mismatch = yield* Effect.flip(sessions.act("fresh-act", restoreQueue, {}));
      assert.ok(mismatch._tag === "ActRefused" && mismatch.reason === "stale");
      assert.match(mismatch.detail, /selected\.selectionId="selected-claim"/);
      assert.match(mismatch.detail, /act\.selectionId="fresh-act"/);
      assert.match(
        mismatch.detail,
        /Reuse the selectionId from the current select or create_session/,
      );
      assert.deepEqual(resultFor(sent), [], "the mismatched action never reached Pi");

      yield* sessions.act(selected.selectionId, restoreQueue);
      assert.deepEqual(resultFor(sent), [session.spec.sessionId]);
      assert.match(missing.detail, /selected\.selectionId=null/);
      assert.match(missing.detail, /act\.selectionId="fresh-act"/);
    }),
  );
});

test("INV-01/02: acting on a new-session selection is refused; only create makes a session", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const { sessions, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: null, selectionId: "new" });
      yield* next((m) => m._tag === "selected");
      const error = yield* Effect.flip(sessions.act("new", { _tag: "prompt", text: "hello" }, {}));
      assert.ok(error._tag === "ActRefused");
      assert.equal(error.reason, "no_session");
      assert.match(error.detail, /Create a session/);
      assert.deepEqual(yield* hosts.list, [], "no Pi child was started");
      const data = yield* registry.get;
      assert.deepEqual(
        [data.sessions.length, data.folders.length],
        [0, 0],
        "no reference or folder was written",
      );
    }),
  );
});

test("INV-02/05: starting from a stopped selection attaches before the first prompt, which is observed", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* started()).spec.sessionId;
      yield* hosts.release(cwd, id);
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "S" });
      const peeked = yield* next((m) => m._tag === "selected");
      assert.ok(
        peeked._tag === "selected" && !peeked.hosted,
        "a stopped session is shown read-only",
      );
      const unstarted = yield* Effect.flip(sessions.act("S", { _tag: "prompt", text: "first" }));
      assert.ok(unstarted._tag === "ActRefused" && unstarted.reason === "not_running");
      for (const action of [
        { _tag: "preview_status" as const },
        { _tag: "preview_stop" as const, instanceId: "old-instance" },
      ]) {
        const refused = yield* sessions.act("S", action, { model: "fake/beta" }).pipe(Effect.flip);
        assert.ok(refused._tag === "ActRefused" && refused.reason === "not_running");
        assert.deepEqual(
          yield* hosts.list,
          [],
          "preview actions cannot start Pi, even with start options",
        );
      }
      yield* sessions.act("S", { _tag: "prompt", text: "first" }, {});
      assert.ok(
        sent.some((m) => m._tag === "selected" && m.selectionId === "S" && m.hosted),
        "the snapshot is delivered before act returns",
      );
      const seen = yield* next(
        (m) =>
          m._tag === "session" && m.event._tag === "message_end" && m.event.message.role === "user",
      );
      assert.ok(seen._tag === "session" && seen.selectionId === "S");
      yield* sessions.act("S", restoreQueue, {});
      assert.deepEqual(resultFor(sent), [id]);
      assert.equal(
        (yield* hosts.list).filter((h) => h.sessionId === id).length,
        1,
        "one child, no second start",
      );
    }),
  );
});

test("INV-02/05: a reattached session applies offline draft choices before its next input", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* started();
      const { sessions, next } = yield* client;
      yield* yield* sessions.select({
        cwd,
        sessionId: session.spec.sessionId,
        selectionId: "back",
      });
      yield* sessions.act(
        "back",
        { _tag: "prompt", text: "offline draft" },
        {
          model: "fake/beta",
          thinkingLevel: "high",
        },
      );
      const reply = yield* next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.ok(reply._tag === "session" && reply.event._tag === "message_end");
      assert.equal(reply.event.message.model, "fake/beta");
      assert.equal((yield* session.state).thinkingLevel, "high");
    }),
  );
});

test("INV-02: a pick reaches a session another client started after this one showed it stopped", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* started()).spec.sessionId;
      yield* hosts.release(cwd, id);
      const { sessions, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "B" });
      // Another tab starts the session; this one still shows the saved snapshot.
      yield* hosts.open({ cwd, sessionId: id });
      yield* sessions.act(
        "B",
        { _tag: "prompt", text: "with my pick" },
        { model: "fake/beta", thinkingLevel: "high" },
      );
      const reply = yield* next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.ok(reply._tag === "session" && reply.event._tag === "message_end");
      assert.equal(reply.event.message.model, "fake/beta");
      assert.equal((yield* (yield* hosts.get(cwd, id))!.state).thinkingLevel, "high");
    }),
  );
});

/** The turns one selection's view holds: its last live snapshot, then the frames after it. */
const liveTurns = (sent: ServerMessage[], selectionId: string) => {
  const mine = sent.filter((m) => "selectionId" in m && m.selectionId === selectionId);
  const from = mine.findLastIndex((m) => m._tag === "selected" && m.hosted);
  const snapshot = mine[from];
  if (snapshot?._tag !== "selected") return [];
  return [
    ...snapshot.snapshot.messages.map((m) => m.role),
    ...mine
      .slice(from + 1)
      .flatMap((m) =>
        m._tag === "session" && m.event._tag === "message_end" ? [m.event.message.role] : [],
      ),
  ];
};

test("INV-02/05: a session shown stopped follows another client's resume and shows its turn once", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* started()).spec.sessionId;
      yield* hosts.release(cwd, id);
      const a = yield* client,
        b = yield* client;
      yield* yield* a.sessions.select({ cwd, sessionId: id, selectionId: "A" });
      yield* yield* b.sessions.select({ cwd, sessionId: id, selectionId: "B" });
      for (const { next } of [a, b]) {
        const shown = yield* next((m) => m._tag === "selected");
        assert.ok(shown._tag === "selected" && !shown.hosted);
      }
      assert.deepEqual(yield* hosts.list, [], "watching a stopped session starts no Pi");

      yield* b.sessions.act("B", { _tag: "prompt", text: "from B" }, {});
      // A neither selects nor acts again.
      yield* a.next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      yield* b.next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.deepEqual(liveTurns(a.sent, "A"), ["user", "assistant"], "A shows the turn once");
      assert.deepEqual(liveTurns(b.sent, "B"), ["user", "assistant"]);
      const generation = (sent: ServerMessage[]) => {
        const m = sent.findLast((m) => m._tag === "selected" && m.hosted);
        return m?._tag === "selected" ? m.cursor?.generation : undefined;
      };
      assert.equal(generation(a.sent), generation(b.sent), "A attached to B's Pi");
      assert.equal((yield* hosts.list).length, 1, "B's Pi stays the only one");
    }),
  );
});

test("INV-05: a session resumed elsewhere after this client selected another shows nothing here", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const first = (yield* started()).spec.sessionId,
        second = (yield* started()).spec.sessionId;
      yield* hosts.release(cwd, first);
      yield* hosts.release(cwd, second);
      const a = yield* client,
        b = yield* client;
      yield* yield* a.sessions.select({ cwd, sessionId: first, selectionId: "first" });
      yield* a.next((m) => m._tag === "selected");
      yield* yield* b.sessions.select({ cwd, sessionId: first, selectionId: "B" });
      // A claims the second session; its lookup has not run when B resumes the first.
      const showSecond = yield* a.sessions.select({
        cwd,
        sessionId: second,
        selectionId: "second",
      });
      yield* b.sessions.act("B", { _tag: "prompt", text: "from B" }, {});
      yield* b.next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      yield* showSecond;
      const shown = yield* a.next((m) => m._tag === "selected");
      assert.ok(shown._tag === "selected");
      assert.deepEqual([shown.selectionId, shown.sessionId], ["second", second]);
      assert.deepEqual(
        a.sent.filter((m) => "selectionId" in m && m.selectionId === "first").map((m) => m._tag),
        ["selected"],
        "nothing from the first session reaches A after its read-only view",
      );

      // The newer selection still follows its own resume.
      yield* yield* b.sessions.select({ cwd, sessionId: second, selectionId: "B2" });
      yield* b.sessions.act("B2", { _tag: "prompt", text: "second from B" }, {});
      yield* a.next(
        (m) =>
          m._tag === "session" &&
          m.selectionId === "second" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "assistant",
      );
      assert.deepEqual(liveTurns(a.sent, "second"), ["user", "assistant"]);
    }),
  );
});

test("a saved session's view follows its checkout going and coming back", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const path = join(root, "recheck");
      const away = join(root, "recheck-away");
      mkdirSync(path);
      const sessionId = crypto.randomUUID();
      yield* (yield* Registry).addSession(path, sessionId);
      yield* hosts.open({ cwd: path, sessionId });
      yield* hosts.release(path, sessionId);
      renameSync(path, away);
      const { sessions, sent, next } = yield* client;
      const shown = (selected: ServerMessage) =>
        selected._tag === "selected" && selected.sessionId === sessionId && !selected.hosted
          ? selected.snapshot.state.checkoutMissing
          : undefined;
      const view = () =>
        Effect.map(
          next((m) => shown(m) !== undefined),
          shown,
        );
      yield* yield* sessions.select({ cwd: path, sessionId, selectionId: "A" });
      assert.equal(yield* view(), true);

      yield* sessions.recheck;
      const before = sent.length;
      yield* sessions.recheck;
      assert.equal(sent.length, before, "an unchanged checkout sends nothing");

      renameSync(away, path);
      yield* sessions.recheck;
      assert.equal(yield* view(), false, "a restored checkout shows the session again");

      renameSync(path, away);
      yield* sessions.recheck;
      assert.equal(yield* view(), true, "a removed checkout shows it missing");
      renameSync(away, path);
    }),
  );
});

test("a live session's view follows its checkout going and coming back", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const path = join(root, "recheck-live");
      const away = join(root, "recheck-live-away");
      mkdirSync(path);
      const sessionId = crypto.randomUUID();
      yield* (yield* Registry).addSession(path, sessionId);
      yield* hosts.open({ cwd: path, sessionId });
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd: path, sessionId, selectionId: "A" });
      const attached = yield* next((m) => m._tag === "selected");
      assert.ok(attached._tag === "selected" && attached.hosted, "the running session is live");
      // Each recheck completes its show before returning, so the last view is already sent.
      const lastView = () => {
        const m = sent.findLast((m) => m._tag === "selected" && m.sessionId === sessionId);
        return m?._tag === "selected"
          ? { hosted: m.hosted, checkoutMissing: !!m.snapshot.state.checkoutMissing }
          : undefined;
      };

      renameSync(path, away);
      yield* sessions.recheck;
      assert.deepEqual(
        lastView(),
        { hosted: false, checkoutMissing: true },
        "a removed checkout stops the live view and shows it missing",
      );

      renameSync(away, path);
      yield* sessions.recheck;
      assert.deepEqual(
        lastView(),
        { hosted: false, checkoutMissing: false },
        "a restored checkout shows the session again",
      );
    }),
  );
});

test("a new-session selection shows what it creates only while it is still selected", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      const { sessions, sent, next } = yield* client;
      const createOld = yield* sessions.create({ selectionId: "old", cwd, options: {} });
      const createNew = yield* sessions.create({ selectionId: "new", cwd, options: {} });
      yield* createOld;
      yield* createNew;
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected" && selected.sessionId);
      assert.equal(selected.selectionId, "new");
      assert.deepEqual(
        sent.filter((m) => "selectionId" in m && m.selectionId === "old"),
        [],
      );
      const references = (yield* registry.get).sessions.map((s) => s.sessionId);
      assert.equal(
        references.length,
        2,
        "the stale session was still created and registered; it is only not shown",
      );
      assert.equal((yield* hosts.list).length, 2);
      // The shown session is the new selection's own.
      yield* sessions.act("new", restoreQueue);
      assert.deepEqual(resultFor(sent), [selected.sessionId]);
    }),
  );
});

test("INV-05: selecting another session while a worktree is still being created shows it at once", {
  timeout: 30_000,
}, async () => {
  const git = (dir: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const repo = join(root, "creating-repo");
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
  // The installed Worktrunk, isolated from the user's configuration, held at `switch` until the
  // test releases it (or 20 seconds pass, so a failing run cannot leave it waiting).
  const config = join(root, "creating-wt", "config", "worktrunk");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.toml"), "");
  const isolated = {
    HOME: join(root, "creating-wt", "home"),
    XDG_CONFIG_HOME: join(root, "creating-wt", "config"),
    XDG_CACHE_HOME: join(root, "creating-wt", "cache"),
    XDG_STATE_HOME: join(root, "creating-wt", "state"),
    WORKTRUNK_CONFIG_PATH: join(config, "config.toml"),
  };
  mkdirSync(isolated.HOME);
  const real = spawnSync("which", ["wt"], { encoding: "utf8" }).stdout.trim();
  const waiting = join(root, "creating-wt", "waiting");
  const release = join(root, "creating-wt", "release");
  const wt = join(root, "creating-wt", "wt");
  writeFileSync(
    wt,
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';
const a=process.argv.slice(2);
if(a.includes('switch')){writeFileSync(${JSON.stringify(waiting)},'');for(let n=0;n<1000&&!existsSync(${JSON.stringify(release)});n++)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
const r=spawnSync(${JSON.stringify(real)},a,{stdio:'inherit',env:{...process.env,...${JSON.stringify(isolated)}}});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  await run(
    Effect.gen(function* () {
      const b = yield* started();
      const { sessions, sent, next } = yield* client;
      const creating = yield* (yield* sessions.create({
        selectionId: "creating",
        cwd: repo,
        options: {},
        worktree: { branch: "held" },
      })).pipe(Effect.forkChild);
      for (let n = 0; !existsSync(waiting); n++) {
        if (n > 250) return yield* Effect.die(new Error("Worktrunk never started"));
        yield* Effect.sleep("20 millis");
      }
      yield* yield* sessions.select({ cwd, sessionId: b.spec.sessionId, selectionId: "B" });
      const selected = yield* next((m) => m._tag === "selected");
      assert.ok(selected._tag === "selected");
      assert.deepEqual([selected.selectionId, selected.sessionId], ["B", b.spec.sessionId]);
      assert.equal(existsSync(release), false, "B was shown while Worktrunk was still held");
      writeFileSync(release, "");
      yield* Fiber.join(creating);
      // The finished creation is registered but not shown, and B stays the attached selection.
      assert.ok((yield* (yield* Registry).get).sessions.some((s) => s.cwd !== cwd));
      assert.deepEqual(
        sent.filter((m) => "selectionId" in m && m.selectionId === "creating"),
        [],
      );
      yield* sessions.act("B", restoreQueue);
      assert.deepEqual(resultFor(sent), [b.spec.sessionId]);
    }).pipe(
      Effect.ensuring(Effect.sync(() => writeFileSync(release, ""))),
      Effect.provideService(WorktrunkCommand, wt),
    ),
  );
});

/**
 * Pi from the lifecycle fixture, holding `held`'s readiness until `release`, so a start of that
 * session is observably in flight.
 */
const holdingStart = (held: string) => {
  const dir = mkdtempSync(join(root, "holding-start-"));
  const audit = join(dir, "audit.jsonl");
  writeFileSync(audit, "");
  const records = () =>
    readFileSync(audit, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as { event: string; sessionId: string; pid: number; command?: string },
      )
      .filter((r) => r.sessionId === held);
  const pid = () => records().find((r) => r.event === "spawn")?.pid;
  /** The commands `held`'s Pi received, in order. */
  const commands = () => records().flatMap((r) => (r.event === "command" ? [r.command] : []));
  const launched = Effect.gen(function* () {
    for (let n = 0; !pid(); n++) {
      if (n > 250) return yield* Effect.die(new Error(`${held} never launched`));
      yield* Effect.sleep("20 millis");
    }
  });
  const release = Effect.sync(() => {
    const p = pid();
    if (p) process.kill(p, "SIGCONT");
  });
  const pi = {
    cli: new URL("./fake-host-pi.mjs", import.meta.url).pathname,
    extraArgs: ["--audit", audit, "--hold-session", held],
  };
  return { launched, release, pi, commands };
};

test("INV-05: selecting another session while an act is still starting the selected one shows it at once", async () => {
  const held = holdingStart("A");
  await run(
    Effect.gen(function* () {
      yield* (yield* Registry).addSession(cwd, "A");
      const b = yield* started();
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: "A", selectionId: "a" });
      yield* next((m) => m._tag === "selected");
      const acting = yield* sessions.act("a", restoreQueue, {}).pipe(Effect.forkChild);
      yield* held.launched;
      const selecting = yield* (yield* sessions.select({
        cwd,
        sessionId: b.spec.sessionId,
        selectionId: "b",
      })).pipe(Effect.forkChild);
      const selected = yield* next((m) => m._tag === "selected").pipe(
        Effect.timeoutOption("2 seconds"),
      );
      assert.ok(
        selected._tag === "Some" && selected.value._tag === "selected",
        "B was shown while A's start was still held",
      );
      assert.deepEqual(
        [selected.value.selectionId, selected.value.sessionId, selected.value.hosted],
        ["b", b.spec.sessionId, true],
      );
      yield* held.release;
      yield* Fiber.join(selecting);
      yield* Fiber.join(acting);
      // The act was accepted while A was selected, so it completes and its result reaches its
      // requester; A is started but not shown over the newer selection.
      assert.deepEqual(resultFor(sent), ["A"]);
      assert.deepEqual(
        sent.filter((m) => "selectionId" in m && m.selectionId === "a").map((m) => m._tag),
        ["selected"],
        "nothing from A reaches this client after its first, read-only view",
      );
      yield* sessions.act("b", restoreQueue);
      assert.deepEqual(resultFor(sent), ["A", b.spec.sessionId]);
    }).pipe(Effect.ensuring(held.release)),
    undefined,
    held.pi,
  );
});

test("INV-02/05: acts that start a still-selected session attach it once and both get their results", async () => {
  const held = holdingStart("A");
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      yield* (yield* Registry).addSession(cwd, "A");
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: "A", selectionId: "a" });
      yield* next((m) => m._tag === "selected");
      const first = yield* sessions.act("a", restoreQueue, {}).pipe(Effect.forkChild);
      yield* held.launched;
      const second = yield* sessions
        .act("a", restoreQueue, { thinkingLevel: "high" })
        .pipe(Effect.forkChild);
      yield* held.release;
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.deepEqual(resultFor(sent), ["A", "A"]);
      assert.deepEqual(
        sent
          .filter((m) => m._tag === "selected" && m.selectionId === "a")
          .map((m) => m._tag === "selected" && m.hosted),
        [false, true],
        "the started session is shown once, live",
      );
      assert.equal((yield* hosts.list).filter((h) => h.sessionId === "A").length, 1);
      assert.ok(
        held.commands().includes("set_thinking_level"),
        "the act that did not launch Pi still applies its draft choices",
      );
    }).pipe(Effect.ensuring(held.release)),
    undefined,
    held.pi,
  );
});

test("INV-02/05: input with start options that arrives while the attached Pi closes reaches a relaunched Pi", async () => {
  const dir = mkdtempSync(join(root, "closing-relaunch-"));
  const audit = join(dir, "audit.jsonl");
  writeFileSync(audit, "");
  const records = () =>
    readFileSync(audit, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as { event: string; pid: number; text?: string; previewOwner?: string },
      );
  const spawns = () => records().filter((r) => r.event === "spawn");
  // Holds the close in its first step, preview cleanup, while the session's lock is held, the
  // host is not yet closing and this client is still attached to it.
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
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* started()).spec.sessionId;
      const [first] = spawns();
      // A preview start makes this owner ask its adapter before release.
      yield* Effect.promise(() =>
        assert.rejects(
          ownerRequest(first.previewOwner!, { action: "start", command: ["/bin/false"] }),
        ),
      );
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "S" });
      const shown = yield* next((m) => m._tag === "selected");
      assert.ok(shown._tag === "selected" && shown.hosted, "the live session is attached");
      // Another tab, or the idle sweep, stops Pi.
      const closing = yield* hosts.release(cwd, id).pipe(Effect.forkChild);
      yield* Effect.promise(() => cleaning);
      const acting = yield* sessions
        .act("S", { _tag: "prompt", text: "after close" }, {})
        .pipe(Effect.result, Effect.forkChild);
      yield* Effect.sync(finish);
      yield* Fiber.join(closing);
      const result = yield* Fiber.join(acting);
      assert.equal(
        result._tag,
        "Success",
        result._tag === "Failure" ? `refused: ${result.failure.detail}` : "accepted",
      );
      const seen = yield* next(
        (m) =>
          m._tag === "session" &&
          m.event._tag === "notice" &&
          m.event.message === "barrier after close",
      );
      assert.ok(seen._tag === "session" && seen.selectionId === "S", "this client observes it");
      const relaunched = spawns()
        .map((r) => r.pid)
        .filter((pid) => pid !== first.pid);
      assert.equal(relaunched.length, 1, "one new Pi");
      assert.deepEqual(
        records()
          .filter((r) => r.event === "command" && r.text === "after close")
          .map((r) => r.pid),
        relaunched,
        "the prompt reached the new Pi, not the closing one",
      );
      assert.equal(
        sent.filter((m) => m._tag === "selected" && m.selectionId === "S" && m.hosted).length,
        2,
        "the new Pi is attached in place of the closed one",
      );
    }).pipe(
      Effect.ensuring(Effect.sync(finish)),
      Effect.provideService(PreviewOwnerOptions, {
        adapter: new HeldCleanup(),
        root: join(dir, "previews"),
      }),
    ),
    undefined,
    { cli: new URL("./fake-host-pi.mjs", import.meta.url).pathname, extraArgs: ["--audit", audit] },
  );
});

test("INV-02: retiring the selected session detaches before Pi stops, clears the selection and cannot be undone by acting", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const a = yield* started(),
        b = yield* started();
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: a.spec.sessionId, selectionId: "A" });
      yield* next((m) => m._tag === "selected");
      yield* sessions.retire(cwd, a.spec.sessionId, "archive");
      const cleared = yield* next((m) => m._tag === "selected");
      assert.ok(cleared._tag === "selected");
      assert.deepEqual(
        [cleared.selectionId, cleared.sessionId, cleared.hosted],
        ["A", null, false],
      );
      const error = yield* Effect.flip(sessions.act("A", { _tag: "prompt", text: "again" }, {}));
      assert.ok(
        error._tag === "ActRefused" && error.reason === "stale",
        "a retired session cannot be restarted from the old view",
      );
      assert.deepEqual(
        (yield* hosts.list).map((h) => h.sessionId),
        [b.spec.sessionId],
      );
      assert.deepEqual(
        sent.filter((m) => m._tag === "session"),
        [],
        "detached before Pi stopped",
      );
      yield* sessions.retire(cwd, b.spec.sessionId, "delete");
      assert.deepEqual(yield* hosts.list, []);
      assert.deepEqual(
        (yield* (yield* Registry).get).sessions.map((s) => [s.sessionId, s.archived]),
        [[a.spec.sessionId, true]],
        "archive keeps the reference; delete forgets it",
      );
      // A stale link cannot show a retired conversation, even when archive kept its history.
      const shown = sent.filter((m) => m._tag === "selected").length;
      for (const [sessionId, detail] of [
        [a.spec.sessionId, /archived/],
        [b.spec.sessionId, /no longer registered/],
      ] as const) {
        const show = yield* sessions.select({ cwd, sessionId, selectionId: "retired" });
        const result = yield* Effect.result(show);
        assert.ok(result._tag === "Failure", "a retired selection must be refused");
        assert.match(result.failure.detail, detail);
      }
      assert.equal(sent.filter((m) => m._tag === "selected").length, shown);
    }),
  );
});

test("INV-02: a refused archive leaves the selected session attached and controllable", async () => {
  class BrokenCleanup extends PreviewAdapter {
    override async request(): Promise<never> {
      throw new Error("no supervisor in this test");
    }
    override async retire(): Promise<boolean> {
      throw new Error("cleanup broke");
    }
  }
  const dir = mkdtempSync(join(root, "refused-archive-"));
  const audit = join(dir, "audit.jsonl");
  writeFileSync(audit, "");
  const owner = () =>
    readFileSync(audit, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; previewOwner?: string })
      .find((r) => r.event === "spawn")!.previewOwner!;
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const id = (yield* started()).spec.sessionId;
      // A preview start makes this owner ask its adapter, which fails, before release.
      yield* Effect.promise(() =>
        assert.rejects(ownerRequest(owner(), { action: "start", command: ["/bin/false"] })),
      );
      const { sessions, sent, next } = yield* client;
      yield* yield* sessions.select({ cwd, sessionId: id, selectionId: "S" });
      yield* next((m) => m._tag === "selected");
      const before = sent.length;
      const refused = yield* Effect.result(sessions.retire(cwd, id, "archive"));
      assert.equal(refused._tag, "Failure", "failed cleanup refuses the archive");
      assert.deepEqual(
        (yield* hosts.list).map((h) => h.sessionId),
        [id],
        "Pi still runs",
      );
      const shown = sent.slice(before).filter((m) => m._tag === "selected");
      assert.deepEqual(
        shown.map((m) => m._tag === "selected" && [m.selectionId, m.sessionId, m.hosted]),
        [["S", id, true]],
        "shown live again",
      );
      // An action that cannot start Pi reaches the running session.
      yield* sessions.act("S", { _tag: "restore_queue" });
      yield* next((m) => m._tag === "action_result");
    }).pipe(
      Effect.provideService(PreviewOwnerOptions, {
        adapter: new BrokenCleanup(),
        root: join(dir, "previews"),
      }),
    ),
    undefined,
    { cli: new URL("./fake-host-pi.mjs", import.meta.url).pathname, extraArgs: ["--audit", audit] },
  );
});

const firstSnapshot = (session: PiSession) =>
  session.events.pipe(
    Stream.filter((e) => e._tag === "snapshot"),
    Stream.take(1),
    Stream.runCollect,
    Effect.map((c) => {
      const e = [...c][0]!;
      assert.ok(e._tag === "snapshot");
      return e.snapshot;
    }),
  );
const prompted = (session: PiSession) =>
  firstSnapshot(session).pipe(Effect.map((s) => s.messages.some((m) => m.role === "user")));

test("INV-01/02: creating registers the folder, reference and project, attaches, then records the first prompt before Pi sees it", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const log: string[] = [];
      yield* registry.onChange((before, after) =>
        Effect.gen(function* () {
          for (const s of after.sessions) {
            const was = before.sessions.find((b) => b.sessionId === s.sessionId);
            if (!was)
              log.push(`registered project=${s.projectId} folder=${after.folders.includes(cwd)}`);
            else if (was.updatedAt !== s.updatedAt)
              log.push(
                `activity prompted=${yield* prompted((yield* hosts.get(s.cwd, s.sessionId))!)}`,
              );
          }
        }).pipe(Effect.orDie),
      );
      const queue = yield* Queue.unbounded<ServerMessage>();
      const sessions = yield* makeClientSessions({
        send: (m) =>
          Effect.sync(() => {
            if (m._tag === "selected" && m.sessionId) log.push("attached");
          }).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
        overflow: (e) => Effect.die(e),
      });
      yield* yield* sessions.create({
        selectionId: "new",
        cwd,
        projectId: "launch",
        options: {},
        text: "  hello  ",
      });
      assert.deepEqual(log, [
        "registered project=launch folder=true",
        "attached",
        "activity prompted=false",
      ]);
      // The trimmed prompt reaches Pi and this client observes it.
      for (;;) {
        const m = yield* Queue.take(queue);
        if (
          m._tag === "session" &&
          m.event._tag === "message_end" &&
          m.event.message.role === "user"
        ) {
          assert.equal(m.event.message.text, "hello");
          const session = (yield* hosts.get(m.cursor.cwd, m.cursor.sessionId))!;
          const submission = (yield* session.state).submission;
          assert.equal(submission?.inputId, "new", "creation proof belongs to its request");
          assert.ok(submission?.inputFingerprint);
          assert.equal(submission.inputFingerprint, m.event.message.inputFingerprint);
          break;
        }
      }
      const [entry] = (yield* registry.get).sessions;
      assert.equal(entry.cwd, cwd);
      assert.equal((yield* hosts.list).filter((h) => h.sessionId === entry.sessionId).length, 1);
    }),
  );
});

test("INV-01/02/07: an interrupted creation keeps its project membership and sends no prompt", async () => {
  const path = join(root, "interrupted-creation.db");
  const id = await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts,
        registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const published: Array<string | undefined> = [];
      yield* registry.onChange((before, after) =>
        Effect.sync(() => {
          for (const s of after.sessions)
            if (!before.sessions.some((b) => b.sessionId === s.sessionId))
              published.push(s.projectId);
        }),
      );
      // The browser has opened Pi but disconnects before its snapshot is delivered.
      const opened = yield* Deferred.make<string>();
      const sessions = yield* makeClientSessions({
        send: (m) =>
          m._tag === "selected" && m.sessionId
            ? Deferred.succeed(opened, m.sessionId).pipe(Effect.andThen(Effect.never))
            : Effect.void,
        overflow: (e) => Effect.die(e),
      });
      const creating = yield* (yield* sessions.create({
        selectionId: "new",
        cwd,
        projectId: "launch",
        options: {},
        text: "must not reach Pi",
      })).pipe(Effect.forkChild);
      const id = yield* Deferred.await(opened);
      yield* Fiber.interrupt(creating);
      const session = (yield* hosts.get(cwd, id))!;
      assert.ok(session, "the server-owned child survives its requester");
      assert.equal(yield* prompted(session), false, "no prompt without a completed attachment");
      assert.deepEqual(
        (yield* registry.get).sessions.map((s) => [s.cwd, s.sessionId, s.projectId]),
        [[cwd, id, "launch"]],
      );
      assert.deepEqual(published, ["launch"], "the first published reference has its project");
      return id;
    }),
    path,
  );
  const reopened = await Effect.runPromise(
    Effect.flatMap(Registry, (r) => r.get).pipe(
      Effect.provide(RegistryLive),
      Effect.provideService(RegistryDatabasePath, path),
    ),
  );
  assert.deepEqual(
    reopened.sessions.map((s) => [s.cwd, s.sessionId, s.projectId]),
    [[cwd, id, "launch"]],
    "membership survives reopening SQLite",
  );
});

test("PIN-132: a prompt its host refuses because another client archived the session names its input", async () => {
  await run(
    Effect.gen(function* () {
      const hosts = yield* SessionHosts;
      const live = yield* started();
      const { sessionId } = live.spec;
      // This client's start resolved the live host just before another client's archive took
      // the session's lock; the prompt then reaches a host that is closing.
      const { sessions } = yield* client.pipe(
        Effect.provideService(SessionHosts, {
          ...hosts,
          start: () => Effect.succeed({ session: live, launched: false }),
        }),
      );
      yield* yield* sessions.select({ cwd, sessionId, selectionId: "A" });
      yield* hosts.archive(cwd, sessionId);
      const prompt = { _tag: "prompt", text: "follow-up", inputId: "a-1" } as const;
      const refused = yield* Effect.flip(sessions.act("A", prompt, {}));
      assert.deepEqual(
        [refused._tag, refused._tag === "InputNotSent" && refused.inputId],
        ["InputNotSent", "a-1"],
      );
      // An action without input stays an ordinary failure.
      const plain = yield* Effect.flip(sessions.act("A", restoreQueue, {}));
      assert.equal(plain._tag, "PiSessionError");
    }),
  );
});
