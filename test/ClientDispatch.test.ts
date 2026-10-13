import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, Queue, type Scope } from "effect";
import { type ClientRequest, makeClientDispatch } from "../server/ClientDispatch.ts";
import type { DirectoryFacts } from "../server/DirectoryFacts.ts";
import { inboundLimits } from "../server/InboundCapacity.ts";
import { PianoCoreLive } from "../server/PianoServices.ts";
import { PiCli } from "../server/PiCli.ts";
import { Registry, RegistryDatabasePath } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { SidebarView } from "../server/SidebarView.ts";
import type { WorkspaceCommands } from "../server/WorkspaceCommands.ts";
import type { ClientMessage, Dialog, ServerMessage, WorktreeDiscovery } from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import {
  createWorktreeOperation,
  type WorktreeOperation,
} from "../web/src/lib/worktreeOperation.ts";
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

/** A registered session, running. */
const registered = (sessionId: string) =>
  Effect.gen(function* () {
    yield* (yield* Registry).addSession(cwd, sessionId);
    return yield* (yield* SessionHosts).open({ cwd, sessionId });
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
        const session = yield* registered(`client-capacity-${control}`);
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
          action: { _tag: "set_thinking_level", level: "high" },
        });
        for (;;) {
          const m = yield* Queue.take(queue);
          if (m._tag === "error") assert.fail(m.message);
          if (
            m._tag === "session" &&
            m.event._tag === "state" &&
            m.event.state.thinkingLevel === "high"
          )
            break;
        }
      }),
    );
  });
}

test("INV-05: browser client recovers from dispatch saturation with a fresh explicit selection", async () => {
  await run(
    Effect.gen(function* () {
      const session = yield* registered("browser-retry");
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

test("INV-05: an admitted selection failure settles the browser and permits explicit retry", async () => {
  await run(
    Effect.gen(function* () {
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
      // Real host resolution rejects an unregistered reference, without saturation.
      const sessionId = "admitted-retry";
      browser.select(cwd, sessionId);
      const first = requests.find((m) => m._tag === "select")!;
      yield* yield* dispatch.receive(first);
      assert.equal(browser.getState().selecting, null);
      assert.equal(browser.getState().selectionId, null);
      assert.ok(browser.getState().selectionFailure?.message);
      assert.equal(requests.filter((m) => m._tag === "select").length, 1, "no automatic retry");
      // Remove the resolution failure, then retry the exact same reference explicitly.
      yield* registered(sessionId);
      browser.select(cwd, sessionId);
      const selections = requests.filter((m) => m._tag === "select");
      assert.equal(selections.length, 2);
      assert.notEqual(selections[0].selectionId, selections[1].selectionId);
      yield* yield* dispatch.receive(selections[1]);
      assert.equal(browser.getState().session?.sessionId, sessionId);
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

/**
 * A browser page's worktree picker against `receive`: `exchange` dispatches what the picker last
 * sent and delivers this client's answers to the page, as the socket would.
 */
function worktreePicker(receive: (m: ClientRequest) => Effect.Effect<Effect.Effect<void>>) {
  const commands: ClientRequest[] = [];
  let handlers: ConnectionHandlers | undefined;
  const page = createClient({
    initial: initialState,
    connect: (h) => {
      handlers = h;
      return { send: (m) => m._tag !== "ack" && commands.push(m), close: () => {} };
    },
    notify: () => {},
    lastDirectory: { read: () => null, write: () => {} },
  });
  page.start();
  handlers!.onStatus(true);
  let ids = 0;
  const operation = createWorktreeOperation({ client: page, newRequestId: () => `r${++ids}` });
  operation.start();
  const sentByPicker = () =>
    commands.filter((m) => m._tag !== "models" && m._tag !== "trust" && m._tag !== "ping");
  const exchange = Effect.gen(function* () {
    const command = sentByPicker().at(-1);
    assert.ok(command, "the picker sent a command");
    const from = sent.length;
    yield* yield* receive(command);
    for (const message of answers(from)) handlers!.onMessage(message);
  });
  return { operation, sentByPicker, exchange };
}

const failure = (operation: WorktreeOperation) => {
  const { request } = operation.getState();
  return request.status === "failed" ? request.detail : undefined;
};

test("INV-06: rejected worktree operations settle the picker immediately without replay", async () => {
  await run(
    Effect.gen(function* () {
      const { receive } = yield* client;
      yield* (yield* SidebarView).fresh;
      const held = [];
      for (let n = 0; n < inboundLimits.client.messages; n++)
        held.push(yield* receive({ _tag: "registry" }));
      const before = yield* (yield* Registry).get;
      const { operation, sentByPicker, exchange } = worktreePicker(receive);

      operation.open(cwd);
      yield* exchange;
      assert.equal(operation.getState().refreshing, false, "the rejected discovery answered");
      const discovery = operation.getState().discovery;
      assert.equal(discovery?.status, "error");
      if (discovery?.status === "error") assert.match(discovery.detail, /not started/);

      operation.create("must-not-exist", false);
      yield* exchange;
      assert.match(failure(operation) ?? "", /not started/);
      operation.dismiss();
      operation.select(cwd);
      yield* exchange;
      assert.match(failure(operation) ?? "", /not started/);
      assert.deepEqual(
        sentByPicker().map((m) => m._tag),
        ["worktrees", "create_worktree", "add_worktree"],
        "mutations are never replayed",
      );
      assert.deepEqual(
        yield* (yield* Registry).get,
        before,
        "admission did not invoke lifecycle registration",
      );
      for (const work of held) yield* work;
    }),
  );
});

test("an admitted worktree request is answered with the command's result under its request ID", async () => {
  await run(
    Effect.gen(function* () {
      const { receive } = yield* client;
      const from = sent.length;
      yield* yield* receive({
        _tag: "create_worktree",
        requestId: "r1",
        folder: join(root, "unregistered"),
        branch: "feature",
        hooks: false,
      });
      assert.deepEqual(answers(from), [
        {
          _tag: "worktree_result",
          requestId: "r1",
          result: {
            status: "error",
            detail: "Select a registered folder first.",
            unconfirmed: false,
          },
        },
      ]);
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
