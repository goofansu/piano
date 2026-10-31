import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Layer, Queue, type Scope } from "effect";
import { type ClientRequest, makeClientDispatch } from "../server/ClientDispatch.ts";
import { DirectoryFacts } from "../server/DirectoryFacts.ts";
import { GitHubPullRequestsLive } from "../server/GitHubPullRequests.ts";
import { inboundLimits } from "../server/InboundCapacity.ts";
import { PianoCoreLive } from "../server/PianoServices.ts";
import { PiCli } from "../server/PiCli.ts";
import { Registry, RegistryDatabasePath } from "../server/Registry.ts";
import { SessionHosts } from "../server/SessionHosts.ts";
import { type SessionStatus, SessionStatusLive } from "../server/SessionStatus.ts";
import { SidebarView } from "../server/SidebarView.ts";
import { WorkspaceChangesLive } from "../server/WorkspaceChanges.ts";
import type { WorkspaceCommands } from "../server/WorkspaceCommands.ts";
import type {
  ClientMessage,
  Dialog,
  ServerMessage,
  SessionPreview,
  WorktreeDiscovery,
} from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import { createModelCatalogs } from "../web/src/lib/modelCatalogs.ts";
import { createPreviewObservation, seenPreview } from "../web/src/lib/previewObservation.ts";
import {
  createWorktreeOperation,
  type WorktreeOperation,
} from "../web/src/lib/worktreeOperation.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { type AppState, initialState } from "../web/src/store.ts";

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

/** A ready app, as a session's state reports it. */
const app: SessionPreview = {
  instanceId: "i1",
  state: "running",
  ready: true,
  url: "http://localhost:5173/",
  port: 5173,
  command: ["npm", "run", "dev"],
  detail: "",
  externalAccess: "same-host",
  observedAt: 0,
};

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
    | WorkspaceCommands
    | SidebarView
    | DirectoryFacts
    | SessionHosts
    | SessionStatus
    | Registry
    | Scope.Scope
  >,
  extraArgs: string[] = [],
) => {
  sent.length = 0;
  discovered = undefined;
  const layer = SessionStatusLive.pipe(
    Layer.provide(GitHubPullRequestsLive),
    Layer.provideMerge(WorkspaceChangesLive),
    Layer.provideMerge(PianoCoreLive({ idleMs: 0, discover })),
    Layer.provide(NodeServices.layer),
  );
  return Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs,
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

test("directory selection reports trust remembered by an extension during the model probe", async () => {
  const directory = join(root, "extension-trust");
  mkdirSync(join(directory, ".pi"), { recursive: true });
  writeFileSync(join(directory, ".pi/settings.json"), "{}");
  await run(
    Effect.gen(function* () {
      const facts = yield* DirectoryFacts;
      assert.equal((yield* facts.trust(directory)).trust.trusted, false);
      const { receive } = yield* client;
      const from = sent.length;
      const models = yield* receive({ _tag: "models", cwd: directory });
      const trust = yield* receive({ _tag: "trust", cwd: directory });
      yield* Effect.all([models, trust], { concurrency: "unbounded" });
      assert.equal((yield* facts.trust(directory)).trust.trusted, true);
      assert.deepEqual(
        answers(from).filter((m) => m._tag === "trust"),
        [{ _tag: "trust", cwd: directory, trust: { required: true, trusted: true } }],
      );
    }),
    ["--remember-project-trust"],
  );
});

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
          return {
            send: (m) => {
              requests.push(m);
              return "sent";
            },
            close: () => {},
          };
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

for (const refusal of ["client", "session"] as const) {
  test(`INV-04/05: a preview status read refused at ${refusal} admission settles its observer, which reads again once capacity returns`, async () => {
    await run(
      Effect.gen(function* () {
        const session = yield* registered(`preview-refused-${refusal}`);
        const { sessionId } = session.spec;
        const queue = yield* Queue.unbounded<ServerMessage>();
        const listeners = new Set<(m: ServerMessage) => void>();
        const { receive } = yield* makeClientDispatch({
          send: (m) =>
            Effect.sync(() => {
              for (const listener of listeners) listener(m);
            }).pipe(Effect.andThen(Queue.offer(queue, m)), Effect.asVoid),
          overflow: (e) => Effect.die(e),
        });
        yield* yield* receive({ _tag: "select", selectionId: "sel-1", cwd, sessionId });
        // The browser's attachment to that session, which owns a ready app.
        const page: AppState = {
          ...initialState,
          connected: true,
          selectionId: "sel-1",
          view: { kind: "session" },
          session: {
            cwd,
            sessionId,
            hosted: true,
            cursor: { cwd, sessionId, generation: "g1", sequence: 1 },
            state: { sessionId, isStreaming: false, preview: app },
            messages: [],
            dialogs: [],
          },
        };
        const outbox: ClientRequest[] = [];
        const observation = createPreviewObservation({
          environment: { onFocus: () => () => {} },
          newRequestId: (() => {
            let n = 0;
            return () => `read-${++n}`;
          })(),
        });
        const stop = observation.follow(
          {
            getState: () => page,
            subscribe: () => () => {},
            send: (command) => {
              if (command._tag === "act") outbox.push({ ...command, selectionId: "sel-1" });
              return "sent";
            },
            listen: (listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          () => {},
        );
        const deliver = Effect.gen(function* () {
          const sent = outbox.splice(0);
          for (const request of sent) yield* yield* receive(request);
          return sent.map(
            (m) => m._tag === "act" && m.action._tag === "preview_status" && m.action.requestId,
          );
        });

        let release: Effect.Effect<void, unknown> = Effect.void;
        if (refusal === "client") {
          const held: Effect.Effect<void>[] = [];
          for (let n = 0; n < inboundLimits.client.messages; n++)
            held.push(yield* receive({ _tag: "registry" }));
          release = Effect.forEach(held, (work) => work, { discard: true });
        } else {
          const pending: Fiber.Fiber<unknown, unknown>[] = [];
          for (let n = 0; n < inboundLimits.requests.messages; n++)
            pending.push(
              yield* session.act({ _tag: "prompt", text: "capacity hold" }).pipe(Effect.forkChild),
            );
          let dialog: Dialog | undefined;
          for (;;) {
            const m = yield* Queue.take(queue);
            if (m._tag !== "session") continue;
            if (m.event._tag === "dialog") dialog = m.event.dialog;
            if (
              m.event._tag === "notice" &&
              m.event.message === `Capacity held: ${inboundLimits.requests.messages}`
            )
              break;
          }
          release = Effect.gen(function* () {
            assert.ok(dialog);
            yield* session.act({
              _tag: "answer",
              id: dialog.id,
              generation: dialog.generation,
              value: "release",
            });
            for (const fiber of pending) yield* Fiber.join(fiber);
          });
        }

        assert.deepEqual(yield* deliver, ["read-1"]);
        const refused = observation.getState();
        assert.equal(refused.refreshing, false, "the refused read settled");
        assert.equal(refused.unconfirmed, "i1");
        assert.match(
          refused.details?.error ?? "",
          refusal === "client" ? /Client input capacity is full/ : /Session input capacity is full/,
        );
        const unknown = seenPreview(page, refused)!;
        assert.equal(unknown.state, "unknown", "the app stays inspectable, with unknown status");
        assert.equal(unknown.url, null, "its ready link is withheld");

        yield* release;
        observation.refresh();
        assert.deepEqual(yield* deliver, ["read-2"], "an explicit check sends a fresh request");
        for (;;) {
          const m = yield* Queue.take(queue);
          if (m._tag === "error" || (m._tag === "preview_unobserved" && m.requestId === "read-2"))
            assert.fail(m.message);
          if (m._tag === "action_result" && m.result._tag === "preview_observed") {
            assert.equal(m.result.requestId, "read-2", "the fresh read reached the session");
            break;
          }
        }
        stop();
      }),
    );
  });
}

for (const outcome of ["refused", "probe failure", "dispatch failure"] as const) {
  test(`INV-05: ${outcome} settles a model refresh and allows one explicit retry`, async () => {
    await run(
      Effect.gen(function* () {
        // Preserve the caller's spelling for correlation even when DirectoryFacts normalizes it.
        const cwd = `${join(root, outcome)}/.`;
        if (outcome !== "probe failure") mkdirSync(cwd, { recursive: true });
        const requests: ClientMessage[] = [];
        const notes: string[] = [];
        let handlers: ConnectionHandlers | undefined;
        const cached = { cwd, models: [], fetchedAt: "cached" };
        const catalogs = createModelCatalogs({
          storage: { read: () => ({ [cwd]: cached }), write: () => {} },
          notify: (message) => notes.push(message),
          saveDefaults: async () => {},
        });
        const browser = createClient({
          initial: { ...initialState, catalogs: { ...catalogs.seed() } },
          connect: (h) => {
            handlers = h;
            return {
              send: (m) => {
                requests.push(m);
                return "sent";
              },
              close: () => {},
            };
          },
          notify: () => {},
          lastDirectory: { read: () => null, write: () => {} },
        });
        browser.start();
        catalogs.follow(browser);
        handlers!.onStatus(true);
        const facts = yield* DirectoryFacts;
        let failDispatch = outcome === "dispatch failure";
        const dispatch = yield* makeClientDispatch({
          send: (m) => Effect.sync(() => handlers!.onMessage(m)),
          overflow: (e) => Effect.die(e),
        }).pipe(
          Effect.provideService(DirectoryFacts, {
            ...facts,
            catalog: (...args) =>
              failDispatch ? Effect.die("catalog defect") : facts.catalog(...args),
          }),
        );
        const held = [];
        if (outcome === "refused")
          for (let n = 0; n < inboundLimits.client.messages; n++)
            held.push(yield* dispatch.receive({ _tag: "registry" }));
        const refreshes = () =>
          requests.filter((m) => m._tag === "models").filter((m) => m.refresh);
        const view = () => catalogs.view(catalogs.getState(), cwd);
        catalogs.refresh(cwd);
        yield* yield* dispatch.receive(refreshes()[0]);
        assert.equal(view().refreshing, false, "failure must end the refresh");
        assert.deepEqual(view().catalog, cached, "failure keeps the last good catalog");
        assert.equal(notes.length, 1, "the failure is reported once");
        assert.equal(refreshes().length, 1, "no automatic retry");
        for (const work of held) yield* work;
        failDispatch = false;
        if (outcome === "probe failure") mkdirSync(cwd, { recursive: true });
        catalogs.refresh(cwd);
        catalogs.refresh(cwd);
        assert.equal(refreshes().length, 2, "explicit retry sends exactly one request");
        yield* yield* dispatch.receive(refreshes()[1]);
        assert.equal(view().refreshing, false);
        assert.ok(view().catalog!.models.length > 0, "accepted retry loads Pi's models");
      }),
    );
  });
}

test("INV-05: an admitted selection failure settles the browser and permits explicit retry", async () => {
  await run(
    Effect.gen(function* () {
      const requests: ClientMessage[] = [];
      let handlers: ConnectionHandlers | undefined;
      const browser = createClient({
        initial: initialState,
        connect: (h) => {
          handlers = h;
          return {
            send: (m) => {
              requests.push(m);
              return "sent";
            },
            close: () => {},
          };
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
        assert.deepEqual(trust, {
          _tag: "trust",
          cwd,
          trust: { required: true, trusted: true },
          requested: true,
        });
        assert.equal(models?._tag, "models");
        assert.deepEqual(rest, []);
      }),
    );
  } finally {
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
  }
});

test("untrust reports the final outcome when a Pi extension remembers trust again", async () => {
  const directory = join(root, "retrust");
  mkdirSync(join(directory, ".pi"), { recursive: true });
  writeFileSync(join(directory, ".pi/settings.json"), "{}");
  await run(
    Effect.gen(function* () {
      const facts = yield* DirectoryFacts;
      yield* facts.catalog(directory);
      assert.equal((yield* facts.trust(directory)).trust.trusted, true);
      const { receive } = yield* client;
      const from = sent.length;
      yield* yield* receive({ _tag: "set_trust", path: directory, trusted: false });
      const replies = answers(from);
      const final = yield* facts.trust(directory);
      assert.equal(final.trust.trusted, true, "the extension saved trust during reload");
      assert.deepEqual(
        replies.find((m) => m._tag === "trust"),
        {
          _tag: "trust",
          ...final,
          requested: false,
        },
      );
      const notices = replies.filter((m) => m._tag === "toast");
      assert.equal(notices.length, 1);
      assert.equal(notices[0]?.level, "warning");
      assert.match(notices[0]?.message ?? "", /Pi.*trusted.*reload/i);
    }),
    ["--remember-project-trust"],
  );
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
      return {
        send: (m) => {
          m._tag !== "ack" && commands.push(m);
          return "sent";
        },
        close: () => {},
      };
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
      for (const work of held) yield* work;
      yield* (yield* Registry).addFolder(cwd);
      operation.refresh();
      yield* exchange;
      assert.equal(operation.getState().refreshing, false, "accepted discovery is correlated too");
      assert.equal(operation.getState().discovery?.status, "non-git");
    }),
  );
});

/**
 * One request of every kind, with the reply its sender awaits when client capacity refuses it.
 * Exhaustive by type, so a new request kind needs its refusal reply stated here. `REFUSED` stands
 * for the capacity message.
 */
const refusals: {
  readonly [K in ClientRequest["_tag"]]: readonly [Extract<ClientRequest, { _tag: K }>, unknown];
} = {
  // A heartbeat is never refused: it bypasses capacity and is answered.
  ping: [
    { _tag: "ping", nonce: "n" },
    { _tag: "pong", nonce: "n" },
  ],
  select: [
    { _tag: "select", selectionId: "s1", cwd, sessionId: null },
    { _tag: "selection_rejected", selectionId: "s1", message: "REFUSED" },
  ],
  create_session: [
    { _tag: "create_session", selectionId: "s2", cwd, options: {}, text: "hi" },
    { _tag: "selection_rejected", selectionId: "s2", message: "REFUSED" },
  ],
  session_status: [
    { _tag: "session_status", requestId: "st1", target: { sessionId: "x" } },
    { _tag: "session_status", requestId: "st1", result: { status: "error", detail: "REFUSED" } },
  ],
  act: [
    { _tag: "act", selectionId: "s3", action: { _tag: "prompt", text: "hi" } },
    { _tag: "error", message: "REFUSED", selectionId: "s3" },
  ],
  worktrees: [
    { _tag: "worktrees", folder: cwd, requestId: "discovery1" },
    {
      _tag: "worktrees",
      folder: cwd,
      requestId: "discovery1",
      discovery: { status: "error", observedAt: "OBSERVED", detail: "REFUSED" },
    },
  ],
  create_worktree: [
    { _tag: "create_worktree", requestId: "w1", folder: cwd, branch: "b", hooks: false },
    {
      _tag: "worktree_result",
      requestId: "w1",
      result: { status: "error", detail: "REFUSED", unconfirmed: false },
    },
  ],
  add_worktree: [
    { _tag: "add_worktree", requestId: "w2", folder: cwd, path: join(root, "other") },
    {
      _tag: "worktree_result",
      requestId: "w2",
      result: { status: "error", detail: "REFUSED", unconfirmed: false },
    },
  ],
  registry: [{ _tag: "registry" }, { _tag: "error", message: "REFUSED" }],
  models: [
    { _tag: "models", cwd },
    { _tag: "models_failed", cwd, message: "REFUSED" },
  ],
  save_project: [
    { _tag: "save_project", project: { id: "p", name: "P" } },
    { _tag: "error", message: "REFUSED" },
  ],
  delete_project: [
    { _tag: "delete_project", id: "p" },
    { _tag: "error", message: "REFUSED" },
  ],
  update_project: [
    { _tag: "update_project", id: "p", instructions: "Be brief." },
    { _tag: "error", message: "REFUSED" },
  ],
  assign_project: [
    { _tag: "assign_project", cwd, sessionId: "x", projectId: null },
    { _tag: "error", message: "REFUSED" },
  ],
  remove_folder: [
    { _tag: "remove_folder", path: cwd },
    { _tag: "error", message: "REFUSED" },
  ],
  trust: [
    { _tag: "trust", cwd },
    { _tag: "error", message: "REFUSED" },
  ],
  set_trust: [
    { _tag: "set_trust", path: cwd, trusted: true },
    { _tag: "trust_failed", cwd, message: "REFUSED" },
  ],
  rename_session: [
    { _tag: "rename_session", cwd, sessionId: "x", title: "t" },
    { _tag: "error", message: "REFUSED" },
  ],
  pin_session: [
    { _tag: "pin_session", cwd, sessionId: "x", pinned: true },
    { _tag: "error", message: "REFUSED" },
  ],
  archive_session: [
    { _tag: "archive_session", cwd, sessionId: "x" },
    { _tag: "error", message: "REFUSED" },
  ],
  delete_session: [
    { _tag: "delete_session", cwd, sessionId: "x" },
    { _tag: "error", message: "REFUSED" },
  ],
};

test("INV-05/06: every request kind refused at capacity gets its own correlated reply and changes nothing", async () => {
  await run(
    Effect.gen(function* () {
      const { receive } = yield* client;
      yield* (yield* SidebarView).fresh;
      const held = [];
      for (let n = 0; n < inboundLimits.client.messages; n++)
        held.push(yield* receive({ _tag: "registry" }));
      const before = yield* (yield* Registry).get;
      for (const [request, reply] of Object.values(refusals)) {
        const from = sent.length;
        yield* yield* receive(request);
        // Stand in for the capacity message and the observation time, and drop absent fields.
        const [answer, ...rest] = JSON.parse(
          JSON.stringify(answers(from), (key, value) =>
            typeof value === "string" && /not started/.test(value)
              ? "REFUSED"
              : key === "observedAt"
                ? "OBSERVED"
                : value,
          ),
        );
        assert.deepEqual(answer, reply, request._tag);
        assert.deepEqual(rest, [], `${request._tag} gets one reply`);
      }
      assert.deepEqual(
        yield* (yield* Registry).get,
        before,
        "refused requests did not reach the registry",
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

test("a session start in a missing directory is rejected as never started", async () => {
  await run(
    Effect.gen(function* () {
      const { receive } = yield* client;
      const missing = join(root, "missing");
      const from = sent.length;
      yield* yield* receive({
        _tag: "create_session",
        selectionId: "new",
        cwd: missing,
        options: {},
        text: "hi",
      });
      assert.deepEqual(answers(from), [
        { _tag: "selection_rejected", selectionId: "new", message: `Not a directory: ${missing}` },
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

test("INV-01: save_project with a session saves both and answers with a toast; an unknown session is answered as an error", async () => {
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
      const saved = sent.length;
      yield* yield* receive({
        _tag: "save_project",
        project: { id: "launch", name: "Launch", instructions: "Reply tersely." },
        assign: { cwd, sessionId: "one" },
      });
      assert.deepEqual(answers(saved), [
        { _tag: "toast", message: "Project created", level: "success" },
      ]);
      const data = yield* registry.get;
      assert.deepEqual(data.projects, [
        { id: "launch", name: "Launch", instructions: "Reply tersely." },
      ]);
      assert.equal(data.sessions.find((s) => s.sessionId === "one")?.projectId, "launch");
    }),
  );
});

test("deleting a project tells its browser so; deleting an unknown one is answered as an error", async () => {
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const { receive } = yield* client;
      const from = sent.length;
      yield* yield* receive({ _tag: "delete_project", id: "launch" });
      assert.deepEqual(answers(from), [
        { _tag: "toast", message: "Project deleted", level: "success" },
      ]);
      assert.deepEqual((yield* registry.get).projects, []);
      const again = sent.length;
      yield* yield* receive({ _tag: "delete_project", id: "launch" });
      assert.deepEqual(answers(again), [
        {
          _tag: "error",
          message: "Project is unavailable. Refresh and try again.",
          selectionId: undefined,
        },
      ]);
    }),
  );
});

test("INV-01: saving a project's settings is one write answered with a toast; an unknown project is refused, not recreated", async () => {
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      const { receive } = yield* client;
      const from = sent.length;
      yield* yield* receive({
        _tag: "update_project",
        id: "launch",
        name: " Relaunch ",
        instructions: " Answer in French. ",
      });
      assert.deepEqual(answers(from), [
        { _tag: "toast", message: "Project saved", level: "success" },
      ]);
      assert.deepEqual((yield* registry.get).projects, [
        { id: "launch", name: "Relaunch", instructions: "Answer in French." },
      ]);
      yield* registry.deleteProject("launch");
      const again = sent.length;
      yield* yield* receive({ _tag: "update_project", id: "launch", name: "Back" });
      assert.deepEqual(answers(again), [
        {
          _tag: "error",
          message: "Project is unavailable. Refresh and try again.",
          selectionId: undefined,
        },
      ]);
      assert.deepEqual((yield* registry.get).projects, []);
    }),
  );
});

test("INV-01: a browser's checkout poll re-observes without resending the sidebar it already has", async () => {
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry,
        view = yield* SidebarView;
      yield* registry.addFolder(cwd);
      yield* view.fresh;
      const queue = yield* Queue.unbounded<ServerMessage>();
      const { receive } = yield* makeClientDispatch({
        send: (m) => Queue.offer(queue, m).pipe(Effect.asVoid),
        overflow: (e) => Effect.die(e),
      });
      let snapshots = 0;
      /** The next sidebar this browser is sent that holds `sessions` session references. */
      const sidebarWith = (sessions: number) =>
        Effect.gen(function* () {
          for (;;) {
            const m = yield* Queue.take(queue);
            if (m._tag !== "registry") continue;
            snapshots++;
            if ((m.sessionReferences?.length ?? 0) === sessions) return m;
          }
        });

      const initial = yield* sidebarWith(0);
      assert.deepEqual(
        [snapshots, initial.folders.map((f) => f.path)],
        [1, [cwd]],
        "the connection is given the sidebar once",
      );

      // The page's five-second checkout poll, which keeps Git's branch projection current.
      for (let poll = 0; poll < 3; poll++) {
        yield* yield* receive({ _tag: "registry" });
        yield* view.fresh;
      }

      yield* registry.addSession(cwd, "polled", "Polled");
      const changed = yield* sidebarWith(1);
      assert.deepEqual(
        [snapshots, changed.sessionReferences?.map((s) => s.title)],
        [2, ["Polled"]],
        "only the new session was sent after the initial sidebar",
      );
    }),
  );
});

/**
 * Every change a browser sends, with the toast that confirms it once the server has made it and
 * a request of the same kind that fails. A failed change is answered by its error alone: no
 * toast says it happened. Folders close idempotently, so closing one has no failing request.
 */
const confirmations: ReadonlyArray<{
  readonly done: ClientRequest;
  readonly toast: string;
  readonly fails?: readonly [ClientRequest, RegExp];
}> = [
  {
    done: { _tag: "save_project", project: { id: "next", name: "Next" } },
    toast: "Project created",
    fails: [
      {
        _tag: "save_project",
        project: { id: "ghost", name: "Ghost" },
        assign: { cwd, sessionId: "missing" },
      },
      /Session reference is unavailable/,
    ],
  },
  {
    done: { _tag: "update_project", id: "next", name: "Later" },
    toast: "Project saved",
    fails: [{ _tag: "update_project", id: "missing", name: "X" }, /Project is unavailable/],
  },
  {
    done: { _tag: "assign_project", cwd, sessionId: "kept", projectId: "launch" },
    toast: "Session moved to Launch",
    fails: [
      { _tag: "assign_project", cwd, sessionId: "missing", projectId: "launch" },
      /Session reference is unavailable/,
    ],
  },
  {
    done: { _tag: "assign_project", cwd, sessionId: "kept", projectId: null },
    toast: "Session removed from project",
    fails: [
      { _tag: "assign_project", cwd, sessionId: "kept", projectId: "missing" },
      /Project is unavailable/,
    ],
  },
  {
    done: { _tag: "delete_project", id: "next" },
    toast: "Project deleted",
    fails: [{ _tag: "delete_project", id: "missing" }, /Project is unavailable/],
  },
  {
    done: { _tag: "rename_session", cwd, sessionId: "kept", title: "Renamed" },
    toast: "Session renamed",
    fails: [
      { _tag: "rename_session", cwd, sessionId: "missing", title: "X" },
      /no longer registered/,
    ],
  },
  {
    done: { _tag: "archive_session", cwd, sessionId: "archived" },
    toast: "Session archived",
    fails: [{ _tag: "archive_session", cwd, sessionId: "missing" }, /no longer registered/],
  },
  {
    done: { _tag: "delete_session", cwd, sessionId: "deleted" },
    toast: "Session deleted",
    fails: [{ _tag: "delete_session", cwd, sessionId: "missing" }, /no longer registered/],
  },
  { done: { _tag: "remove_folder", path: cwd }, toast: "Folder closed" },
];

test("every change ends with one toast naming it after it succeeds; a failed change ends with its error", async () => {
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.addFolder(cwd);
      yield* registry.saveProject({ id: "launch", name: "Launch" });
      for (const sessionId of ["kept", "archived", "deleted"])
        yield* registry.addSession(cwd, sessionId);
      const { receive } = yield* client;
      for (const { done, toast, fails } of confirmations) {
        if (fails) {
          const [request, error] = fails;
          const from = sent.length;
          yield* yield* receive(request);
          const [answer, ...rest] = answers(from);
          assert.ok(answer?._tag === "error", `${request._tag} failed: ${JSON.stringify(answer)}`);
          assert.match(answer.message, error, request._tag);
          assert.deepEqual(rest, [], `${request._tag} failed without a toast`);
        }
        const from = sent.length;
        yield* yield* receive(done);
        assert.deepEqual(
          answers(from),
          [{ _tag: "toast", level: "success", message: toast }],
          done._tag,
        );
      }
      const data = yield* registry.get;
      assert.deepEqual(
        [data.projects.map((p) => p.id), data.folders],
        [["launch"], []],
        "the confirmed changes were made",
      );
      assert.deepEqual(
        data.sessions.map((s) => [s.sessionId, s.title, s.projectId, s.archived === true]),
        [
          ["kept", "Renamed", undefined, false],
          ["archived", undefined, undefined, true],
        ],
      );
    }),
  );
});
