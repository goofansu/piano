import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Queue, type Scope } from "effect";
import { type ClientRequest, makeClientDispatch } from "../server/ClientDispatch.ts";
import type { CreationAttempts } from "../server/CreationAttempts.ts";
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
  SessionAction,
  SessionPreview,
  WorktreeDiscovery,
} from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import { messageCommand } from "../web/src/lib/composerControl.ts";
import { createDrafts, EMPTY_DRAFT, sessionDraftKey } from "../web/src/lib/messageDraft.ts";
import { createModelCatalogs } from "../web/src/lib/modelCatalogs.ts";
import { createPreviewObservation, seenPreview } from "../web/src/lib/previewObservation.ts";
import { sessionActivity, sessionPane } from "../web/src/lib/sessionContext.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { type AppState, initialState } from "../web/src/store.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-client-dispatch-")));
const cwd = join(root, "checkout");
mkdirSync(cwd);
mkdirSync(join(root, "sessions"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => rmSync(root, { recursive: true, force: true }));

const sent: ServerMessage[] = [];
let discovered: Queue.Queue<number> | undefined;
const discover = (_folder: string) =>
  Effect.sync((): WorktreeDiscovery => {
    if (discovered) Queue.offerUnsafe(discovered, sent.length);
    return { status: "non-git", observedAt: new Date().toISOString() };
  });

const app: SessionPreview = {
  instanceId: "i1",
  state: "running",
  ready: true,
  warming: false,
  url: "http://localhost:5173/",
  port: 5173,
  command: ["npm", "run", "dev"],
  detail: "",
  externalAccess: "same-host",
  observedAt: 0,
};

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
    | CreationAttempts
    | SessionStatus
    | Registry
    | Scope.Scope
  >,
  extraArgs: string[] = [],
  cli = new URL("./fake-pi.mjs", import.meta.url).pathname,
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
        cli,
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
      yield* yield* receive({ _tag: "directory", cwd: directory, requestId: "focus" });
      assert.equal((yield* facts.trust(directory)).trust.trusted, true);
      const reply = answers(from).find((m) => m._tag === "directory")!;
      assert.equal(reply.requestId, "focus");
      assert.equal(reply.result.status, "ready");
      if (reply.result.status === "ready") {
        assert.equal(reply.result.catalog.error, undefined);
        assert.deepEqual(reply.result.trust, { required: true, trusted: true });
      }
    }),
    ["--remember-project-trust"],
  );
});

test("a failed automatic catalog still answers with trust and releases admission", async () => {
  await run(
    Effect.gen(function* () {
      const { receive } = yield* client;
      const from = sent.length;
      yield* yield* receive({
        _tag: "directory",
        cwd: join(root, "absent"),
        requestId: "failed-probe",
      });
      const reply = answers(from).find((m) => m._tag === "directory")!;
      assert.equal(reply.requestId, "failed-probe");
      assert.equal(reply.result.status, "ready");
      if (reply.result.status === "ready") {
        assert.ok(reply.result.catalog.error);
        assert.deepEqual(reply.result.catalog.models, []);
        assert.equal(typeof reply.result.trust.trusted, "boolean");
      }
      const held = [];
      for (let n = 0; n < inboundLimits.client.messages; n++)
        held.push(yield* receive({ _tag: "registry" }));
      for (const work of held) yield* work;
      assert.equal(
        answers(from).some((m) => m._tag === "error"),
        false,
      );
    }),
  );
});

test("INV-02/05: cold cross-directory focus cannot fill admission while saved selections advance", async () => {
  await run(
    Effect.gen(function* () {
      const directories = Array.from({ length: 5 }, (_, n) => join(root, `cold-focus-${n}`));
      for (const [n, directory] of directories.entries()) {
        mkdirSync(directory);
        const sessionId = `cold-${n}`;
        writeFileSync(
          join(root, "sessions", `${sessionId}.jsonl`),
          [
            {
              type: "session",
              version: 3,
              id: sessionId,
              cwd: directory,
              timestamp: "2026-10-05T00:00:00Z",
            },
            {
              type: "message",
              id: "m",
              parentId: null,
              timestamp: "2026-10-05T00:00:01Z",
              message: { role: "user", content: `History ${sessionId}`, timestamp: 1 },
            },
          ]
            .map((entry) => JSON.stringify(entry))
            .join("\n") + "\n",
        );
        yield* (yield* Registry).addSession(directory, sessionId);
      }
      const requests: ClientRequest[] = [];
      const replies: ServerMessage[] = [];
      let handlers: ConnectionHandlers | undefined;
      const browser = createClient({
        initial: initialState,
        connect: (h) => {
          handlers = h;
          return {
            send: (m) => {
              if (m._tag !== "ack") requests.push(m);
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
        send: (m) =>
          Effect.sync(() => {
            replies.push(m);
            handlers!.onMessage(m);
          }),
        overflow: (e) => Effect.die(e),
      });
      const held: Effect.Effect<void>[] = [];
      for (const n of [0, 1, 0, 2, 3, 4, 1]) {
        browser.select(directories[n], `cold-${n}`);
        while (requests.length) {
          const request = requests.shift()!;
          const work = yield* dispatch.receive(request);
          if (request._tag === "select") yield* work;
          else held.push(work);
        }
        assert.equal(
          browser.getState().session?.sessionId,
          `cold-${n}`,
          "latest saved conversation opens despite pending focus reads",
        );
      }
      assert.equal(
        replies.some((m) => "message" in m && /capacity is full/.test(m.message)),
        false,
      );
      assert.equal(held.length, 1, "one active automatic observation, not one pair per key");
      yield* held[0];
      assert.equal(requests.length, 1, "only the latest unsent directory is observed");
      yield* yield* dispatch.receive(requests.shift()!);
      assert.equal(requests.length, 0);
      assert.equal(browser.getState().session?.sessionId, "cold-1");
      assert.match(JSON.stringify(browser.getState().session?.messages), /History cold-1/);
      assert.ok(browser.getState().catalogs[directories[1]]?.models.length);
      assert.ok(browser.getState().trusts[directories[1]]);
      assert.equal(
        Object.keys(browser.getState().catalogs).length,
        2,
        "obsolete directories never probe",
      );
    }),
  );
});

test("INV-02/05: superseded navigation is bounded during startup and the latest selection opens", async () => {
  await run(
    Effect.gen(function* () {
      const first = yield* registered("navigation-first");
      const last = yield* registered("navigation-last");
      const showing = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const replies: ServerMessage[] = [];
      const { receive } = yield* makeClientDispatch({
        send: (m) =>
          Effect.gen(function* () {
            replies.push(m);
            if (m._tag === "selected" && m.selectionId === "first") {
              yield* Deferred.succeed(showing, undefined);
              yield* Deferred.await(release);
            }
          }),
        overflow: (e) => Effect.die(e),
      });
      const startup = [];
      for (let n = 0; n < 6; n++)
        startup.push(yield* receive({ _tag: "directory", cwd, requestId: `startup-${n}` }));
      const opening = yield* (yield* receive({
        _tag: "select",
        cwd,
        sessionId: first.spec.sessionId,
        selectionId: "first",
      })).pipe(Effect.forkChild);
      yield* Deferred.await(showing);
      const pending = [];
      for (let n = 0; n < 32; n++)
        pending.push(
          yield* receive({
            _tag: "select",
            cwd,
            sessionId: last.spec.sessionId,
            selectionId: `next-${n}`,
          }),
        );
      yield* yield* receive({ _tag: "save_project", project: { id: "refused", name: "Refused" } });
      assert.equal(replies.filter((m) => m._tag === "selection_rejected").length, 0);
      assert.ok(replies.some((m) => m._tag === "error" && /capacity/.test(m.message)));
      yield* yield* receive({ _tag: "ping", nonce: "during-navigation" });
      assert.ok(replies.some((m) => m._tag === "pong" && m.nonce === "during-navigation"));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(opening);
      for (const work of pending) yield* work;
      for (const work of startup) yield* work;
      assert.deepEqual(
        replies.filter((m) => m._tag === "selected").map((m) => m.selectionId),
        ["first", "next-31"],
      );
      assert.equal(replies.filter((m) => m._tag === "selection_failed").length, 0);
      assert.equal(
        (yield* (yield* Registry).get).projects.some((p) => p.id === "refused"),
        false,
      );
      yield* yield* receive({
        _tag: "act",
        selectionId: "next-31",
        action: { _tag: "set_thinking_level", level: "high" },
      });
      assert.equal((yield* last.state).thinkingLevel, "high");
      assert.notEqual((yield* first.state).thinkingLevel, "high");
      const available = [];
      for (let n = 0; n < inboundLimits.client.messages; n++)
        available.push(yield* receive({ _tag: "registry" }));
      assert.equal(replies.filter((m) => m._tag === "error").length, 1);
      for (const work of available) yield* work;
    }),
  );
});

const holdingStarts = () => {
  const audit = join(mkdtempSync(join(root, "holding-starts-")), "audit.jsonl");
  writeFileSync(audit, "");
  const spawned = () =>
    readFileSync(audit, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; pid: number })
      .filter((r) => r.event === "spawn");
  return {
    launched: Effect.gen(function* () {
      for (let n = 0; spawned().length === 0; n++) {
        if (n > 250) return yield* Effect.die(new Error("Pi never launched"));
        yield* Effect.sleep("20 millis");
      }
    }),
    release: Effect.sync(() => {
      for (const { pid } of spawned()) {
        try {
          process.kill(pid, "SIGCONT");
        } catch {}
      }
    }),
    extraArgs: ["--audit", audit, "--hold-readiness"],
    cli: new URL("./fake-host-pi.mjs", import.meta.url).pathname,
  };
};

const shownBeforeRelease = (
  replies: ReadonlyArray<ServerMessage>,
  selectionId: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    for (let n = 0; n < 100; n++) {
      if (replies.some((m) => m._tag === "selected" && m.selectionId === selectionId)) return true;
      yield* Effect.sleep("20 millis");
    }
    return false;
  });

test("INV-05: a reconnect's reconcile waiting on a held creation does not delay a newer selection", async () => {
  const held = holdingStarts();
  await run(
    Effect.gen(function* () {
      yield* (yield* Registry).addSession(cwd, "saved-b");
      const creator = yield* makeClientDispatch({
        send: () => Effect.void,
        overflow: (e) => Effect.die(e),
      });
      const creating = yield* (yield* creator.receive({
        _tag: "create_session",
        selectionId: "creating",
        cwd,
        options: {},
        attemptId: "held-attempt",
      })).pipe(Effect.forkChild);
      yield* held.launched;
      const replies: ServerMessage[] = [];
      const { receive } = yield* makeClientDispatch({
        send: (m) => Effect.sync(() => void replies.push(m)),
        overflow: (e) => Effect.die(e),
      });
      const reconciling = yield* (yield* receive({
        _tag: "select",
        cwd,
        sessionId: null,
        attemptId: "held-attempt",
        selectionId: "reconcile",
      })).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const selecting = yield* (yield* receive({
        _tag: "select",
        cwd,
        sessionId: "saved-b",
        selectionId: "b",
      })).pipe(Effect.forkChild);
      assert.ok(
        yield* shownBeforeRelease(replies, "b"),
        "B was shown while the creation it superseded was still starting",
      );
      yield* held.release;
      yield* Fiber.join(creating);
      yield* Fiber.join(reconciling);
      yield* Fiber.join(selecting);
      assert.deepEqual(
        replies
          .filter((m) => "selectionId" in m && m.selectionId !== undefined)
          .map((m) => [m._tag, "selectionId" in m && m.selectionId]),
        [["selected", "b"]],
        "the superseded reconcile answers nothing",
      );
    }).pipe(Effect.ensuring(held.release)),
    held.extraArgs,
    held.cli,
  );
});

test("INV-05: selecting a session whose Pi is still starting does not delay a newer selection", async () => {
  const held = holdingStarts();
  await run(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.addSession(cwd, "starting-a");
      yield* registry.addSession(cwd, "saved-b");
      const starting = yield* (yield* SessionHosts)
        .open({ cwd, sessionId: "starting-a" })
        .pipe(Effect.forkChild);
      yield* held.launched;
      const replies: ServerMessage[] = [];
      const { receive } = yield* makeClientDispatch({
        send: (m) => Effect.sync(() => void replies.push(m)),
        overflow: (e) => Effect.die(e),
      });
      const first = yield* (yield* receive({
        _tag: "select",
        cwd,
        sessionId: "starting-a",
        selectionId: "a",
      })).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const second = yield* (yield* receive({
        _tag: "select",
        cwd,
        sessionId: "saved-b",
        selectionId: "b",
      })).pipe(Effect.forkChild);
      assert.ok(
        yield* shownBeforeRelease(replies, "b"),
        "B was shown while A's Pi was still starting",
      );
      yield* held.release;
      yield* Fiber.join(starting);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.deepEqual(
        replies.filter((m) => m._tag === "selected").map((m) => m.selectionId),
        ["b"],
        "the superseded selection answers nothing",
      );
      yield* yield* receive({ _tag: "select", cwd, sessionId: "starting-a", selectionId: "a2" });
      assert.ok(
        replies.some((m) => m._tag === "selected" && m.selectionId === "a2" && m.hosted),
        "A's lock was left usable",
      );
    }).pipe(Effect.ensuring(held.release)),
    held.extraArgs,
    held.cli,
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
        const refreshes = () => requests.filter((m) => m._tag === "models");
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
      const sessionId = "admitted-retry";
      browser.select(cwd, sessionId);
      const first = requests.find((m) => m._tag === "select")!;
      yield* yield* dispatch.receive(first);
      assert.equal(browser.getState().selecting, null);
      assert.equal(browser.getState().selectionId, null);
      assert.ok(browser.getState().selectionFailure?.message);
      assert.equal(requests.filter((m) => m._tag === "select").length, 1, "no automatic retry");
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
        yield* yield* receive({
          _tag: "set_trust",
          requestId: "trust-1",
          path: cwd,
          trusted: true,
        });
        const [toast, trust, models, ...rest] = answers(from);
        assert.ok(toast?._tag === "toast" && toast.level === "success");
        assert.match(toast.message, /^Trusted\./);
        assert.deepEqual(trust, {
          _tag: "trust",
          cwd,
          trust: { required: true, trusted: true },
          requestId: "trust-1",
        });
        assert.equal(models?._tag, "models");
        assert.deepEqual(rest, []);
      }),
    );
  } finally {
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
  }
});

test("a models request always asks Pi again, even after a directory read cached the catalog", async () => {
  await run(
    Effect.gen(function* () {
      const { receive } = yield* client;
      const from = sent.length;
      yield* yield* receive({ _tag: "directory", cwd, requestId: "cached" });
      yield* yield* receive({ _tag: "models", cwd, requestId: "fresh" });
      const replies = answers(from);
      const directory = replies.find((m) => m._tag === "directory");
      const models = replies.find((m) => m._tag === "models");
      assert.ok(directory?.result.status === "ready", JSON.stringify(directory));
      assert.ok(models?._tag === "models" && models.requestId === "fresh", JSON.stringify(models));
      assert.notEqual(models.catalog.fetchedAt, directory.result.catalog.fetchedAt);
    }),
  );
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
      yield* yield* receive({
        _tag: "set_trust",
        requestId: "untrust-1",
        path: directory,
        trusted: false,
      });
      const replies = answers(from);
      const final = yield* facts.trust(directory);
      assert.equal(final.trust.trusted, true, "the extension saved trust during reload");
      assert.deepEqual(
        replies.find((m) => m._tag === "trust"),
        {
          _tag: "trust",
          ...final,
          requestId: "untrust-1",
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

const refusals: {
  readonly [K in ClientRequest["_tag"]]: readonly [Extract<ClientRequest, { _tag: K }>, unknown];
} = {
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
    { _tag: "selection_rejected", selectionId: "s2", inputId: "s2", message: "REFUSED" },
  ],
  session_status: [
    { _tag: "session_status", requestId: "st1", target: { sessionId: "x" } },
    { _tag: "session_status", requestId: "st1", result: { status: "error", detail: "REFUSED" } },
  ],
  act: [
    { _tag: "act", selectionId: "s3", action: { _tag: "prompt", text: "hi" } },
    { _tag: "error", message: "REFUSED", selectionId: "s3" },
  ],
  registry: [{ _tag: "registry" }, { _tag: "error", message: "REFUSED" }],
  directory: [
    { _tag: "directory", cwd, requestId: "focus" },
    { _tag: "directory", cwd, requestId: "focus", result: { status: "error", message: "REFUSED" } },
  ],
  models: [
    { _tag: "models", cwd, requestId: "m" },
    { _tag: "models_failed", cwd, requestId: "m", message: "REFUSED" },
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
  set_project_done: [
    { _tag: "set_project_done", id: "p", done: true },
    { _tag: "error", message: "REFUSED" },
  ],
  remove_folder: [
    { _tag: "remove_folder", path: cwd },
    { _tag: "error", message: "REFUSED" },
  ],
  set_trust: [
    { _tag: "set_trust", requestId: "t1", path: cwd, trusted: true },
    { _tag: "trust_failed", requestId: "t1", cwd, message: "REFUSED" },
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
  unarchive_session: [
    { _tag: "unarchive_session", cwd, sessionId: "x", requestId: "u1" },
    {
      _tag: "data_controls_result",
      requestId: "u1",
      result: { status: "error", detail: "REFUSED" },
    },
  ],
  archive_all_sessions: [
    { _tag: "archive_all_sessions", requestId: "a1" },
    {
      _tag: "data_controls_result",
      requestId: "a1",
      result: { status: "error", detail: "REFUSED" },
    },
  ],
  archive_sessions_count: [
    { _tag: "archive_sessions_count", requestId: "c1" },
    {
      _tag: "data_controls_result",
      requestId: "c1",
      result: { status: "error", detail: "REFUSED" },
    },
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
        {
          _tag: "selection_rejected",
          selectionId: "new",
          inputId: "new",
          message: `Not a directory: ${missing}`,
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
    done: { _tag: "set_project_done", id: "next", done: true },
    toast: "Project marked done",
    fails: [{ _tag: "set_project_done", id: "missing", done: true }, /Project is unavailable/],
  },
  {
    done: { _tag: "set_project_done", id: "next", done: false },
    toast: "Project reopened",
    fails: [{ _tag: "set_project_done", id: "missing", done: false }, /Project is unavailable/],
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

test("PIN-152: Data controls returns actual counts, clears an archived selection and confirms closed folders truthfully", async () => {
  await run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.addFolder(cwd);
      for (const id of ["saved", "pinned", "live"]) yield* r.addSession(cwd, id);
      yield* r.pinSession(cwd, "pinned", true);
      yield* (yield* SessionHosts).open({ cwd, sessionId: "live" });
      const { receive } = yield* client;
      yield* yield* receive({ _tag: "select", cwd, sessionId: "saved", selectionId: "saved-view" });
      let from = sent.length;
      yield* yield* receive({ _tag: "archive_sessions_count", requestId: "count" });
      assert.deepEqual(answers(from), [
        { _tag: "data_controls_result", requestId: "count", result: { status: "ready", count: 1 } },
      ]);
      from = sent.length;
      yield* yield* receive({ _tag: "archive_all_sessions", requestId: "archive" });
      const result = answers(from);
      assert.ok(
        result.some(
          (m) => m._tag === "selected" && m.selectionId === "saved-view" && m.sessionId === null,
        ),
      );
      assert.deepEqual(
        result.filter((m) => m._tag !== "selected"),
        [
          {
            _tag: "data_controls_result",
            requestId: "archive",
            result: { status: "ready", count: 1 },
          },
          { _tag: "toast", level: "success", message: "1 sessions archived" },
        ],
      );
      for (const closed of [false, true]) {
        if (closed) {
          yield* r.archiveSession(cwd, "saved");
          yield* r.removeFolder(cwd);
        }
        from = sent.length;
        yield* yield* receive({
          _tag: "unarchive_session",
          cwd,
          sessionId: "saved",
          requestId: "restore",
        });
        assert.deepEqual(answers(from), [
          {
            _tag: "data_controls_result",
            requestId: "restore",
            result: { status: "ready", count: 1 },
          },
          {
            _tag: "toast",
            level: "success",
            message: closed ? "Session unarchived · Folder remains closed" : "Session unarchived",
          },
        ]);
      }
      from = sent.length;
      yield* yield* receive({
        _tag: "unarchive_session",
        cwd,
        sessionId: "saved",
        requestId: "invalid",
      });
      assert.deepEqual(answers(from), [
        {
          _tag: "data_controls_result",
          requestId: "invalid",
          result: {
            status: "error",
            detail: "Session reference is unavailable. Refresh and try again.",
          },
        },
      ]);
      assert.deepEqual((yield* r.get).folders, []);
    }),
  );
});

const archiveRace = (options: { startsClosingHost?: boolean } = {}) =>
  Effect.gen(function* () {
    const session = yield* registered(`pin-132-${++databases}`);
    const { sessionId } = session.spec;
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
    const hosts = yield* SessionHosts;
    const a = yield* makeClientDispatch({
      send: (m) => Effect.sync(() => handlers!.onMessage(m)),
      overflow: (e) => Effect.die(e),
    }).pipe(
      Effect.provideService(
        SessionHosts,
        options.startsClosingHost
          ? { ...hosts, start: () => Effect.succeed({ session, launched: false }) }
          : hosts,
      ),
    );
    const b = yield* makeClientDispatch({
      send: () => Effect.void,
      overflow: (e) => Effect.die(e),
    });
    const drafts = createDrafts();
    drafts.follow(browser, () => {});
    const key = sessionDraftKey({ cwd, sessionId });
    browser.select(cwd, sessionId);
    yield* yield* a.receive(requests.find((m) => m._tag === "select")!);
    assert.equal(browser.getState().session?.sessionId, sessionId);
    const until = (ready: () => boolean) =>
      Effect.gen(function* () {
        while (!ready()) yield* Effect.sleep("5 millis");
      });
    const send = () => {
      const before = requests.length;
      assert.equal(
        drafts.submit(key, (message, inputId) =>
          browser.send(messageCommand("follow-up", message, {}, inputId)),
        ),
        true,
        "the transport accepted the send",
      );
      const act = requests.slice(before).find((m) => m._tag === "act");
      assert.ok(act?._tag === "act");
      return act;
    };
    const archive = Effect.gen(function* () {
      yield* yield* b.receive({ _tag: "archive_session", cwd, sessionId });
      yield* until(() => browser.getState().sessionReferences.some((r) => r.archived));
    });
    return { browser, a, drafts, key, send, archive, requests: () => requests };
  });

test("PIN-132: once a browser hears its session is archived, it keeps the draft and sends nothing", async () => {
  await run(
    Effect.gen(function* () {
      const { browser, drafts, key, archive } = yield* archiveRace();
      drafts.setText(key, "Keep me");
      assert.equal(sessionPane(browser.getState()).composerDisabled, false);
      yield* archive;
      assert.equal(sessionPane(browser.getState()).composerDisabled, true);
      assert.equal(sessionActivity(browser.getState(), false).status, "Archived");
      assert.equal(drafts.get(key).text, "Keep me");
    }),
  );
});

test("PIN-132: a follow-up refused as archived after the socket took it returns to the draft ahead of newer edits", async () => {
  await run(
    Effect.gen(function* () {
      const { browser, a, drafts, key, send, archive } = yield* archiveRace();
      drafts.setText(key, "Submitted");
      drafts.addQuote(key, "Quoted");
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
      yield* Effect.promise(() =>
        drafts.addImages(key, [new File([png], "shot.png", { type: "image/png" })], async () =>
          Buffer.from(png).toString("base64"),
        ),
      );
      const images = drafts.get(key).images.items;
      assert.equal(images.length, 1);
      const act = send();
      assert.equal(drafts.sendable(key), false, "the composer clears on transport acceptance");
      drafts.setText(key, "Typed while waiting");
      drafts.addQuote(key, "Quoted later");
      yield* archive;
      yield* yield* a.receive(act);
      assert.deepEqual(
        [drafts.get(key).text, drafts.get(key).quotes],
        ["Submitted\n\nTyped while waiting", ["Quoted", "Quoted later"]],
      );
      assert.equal(sessionPane(browser.getState()).composerDisabled, true);
      yield* yield* a.receive(act);
      assert.equal(drafts.get(key).text, "Submitted\n\nTyped while waiting", "restored once");
    }),
  );
});

test("PIN-132: a follow-up Piano accepts clears its draft and never comes back", async () => {
  await run(
    Effect.gen(function* () {
      const { browser, a, drafts, key, send } = yield* archiveRace();
      drafts.setText(key, "Reply with exactly: X");
      const act = send();
      yield* yield* a.receive(act);
      assert.ok(act.action._tag === "prompt" && act.action.inputId);
      assert.equal(browser.getState().session?.state.submission?.inputId, act.action.inputId);
      assert.deepEqual(drafts.get(key), EMPTY_DRAFT);
    }),
  );
});

test("PIN-132: a follow-up its host refuses while another browser archives the session returns to the draft", async () => {
  await run(
    Effect.gen(function* () {
      const { browser, a, drafts, key, send, archive, requests } = yield* archiveRace({
        startsClosingHost: true,
      });
      drafts.setText(key, "Submitted");
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
      yield* Effect.promise(() =>
        drafts.addImages(key, [new File([png], "shot.png", { type: "image/png" })], async () =>
          Buffer.from(png).toString("base64"),
        ),
      );
      const act = send();
      drafts.setText(key, "Typed while waiting");
      const errors: ServerMessage[] = [];
      const stop = browser.listen((m) => {
        if (m._tag === "error") errors.push(m);
      });
      yield* archive;
      yield* yield* a.receive(act);
      stop();
      assert.ok(act.action._tag === "prompt");
      assert.deepEqual(
        errors.map((m) => m._tag === "error" && m.inputId),
        [act.action.inputId],
        "the host refused the input before Pi saw it, naming it",
      );
      assert.equal(drafts.get(key).text, "Submitted\n\nTyped while waiting");
      assert.deepEqual(
        drafts.get(key).images.items.map((i) => i.name),
        ["shot.png"],
      );
      assert.equal(sessionPane(browser.getState()).composerDisabled, true);
      assert.equal(requests().filter((m) => m._tag === "act").length, 1, "nothing is sent again");
    }),
  );
});

test("INV-03: a first message its new session refuses before Pi sees it reads not sent, not uncertain", async () => {
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
      const hosts = yield* SessionHosts;
      const dispatch = yield* makeClientDispatch({
        send: (m) => Effect.sync(() => handlers!.onMessage(m)),
        overflow: (e) => Effect.die(e),
      }).pipe(
        Effect.provideService(SessionHosts, {
          ...hosts,
          create: (spec) =>
            hosts.create(spec).pipe(
              Effect.map((session) => ({
                ...session,
                act: (action: SessionAction) =>
                  hosts
                    .archive(session.spec.cwd, session.spec.sessionId)
                    .pipe(Effect.orDie, Effect.andThen(session.act(action))),
              })),
            ),
        }),
      );
      const errors: ServerMessage[] = [];
      browser.listen((m) => {
        if (m._tag === "error") errors.push(m);
      });
      browser.send({ _tag: "create_session", cwd, options: {}, text: "Reply with exactly: X" });
      const create = requests.find((m) => m._tag === "create_session");
      assert.ok(create?._tag === "create_session");
      yield* yield* dispatch.receive(create);
      assert.deepEqual(
        errors.map((m) => m._tag === "error" && m.inputId),
        [create.selectionId],
        "the refusal names the first message",
      );
      const shown = browser.getState().session;
      assert.ok(shown?.sessionId);
      assert.deepEqual(
        errors.map((m) => m._tag === "error" && [m.cwd, m.sessionId]),
        [[shown.cwd, shown.sessionId]],
        "and the session that was created, where the message belongs",
      );
      assert.equal(browser.getState().pendingCreate?.outcome, "not_sent");
    }),
  );
});
