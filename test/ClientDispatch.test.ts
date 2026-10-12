import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, Queue, type Scope } from "effect";
import { makeClientDispatch } from "../server/ClientDispatch.ts";
import { type DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { inboundLimits } from "../server/InboundCapacity.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessionsLive } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";
import { SidebarView, SidebarViewLive } from "../server/SidebarView.ts";
import { type WorkspaceCommands, WorkspaceCommandsLive } from "../server/WorkspaceCommands.ts";
import type { ClientMessage, Dialog, ServerMessage, WorktreeDiscovery } from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-client-dispatch-")));
const cwd = join(root, "checkout");
mkdirSync(cwd);
mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

/** What the client has been sent, in order; each Git discovery reports how much had been sent when it started. */
const sent: ServerMessage[] = [];
let discovered: Queue.Queue<number> | undefined;
const discover = (_folder: string) =>
  Effect.sync((): WorktreeDiscovery => {
    if (discovered) Queue.offerUnsafe(discovered, sent.length);
    return { status: "non-git", observedAt: new Date().toISOString() };
  });

let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    WorkspaceCommands | SidebarView | DirectoryFacts | SessionHosts | Registry | Scope.Scope
  >,
) => {
  sent.length = 0;
  discovered = undefined;
  const layer = WorkspaceCommandsLive.pipe(
    Layer.provideMerge(SidebarViewLive({ discover })),
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
const client = makeClientDispatch({
  send: (m) =>
    Effect.sync(() => {
      sent.push(m);
    }),
  overflow: (e) => Effect.die(e),
});
/** What this client was answered, without the hosts, sidebar and catalog updates every client hears. */
const answers = (from: number) =>
  sent
    .slice(from)
    .filter(
      (m) => m._tag !== "hosts" && m._tag !== "registry" && m._tag !== "catalogs_invalidated",
    );

for (const control of ["answer", "abort"] as const) {
  test(`INV-02/04/05: client saturation rejects before selection changes and leaves ${control} live`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* (yield* SessionHosts).open({
          cwd,
          sessionId: `client-capacity-${control}`,
          create: true,
        });
        const queue = yield* Queue.unbounded<ServerMessage>();
        const { receive } = yield* makeClientDispatch({
          send: (m) => Queue.offer(queue, m).pipe(Effect.asVoid),
          overflow: (e) => Effect.die(e),
        });
        yield* yield* receive({
          _tag: "select",
          selectionId: "current",
          cwd,
          sessionId: session.spec.sessionId,
        });
        const pending = [];
        for (let n = 0; n < inboundLimits.client.messages; n++)
          pending.push(
            yield* (yield* receive({
              _tag: "act",
              selectionId: "current",
              action: { _tag: "prompt", text: "capacity hold" },
            })).pipe(Effect.forkChild),
          );
        let dialog: Dialog | undefined;
        for (;;) {
          const m = yield* Queue.take(queue);
          if (m._tag !== "session") continue;
          if (m.event._tag === "dialog") dialog = m.event.dialog;
          if (
            m.event._tag === "notice" &&
            m.event.message === `Capacity held: ${inboundLimits.client.messages}`
          )
            break;
        }
        yield* yield* receive({ _tag: "ping", nonce: "saturated" });
        for (;;) {
          const m = yield* Queue.take(queue);
          if (m._tag === "error") assert.fail(m.message);
          if (m._tag === "pong") {
            assert.equal(m.nonce, "saturated");
            break;
          }
        }
        yield* yield* receive({ _tag: "select", selectionId: "excess", cwd, sessionId: null });
        for (;;) {
          const m = yield* Queue.take(queue);
          if (m._tag !== "selection_rejected") continue;
          assert.equal(m.selectionId, "excess");
          assert.match(m.message, /capacity.*not started/);
          break;
        }
        assert.ok(dialog);
        yield* yield* receive({
          _tag: "act",
          selectionId: "current",
          action:
            control === "answer"
              ? { _tag: "answer", id: dialog.id, generation: dialog.generation, value: "release" }
              : { _tag: "abort" },
        });
        for (const fiber of pending) yield* Fiber.join(fiber);
        yield* yield* receive({
          _tag: "act",
          selectionId: "current",
          action: { _tag: "commands" },
        });
        for (;;) {
          const m = yield* Queue.take(queue);
          if (m._tag === "error") assert.fail(m.message);
          if (m._tag === "action_result" && m.result._tag === "commands") {
            assert.equal(m.sessionId, session.spec.sessionId);
            break;
          }
        }
      }),
    );
  });
}

test("INV-05: browser client recovers from dispatch saturation with a fresh explicit selection", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* (yield* SessionHosts).open({
        cwd,
        sessionId: "browser-retry",
        create: true,
      });
      const requests: ClientMessage[] = [];
      let handlers: ConnectionHandlers | undefined;
      const browser = createClient({
        initial: initialState,
        connect: (h) => {
          handlers = h;
          return { send: (m) => requests.push(m), close: () => {} };
        },
        notify: () => {},
      });
      browser.start();
      handlers!.onStatus(true);
      const dispatch = yield* makeClientDispatch({
        send: (m) => Effect.sync(() => handlers!.onMessage(m)),
        overflow: (e) => Effect.die(e),
      });
      // Admission owns capacity before returned work runs, so this saturates deterministically.
      const held = [];
      for (let n = 0; n < inboundLimits.client.messages; n++)
        held.push(yield* dispatch.receive({ _tag: "registry" }));
      browser.select(cwd, session.spec.sessionId);
      const first = requests.find((m) => m._tag === "select")!;
      yield* yield* dispatch.receive(first);
      assert.equal(browser.getState().selecting, null);
      assert.match(browser.getState().selectionFailure!.message, /not started/);
      for (const work of held) yield* work;
      browser.select(cwd, session.spec.sessionId);
      const selections = requests.filter((m) => m._tag === "select");
      assert.equal(selections.length, 2);
      assert.notEqual(selections[0].selectionId, selections[1].selectionId);
      yield* yield* dispatch.receive(selections[1]);
      assert.equal(browser.getState().session?.sessionId, session.spec.sessionId);
      assert.equal(browser.getState().selecting, null);
      assert.equal(browser.getState().selectionFailure, null);
    }),
  );
});

test("a trust decision answers the requester with a notice, the new trust and the new models, in that order", async () => {
  // A project skill makes the directory's trust matter to Pi.
  mkdirSync(join(cwd, ".agents/skills/hello"), { recursive: true });
  writeFileSync(
    join(cwd, ".agents/skills/hello/SKILL.md"),
    "---\nname: hello\ndescription: say hello\n---\nSay hello.\n",
  );
  try {
    await run(
      Effect.gen(function* () {
        const { receive } = yield* client;
        const from = sent.length;
        yield* yield* receive({ _tag: "set_trust", path: cwd, trusted: true });
        const [toast, trust, models, ...rest] = answers(from);
        assert.ok(toast?._tag === "toast" && toast.level === "success");
        assert.match(toast.message, /^Trusted\./);
        assert.deepEqual(trust, { _tag: "trust", cwd, trust: { required: true, trusted: true } });
        assert.equal(models?._tag, "models");
        assert.deepEqual(rest, []);
      }),
    );
  } finally {
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
  }
});

test("INV-06: a failed worktree request is answered, then the sidebar is rediscovered", async () => {
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry,
        sidebar = yield* SidebarView;
      yield* registry.addFolder(cwd);
      const { receive } = yield* client;
      // Let the connection's own first discovery finish, so any later one is the request's.
      yield* sidebar.fresh;
      const queue = yield* Queue.unbounded<number>();
      discovered = queue;
      yield* yield* receive({
        _tag: "create_worktree",
        requestId: "r1",
        folder: join(root, "unregistered"),
        branch: "feature",
        hooks: false,
      });
      const answered = sent.findIndex((m) => m._tag === "worktree_result");
      assert.deepEqual(sent[answered], {
        _tag: "worktree_result",
        requestId: "r1",
        result: { status: "error", detail: "Select a registered folder first." },
      });
      // Without a rediscovery this waits until the test times out.
      assert.ok(
        (yield* Queue.take(queue)) > answered,
        "a discovery started after the answer was sent",
      );
    }),
  );
});

test("a request that fails reaches the client as an error for its selection, and the next request is still served", async () => {
  await run(
    Effect.gen(function* () {
      const { receive } = yield* client;
      yield* yield* receive({ _tag: "select", selectionId: "new", cwd, sessionId: null });
      const from = sent.length;
      yield* yield* receive({
        _tag: "act",
        selectionId: "new",
        action: { _tag: "prompt", text: "hello" },
        start: {},
      });
      assert.deepEqual(answers(from), [
        {
          _tag: "error",
          selectionId: "new",
          message: "No session is selected. Create a session before sending to it.",
        },
      ]);
      yield* yield* receive({ _tag: "ping", nonce: "n" });
      assert.deepEqual(answers(from).at(-1), { _tag: "pong", nonce: "n" });
    }),
  );
});

test("INV-01: save_project with a session saves both, and an unknown session is answered as an error", async () => {
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.addSession(cwd, "one");
      const { receive } = yield* client;
      const from = sent.length;
      yield* yield* receive({
        _tag: "save_project",
        project: { id: "ghost", name: "Ghost" },
        assign: { cwd, sessionId: "missing" },
      });
      assert.deepEqual(answers(from), [
        {
          _tag: "error",
          message: "Session reference is unavailable. Refresh and try again.",
          selectionId: undefined,
        },
      ]);
      assert.deepEqual((yield* registry.get).projects, []);
      yield* yield* receive({
        _tag: "save_project",
        project: { id: "launch", name: "Launch" },
        assign: { cwd, sessionId: "one" },
      });
      const data = yield* registry.get;
      assert.deepEqual(data.projects, [{ id: "launch", name: "Launch", archived: false }]);
      assert.equal(data.sessions.find((s) => s.sessionId === "one")?.projectId, "launch");
    }),
  );
});
