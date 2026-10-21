/**
 * Real locked CLI: a discovered extension's newSession, switchSession and fork must not replace a
 * hosted session behind its ID (INV-02, INV-07). With Piano's extension Pi cancels them; without
 * it, Piano closes the child rather than publish another session under this one's identity.
 */
import assert from "node:assert/strict";
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { PiCli, type PiCliConfig, sessionExtension } from "../server/PiCli.ts";
import { type PiSession, PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { createPiCompatibilityFixture } from "./fixtures/PiCompatibility.ts";

type Fixture = Awaited<ReturnType<typeof createPiCompatibilityFixture>>;

const saved = (fixture: Fixture, id: string, cwd: string, text: string) => {
  const file = join(fixture.sessionDir, `${id}.jsonl`);
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id, cwd, timestamp: "2026-10-21T00:00:00Z" },
      {
        type: "message",
        id: `${id}-saved`,
        parentId: null,
        timestamp: "2026-10-21T00:00:01Z",
        message: { role: "user", content: text, timestamp: 1 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  return file;
};

/** Two saved sessions in two checkouts, the replacement extension installed, run under hosts. */
const withHosts = async (
  cli: (fixture: Fixture) => PiCliConfig,
  body: (context: {
    fixture: Fixture;
    a: { cwd: string; file: string };
    b: { cwd: string; file: string };
  }) => Effect.Effect<void, unknown, SessionHosts | Registry | Scope.Scope>,
) => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel("disabled");
  copyFileSync(
    fileURLToPath(new URL("fixtures/SessionReplacementExtension.ts", import.meta.url)),
    join(fixture.agentDir, "extensions", "replacement.ts"),
  );
  const oldEnv = [process.env.PI_CODING_AGENT_DIR, process.env.PI_CODING_AGENT_SESSION_DIR];
  process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
  process.env.PI_CODING_AGENT_SESSION_DIR = fixture.sessionDir;
  const cwdA = fixture.project("checkout-a"),
    cwdB = fixture.project("checkout-b");
  const a = { cwd: cwdA, file: saved(fixture, "session-a", cwdA, "HISTORY_A") };
  const b = { cwd: cwdB, file: saved(fixture, "session-b", cwdB, "HISTORY_B") };
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* Registry;
        yield* registry.addSession(a.cwd, "session-a");
        yield* registry.addSession(b.cwd, "session-b");
        yield* body({ fixture, a, b });
      }).pipe(
        Effect.timeout("30 seconds"),
        Effect.scoped,
        Effect.provide(
          SessionHostsLive({ idleMs: 0 }).pipe(
            Layer.provide(PiSessionsLive),
            Layer.provideMerge(RegistryLive),
            Layer.provide(NodeServices.layer),
          ),
        ),
        Effect.provideService(RegistryDatabasePath, join(fixture.root, "registry.db")),
        Effect.provideService(PiCli, cli(fixture)),
      ),
    );
    assert.equal(fixture.observe().requests.length, 0, "no model request");
  } finally {
    for (const [i, key] of ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR"].entries()) {
      if (oldEnv[i] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[i];
    }
    await fixture.close();
  }
};

const prompt = (session: PiSession, text: string) => session.act({ _tag: "prompt", text });
const events = (fixture: Fixture, event: string) =>
  fixture.observe().pi.filter((record) => record.event === event);
const firstText = (session: PiSession) =>
  session.events.pipe(
    Stream.take(1),
    Stream.runHead,
    Effect.map((frame) =>
      frame._tag === "Some" && frame.value._tag === "snapshot"
        ? frame.value.snapshot.messages[0]?.text
        : undefined,
    ),
  );

test(
  "Piano's extension cancels an extension's session replacement in a hosted child",
  {
    timeout: 60_000,
  },
  () =>
    withHosts(
      (fixture) => ({ ...fixture.cli(), extensions: [sessionExtension] }),
      ({ fixture, a, b }) =>
        Effect.gen(function* () {
          const hosts = yield* SessionHosts;
          const sessionB = yield* hosts.open({ cwd: b.cwd, sessionId: "session-b" });
          const sessionA = yield* hosts.open({ cwd: a.cwd, sessionId: "session-a" });
          const names = (yield* sessionA.commands).map((command) => command.name);
          for (const name of ["review-switch-session", "review-new-session", "review-fork"])
            assert.ok(names.includes(name), `Piano discovers /${name}`);
          const notices = yield* sessionA.events.pipe(
            Stream.filter((frame) => frame._tag === "notice"),
            Stream.take(3),
            Stream.runCollect,
            Effect.forkScoped,
          );
          const before = readdirSync(fixture.sessionDir).sort();

          yield* prompt(sessionA, `/review-switch-session ${b.file}`);
          yield* prompt(sessionA, "/review-new-session");
          yield* prompt(sessionA, "/review-fork session-a-saved");
          yield* prompt(sessionA, "/review-record");
          yield* prompt(sessionB, "/review-record");

          assert.deepEqual(
            events(fixture, "replacement").map((record) => record.command),
            ["switch", "new", "fork"],
            "Pi reports each replacement cancelled to the extension",
          );
          const notified = yield* Fiber.join(notices);
          assert.deepEqual(
            notified.map((frame) => frame._tag === "notice" && frame.level),
            ["error", "error", "error"],
          );
          const identity = events(fixture, "identity");
          assert.equal(identity.length, 2);
          const [heldA, heldB] = identity;
          assert.notEqual(heldA.pid, heldB.pid);
          assert.deepEqual(
            [heldA.sessionId, heldA.sessionFile, heldA.cwd],
            ["session-a", a.file, a.cwd],
          );
          assert.deepEqual(
            [heldB.sessionId, heldB.sessionFile, heldB.cwd],
            ["session-b", b.file, b.cwd],
          );
          const stateA = yield* sessionA.state;
          assert.equal(stateA.closure, undefined);
          assert.deepEqual([stateA.sessionId, stateA.sessionFile], ["session-a", a.file]);
          assert.deepEqual((yield* hosts.list).map((host) => [host.cwd, host.sessionId]).sort(), [
            [a.cwd, "session-a"],
            [b.cwd, "session-b"],
          ]);
          assert.deepEqual(readdirSync(fixture.sessionDir).sort(), before, "no session file added");
          assert.equal(yield* firstText(sessionA), "HISTORY_A");
          yield* hosts.release(a.cwd, "session-a");
          yield* hosts.release(b.cwd, "session-b");
        }),
    ),
);

test(
  "Piano closes a child that Pi switched to another session anyway",
  {
    timeout: 60_000,
  },
  () =>
    withHosts(
      // Without Piano's extension nothing cancels the replacement: the host is the last guard.
      (fixture) => fixture.cli(),
      ({ fixture, a, b }) =>
        Effect.gen(function* () {
          const hosts = yield* SessionHosts;
          const sessionB = yield* hosts.open({ cwd: b.cwd, sessionId: "session-b" });
          const sessionA = yield* hosts.open({ cwd: a.cwd, sessionId: "session-a" });

          // Closing the child ends the prompt's session-owned work, as any child exit does.
          yield* Effect.exit(prompt(sessionA, `/review-switch-session ${b.file}`));
          yield* Stream.runDrain(sessionA.events);
          const closed = yield* sessionA.state;
          assert.equal(closed.closure?._tag, "failed");
          assert.match(closed.closure?.detail ?? "", /switched this process to another session/);
          assert.equal(closed.sessionId, "session-a");
          assert.equal(closed.sessionFile, a.file, "B's file never landed under A");
          const refused = yield* prompt(sessionA, "/review-record").pipe(Effect.flip);
          assert.equal(refused.reason, "rejected", "the old host accepts no input");
          assert.deepEqual(
            (yield* hosts.list).map((host) => host.sessionId),
            ["session-b"],
            "B has one live owner",
          );

          // Reopen resumes A's own history; B's is untouched.
          const reopened = yield* hosts.open({ cwd: a.cwd, sessionId: "session-a" });
          assert.notEqual(reopened, sessionA);
          assert.equal(yield* firstText(reopened), "HISTORY_A");
          yield* Effect.exit(prompt(reopened, "/review-new-session"));
          yield* Stream.runDrain(reopened.events);
          assert.equal((yield* reopened.state).closure?._tag, "failed");
          const again = yield* hosts.open({ cwd: a.cwd, sessionId: "session-a" });
          assert.equal(yield* firstText(again), "HISTORY_A");
          assert.equal((yield* again.state).sessionFile, a.file);
          assert.match(readFileSync(b.file, "utf8"), /HISTORY_B/);
          yield* prompt(sessionB, "/review-record");
          const identity = events(fixture, "identity");
          assert.deepEqual(
            identity.map((held) => [held.sessionId, held.cwd]),
            [["session-b", b.cwd]],
            "only B's own child ran a command for B",
          );
          yield* hosts.release(a.cwd, "session-a");
          yield* hosts.release(b.cwd, "session-b");
        }),
    ),
);
