/**
 * The extension's session dispatch over fake sockets: what it sends, when it stops observing and
 * what it is willing to claim. The risks these cover are the ones a tool call cannot recover
 * from: a second session created for one request, an answer attributed to the wrong input, a
 * session reported finished while Pi still has work, and a connection or timer left behind.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type SessionHandle, startSession, waitSessions } from "../extensions/SessionDispatch.ts";
import {
  type ClientMessage,
  encodeServerMessage,
  type RenderMsg,
  type ServerMessage,
  type SessionEvent,
  type SessionState,
  type Snapshot,
} from "../shared/wire.ts";
import type { SocketEnvironment, SocketEvents } from "../web/src/lib/ws.ts";

/** Nothing here waits on anything real; a test that does is broken, not slow. */
const bounded = { timeout: 5_000 };

const asked = "/scratch/repo/";
/** Piano answers with its own spelling of the directory. */
const cwd = "/scratch/repo";
const sessionId = "sess-1";

interface FakeSocket {
  readonly sent: ClientMessage[];
  readonly accept: () => void;
  readonly frame: (message: ServerMessage) => void;
  readonly serverClose: (code: number) => void;
  readonly isClosed: () => boolean;
  /** The selection the client is currently awaiting a reply for. */
  readonly selection: () => string;
}

/** Sockets the test plays Piano on, a clock it advances and the pongs that keep sockets alive. */
function world() {
  let now = 0;
  let ids = 0;
  let nonces = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const sockets: FakeSocket[] = [];
  const pending: Array<{ nonce: string; deliver: (message: ServerMessage) => void }> = [];
  const env: SocketEnvironment = {
    open: (_url: string, events: SocketEvents) => {
      let open = false;
      let closed = false;
      let delivered = 0;
      const sent: ClientMessage[] = [];
      const frame = (message: ServerMessage) => {
        if (!open || closed) return;
        events.message(encodeServerMessage(message, ++delivered));
      };
      sockets.push({
        sent,
        accept: () => {
          open = true;
          events.open();
        },
        frame,
        serverClose: (code) => {
          open = false;
          events.close(code);
        },
        isClosed: () => closed,
        selection: () => {
          const last = [...sent]
            .reverse()
            .find((m) => m._tag === "select" || m._tag === "create_session");
          assert.ok(last, "the client has not asked for a selection");
          return last.selectionId;
        },
      });
      return {
        isOpen: () => open && !closed,
        send: (data) => {
          // A closed WebSocket drops what it is handed; only sending before OPEN is an error.
          if (closed) return;
          if (!open) throw new Error("socket is not open");
          const message = JSON.parse(data) as ClientMessage;
          sent.push(message);
          // Answered on the next clock step, never inside the client's own send.
          if (message._tag === "ping") pending.push({ nonce: message.nonce, deliver: frame });
        },
        close: () => {
          closed = true;
        },
      };
    },
    url: () => "ws://piano.test/ws",
    nonce: () => `n${++nonces}`,
    setTimeout: (run, ms) => {
      const id = ++ids;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
    onOnline: () => () => {},
    onOffline: () => () => {},
  };
  const pong = () => {
    for (const ping of pending.splice(0)) ping.deliver({ _tag: "pong", nonce: ping.nonce });
  };
  /** Runs due timers in order, keeping every socket's heartbeat answered as time passes. */
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      pong();
      const next = [...timers]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].run();
    }
    pong();
    now = until;
  };
  return {
    env,
    sockets,
    advance,
    last: () => sockets.at(-1)!,
    pendingTimers: () => timers.size,
    sentOf: <K extends ClientMessage["_tag"]>(tag: K) =>
      sockets.flatMap((socket) =>
        socket.sent.filter((m): m is Extract<ClientMessage, { _tag: K }> => m._tag === tag),
      ),
  };
}

/** Lets already-resolved promise callbacks run without advancing the clock. */
const settleMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

const message = (
  id: string,
  role: RenderMsg["role"],
  text: string,
  over: Partial<RenderMsg> = {},
): RenderMsg => ({ id, role, text, ...over });

const snapshotOf = (
  state: Partial<SessionState> = {},
  messages: ReadonlyArray<RenderMsg> = [],
  dialogs: Snapshot["dialogs"] = [],
): Snapshot => ({ state: { sessionId, isStreaming: false, ...state }, messages, dialogs });

const selected = (
  selectionId: string,
  snapshot: Snapshot,
  options: { generation?: string; hosted?: boolean; sequence?: number } = {},
): ServerMessage => ({
  _tag: "selected",
  selectionId,
  cwd,
  sessionId,
  hosted: options.hosted ?? true,
  cursor: {
    cwd,
    sessionId,
    generation: options.generation ?? "g1",
    sequence: options.sequence ?? 1,
  },
  snapshot,
});

const frameOf = (
  selectionId: string,
  event: SessionEvent,
  options: { generation?: string; sequence?: number } = {},
): ServerMessage => ({
  _tag: "session",
  selectionId,
  cursor: {
    cwd,
    sessionId,
    generation: options.generation ?? "g1",
    sequence: options.sequence ?? 2,
  },
  event,
});

const dialog = (over: Partial<Snapshot["dialogs"][number]> = {}) => ({
  id: "d1",
  generation: "g1",
  receivedAt: 0,
  deadlineAt: 1,
  deadlineKind: "pi-timeout" as const,
  method: "confirm" as const,
  message: "Run the migration?",
  ...over,
});

/** Obtain handles through the public start contract, not the private attribution algorithm. */
const handleOf = async (
  baseline: ReadonlyArray<RenderMsg> = [],
  anchorMessageId: string | null = null,
  prompt = "do the thing",
): Promise<SessionHandle> => {
  const h = world();
  const start = startSession({ cwd, prompt }, h.env);
  h.last().accept();
  const socket = h.last();
  socket.frame(selected(socket.selection(), snapshotOf({}, baseline)));
  socket.frame(
    frameOf(socket.selection(), { _tag: "submission", submission: { id: 1, outcome: "started" } }),
  );
  const result = await start;
  assert.ok(result.handle);
  return { ...result.handle, anchorMessageId };
};

/** The transcript of one answered prompt, on an empty baseline. */
const answered = (
  text = "the thing is done",
  over: Partial<RenderMsg> = {},
): ReadonlyArray<RenderMsg> => [
  message("m1", "user", "do the thing"),
  message("m2", "assistant", text, over),
];

const idle = (messages: ReadonlyArray<RenderMsg>, state: Partial<SessionState> = {}) =>
  snapshotOf({ isQuiescent: true, submission: { id: 1, outcome: "started" }, ...state }, messages);

// ── Starting ────────────────────────────────────────────────────────────────

test(
  "a start creates one session, carries the prompt once and keeps Piano's own facts",
  bounded,
  async () => {
    const h = world();
    const baseline = [message("m1", "context", "startup")];
    const start = startSession(
      { cwd: asked, prompt: "do the thing", model: "p/m", thinkingLevel: "high" },
      h.env,
    );
    h.last().accept();
    const socket = h.last();
    socket.frame(selected(socket.selection(), snapshotOf({}, baseline)));
    socket.frame(
      frameOf(socket.selection(), {
        _tag: "submission",
        submission: { id: 1, outcome: "started" },
      }),
    );
    const result = await start;
    const creations = h.sentOf("create_session");
    assert.equal(creations.length, 1);
    assert.deepEqual(
      { cwd: creations[0]!.cwd, text: creations[0]!.text, options: creations[0]!.options },
      { cwd: asked, text: "do the thing", options: { model: "p/m", thinkingLevel: "high" } },
    );
    assert.equal(result.creation, "created");
    assert.equal(result.submission, "started");
    assert.ok(result.handle);
    assert.equal(result.handle.cwd, cwd, "the handle uses Piano's spelling, not the caller's");
    assert.equal(result.handle.sessionId, sessionId);
    assert.equal(result.handle.generation, "g1");
    assert.equal(result.handle.submissionId, 1);
    assert.equal(result.handle.baselineMessages, 1);
    assert.equal(result.handle.anchorMessageId, null);
    assert.ok(socket.isClosed(), "the start closes its own connection");
    assert.equal(h.pendingTimers(), 0, "and clears its timers");
  },
);

test("a start records the message Pi logged for its prompt", bounded, async () => {
  const h = world();
  const start = startSession({ cwd: asked, prompt: "do the thing" }, h.env);
  h.last().accept();
  const socket = h.last();
  socket.frame(selected(socket.selection(), snapshotOf()));
  socket.frame(
    frameOf(socket.selection(), {
      _tag: "message_end",
      message: message("m1", "user", "do the thing"),
    }),
  );
  socket.frame(
    frameOf(
      socket.selection(),
      { _tag: "submission", submission: { id: 1, outcome: "started" } },
      { sequence: 3 },
    ),
  );
  const result = await start;
  assert.equal(result.handle?.anchorMessageId, "m1");
});

test("a refused creation names nothing and claims nothing", bounded, async () => {
  const h = world();
  const start = startSession({ cwd: asked, prompt: "hi" }, h.env);
  h.last().accept();
  const socket = h.last();
  socket.frame({
    _tag: "selection_rejected",
    selectionId: socket.selection(),
    message: "Client input capacity is full.",
  });
  const result = await start;
  assert.deepEqual(
    { creation: result.creation, submission: result.submission, handle: result.handle },
    { creation: "refused", submission: "not_sent", handle: null },
  );
});

test("a dialog on the first prompt returns the handle at once", bounded, async () => {
  const h = world();
  const start = startSession({ cwd: asked, prompt: "migrate" }, h.env);
  h.last().accept();
  const socket = h.last();
  socket.frame(selected(socket.selection(), snapshotOf()));
  socket.frame(frameOf(socket.selection(), { _tag: "dialog", dialog: dialog() }));
  const result = await start;
  assert.equal(result.submission, "waiting_for_input");
  assert.equal(result.handle?.sessionId, sessionId, "the session exists and can be waited on");
  assert.match(result.detail ?? "", /Run the migration\?/);
  assert.equal(h.pendingTimers(), 0, "it does not sit on the start deadline");
});

test(
  "a loss before Pi names the session leaves creation uncertain and creates nothing twice",
  bounded,
  async () => {
    const h = world();
    const start = startSession({ cwd: asked, prompt: "hi" }, h.env);
    h.last().accept();
    h.last().serverClose(1006);
    const result = await start;
    assert.equal(result.creation, "uncertain");
    assert.equal(result.handle, null);
    // Give the transport every chance to reconnect and repeat the mutation.
    h.advance(10_000);
    assert.equal(h.sentOf("create_session").length, 1, "the prompt is created at most once");
    assert.deepEqual(
      h.sentOf("create_session")[0]!.options,
      {},
      "omitted options keep normal defaults",
    );
    assert.equal(h.sockets.length, 1, "a settled start opens no further sockets");
    assert.equal(h.pendingTimers(), 0);
  },
);

test("a loss after Pi names the session only re-selects, by Piano's cwd", bounded, async () => {
  const h = world();
  const start = startSession({ cwd: asked, prompt: "hi" }, h.env);
  h.last().accept();
  const first = h.last();
  first.frame(selected(first.selection(), snapshotOf()));
  first.frame(
    frameOf(first.selection(), {
      _tag: "submission",
      submission: { id: 1, outcome: "submitting" },
    }),
  );
  first.serverClose(1006);
  h.advance(2_000);
  const second = h.last();
  assert.notEqual(second, first, "the transport reconnected");
  second.accept();
  const reattach = second.sent.filter((m) => m._tag !== "ping" && m._tag !== "ack");
  assert.deepEqual(
    reattach.map((m) => m._tag),
    ["select"],
    "a reconnect re-attaches by identity and never repeats the creation",
  );
  assert.equal(reattach[0]!._tag === "select" ? reattach[0]!.cwd : null, cwd);
  second.frame(
    selected(
      second.selection(),
      snapshotOf({ submission: { id: 1, outcome: "started" }, isStreaming: true }),
    ),
  );
  const result = await start;
  assert.equal(result.submission, "started");
  assert.equal(result.handle?.submissionId, 1);
  assert.equal(h.sentOf("create_session").length, 1);
});

test(
  "a restart before the acknowledgement is uncertain, not an invented receipt",
  bounded,
  async () => {
    const h = world();
    const start = startSession({ cwd: asked, prompt: "hi" }, h.env);
    h.last().accept();
    const first = h.last();
    first.frame(selected(first.selection(), snapshotOf()));
    first.frame(
      frameOf(first.selection(), {
        _tag: "submission",
        submission: { id: 1, outcome: "submitting" },
      }),
    );
    first.serverClose(1006);
    h.advance(2_000);
    const second = h.last();
    second.accept();
    second.frame(
      selected(second.selection(), snapshotOf({ submission: { id: 1, outcome: "started" } }), {
        generation: "g2",
      }),
    );
    const result = await start;
    assert.equal(result.submission, "uncertain");
    assert.match(result.detail ?? "", /restarted/i);
  },
);

// ── Waiting ─────────────────────────────────────────────────────────────────

test(
  "a wait settles from a first snapshot that is already idle and quiescent",
  bounded,
  async () => {
    const h = world();
    const baseline = [message("c1", "context", "startup")];
    const wait = waitSessions([await handleOf(baseline)], undefined, h.env);
    h.last().accept();
    const socket = h.last();
    socket.frame(socketSnapshot(socket, idle([...baseline, ...answered()])));
    const [observation] = await wait;
    assert.equal(observation!.status, "settled");
    assert.equal(observation!.ending, "observed");
    assert.equal(observation!.answer, "the thing is done");
    assert.equal(observation!.attribution, "attributed");
    assert.equal(h.sentOf("select").length, 1, "a fresh quiescent snapshot needs no recheck");
    assert.ok(socket.isClosed());
    assert.equal(h.pendingTimers(), 0);
  },
);

function socketSnapshot(socket: FakeSocket, snapshot: Snapshot, options = {}) {
  return selected(socket.selection(), snapshot, options);
}

test(
  "input Pi handled without assistant output answers nothing rather than something",
  bounded,
  async () => {
    const h = world();
    const wait = waitSessions([await handleOf([], null, "/compact")], undefined, h.env);
    h.last().accept();
    const socket = h.last();
    socket.frame(
      socketSnapshot(
        socket,
        idle([message("m1", "user", "/compact")], { submission: { id: 1, outcome: "handled" } }),
      ),
    );
    const [observation] = await wait;
    assert.equal(observation!.status, "settled");
    assert.equal(observation!.answer, null);
    assert.equal(observation!.attribution, "no-output");
  },
);

test(
  "an open dialog is reported as waiting for input, not as a finished session",
  bounded,
  async () => {
    const h = world();
    const wait = waitSessions([await handleOf()], undefined, h.env);
    h.last().accept();
    const socket = h.last();
    socket.frame(
      socketSnapshot(
        socket,
        snapshotOf({ submission: { id: 1, outcome: "started" } }, [], [dialog()]),
      ),
    );
    const [observation] = await wait;
    assert.equal(observation!.status, "waiting_for_input");
    assert.equal(observation!.answer, null);
    assert.match(observation!.detail ?? "", /Run the migration\?/);
  },
);

test("a reply that failed with no text to show is still read as a failure", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  const socket = h.last();
  socket.frame(
    socketSnapshot(socket, idle(answered("", { isError: true, errorMessage: "provider refused" }))),
  );
  const [observation] = await wait;
  assert.equal(observation!.status, "failed");
  assert.match(observation!.detail ?? "", /refused/);
});

test("an interrupted reply is cancelled, whatever error it also carries", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  const socket = h.last();
  socket.frame(
    socketSnapshot(
      socket,
      idle(answered("", { stopReason: "aborted", isError: true, errorMessage: "aborted by user" })),
    ),
  );
  const [observation] = await wait;
  assert.equal(observation!.status, "cancelled");
});

for (const exit of [
  { code: 1, completed: false, status: "failed" },
  { code: 0, completed: false, status: "unknown" },
  { code: 0, completed: true, status: "settled" },
] as const)
  test(
    `Pi exiting with ${exit.code} after ${exit.completed ? "a" : "no"} completed response is ${exit.status}`,
    bounded,
    async () => {
      const h = world();
      const wait = waitSessions([await handleOf()], undefined, h.env);
      h.last().accept();
      const socket = h.last();
      const selection = socket.selection();
      socket.frame(
        selected(
          selection,
          snapshotOf({ isStreaming: true, submission: { id: 1, outcome: "started" } }, answered()),
        ),
      );
      let sequence = 1;
      if (exit.completed)
        socket.frame(frameOf(selection, { _tag: "response_completed" }, { sequence: ++sequence }));
      socket.frame(
        frameOf(
          selection,
          {
            _tag: "closed",
            closure: {
              _tag: "exited",
              code: exit.code,
              detail: `Pi exited with code ${exit.code}`,
            },
          },
          { sequence: ++sequence },
        ),
      );
      const [observation] = await wait;
      assert.equal(observation!.status, exit.status);
    },
  );

test("quiescence is confirmed from a fresh selection after a run drains", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  let resolved = false;
  void wait.then(() => {
    resolved = true;
  });
  h.last().accept();
  const socket = h.last();
  const selection = socket.selection();
  socket.frame(
    selected(
      selection,
      snapshotOf(
        { isStreaming: true, isQuiescent: false, submission: { id: 1, outcome: "started" } },
        [message("m1", "user", "do the thing")],
      ),
    ),
  );
  let sequence = 1;
  for (const event of [
    { _tag: "message_end", message: message("m2", "assistant", "the thing is done") },
    {
      _tag: "state",
      state: { sessionId, isStreaming: false, submission: { id: 1, outcome: "started" } },
    },
    { _tag: "response_completed" },
  ] satisfies SessionEvent[])
    socket.frame(frameOf(selection, event, { sequence: ++sequence }));
  await settleMicrotasks();
  assert.equal(resolved, false, "live terminal events alone do not prove the host is finished");
  h.advance(250);
  assert.equal(h.sentOf("select").length, 2, "the wait re-selects for a fresh snapshot");
  socket.frame(socketSnapshot(socket, idle(answered())));
  const [observation] = await wait;
  assert.equal(observation!.status, "settled");
  assert.equal(observation!.answer, "the thing is done");
  assert.equal(h.pendingTimers(), 0);
});

test(
  "a host that never reports quiescence is reported as still running, after bounded rechecks",
  bounded,
  async () => {
    const h = world();
    const wait = waitSessions([await handleOf()], undefined, h.env);
    h.last().accept();
    const socket = h.last();
    const busy = () =>
      socket.frame(socketSnapshot(socket, idle(answered(), { isQuiescent: false })));
    busy();
    for (let recheck = 0; recheck < 3; recheck++) {
      h.advance(250);
      busy();
    }
    const [observation] = await wait;
    assert.equal(observation!.status, "running");
    assert.match(observation!.detail ?? "", /pending work/i);
    assert.equal(h.sentOf("select").length, 4, "rechecks are bounded");
  },
);

for (const change of ["generation", "submission", "prefix", "later input", "history"] as const)
  test(`output is not attributed after a changed ${change}`, bounded, async () => {
    const h = world();
    const baseline = [message("c1", "context", "startup")];
    const wait = waitSessions([await handleOf(baseline, "m1")], undefined, h.env);
    h.last().accept();
    const socket = h.last();
    const transcript = [
      change === "prefix" ? message("c9", "context", "compacted") : baseline[0]!,
      ...answered(),
      ...(change === "later input" ? [message("m3", "user", "and this too")] : []),
    ];
    socket.frame(
      socketSnapshot(
        socket,
        idle(transcript, {
          // A mismatch must be reported even while the session is still working.
          isStreaming: true,
          isQuiescent: false,
          submission: { id: change === "submission" ? 2 : 1, outcome: "started" },
        }),
        {
          generation: change === "generation" ? "g2" : "g1",
          hosted: change !== "history",
        },
      ),
    );
    const [observation] = await wait;
    assert.equal(observation!.answer, null);
    assert.equal(observation!.attribution, "unattributable");
    assert.equal(observation!.status, "unknown", "a session that is no longer ours ends the wait");
  });

test(
  "a projection failure ends the wait instead of waiting out the deadline",
  bounded,
  async () => {
    const h = world();
    const wait = waitSessions([await handleOf()], undefined, h.env);
    h.last().accept();
    const socket = h.last();
    socket.frame(
      socketSnapshot(
        socket,
        snapshotOf({
          isStreaming: true,
          submission: { id: 1, outcome: "started" },
          projectionError: "Pi sent a record Piano could not project",
        }),
      ),
    );
    const [observation] = await wait;
    assert.equal(observation!.status, "unknown");
    assert.match(observation!.detail ?? "", /could not project/);
  },
);

test("an answer already observed survives later input to the same session", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  const socket = h.last();
  const selection = socket.selection();
  socket.frame(
    selected(
      selection,
      snapshotOf({ isStreaming: true, submission: { id: 1, outcome: "started" } }, answered()),
    ),
  );
  socket.frame(frameOf(selection, { _tag: "response_completed" }, { sequence: 2 }));
  socket.frame(
    frameOf(
      selection,
      {
        _tag: "state",
        state: { sessionId, isStreaming: false, submission: { id: 1, outcome: "started" } },
      },
      { sequence: 3 },
    ),
  );
  h.advance(250);
  // Someone sent the session a new prompt while the wait was confirming quiescence.
  socket.frame(
    socketSnapshot(
      socket,
      idle([...answered(), message("m3", "user", "something else")], {
        submission: { id: 2, outcome: "started" },
      }),
    ),
  );
  const [observation] = await wait;
  assert.equal(observation!.answer, "the thing is done", "what was observed is not retracted");
  assert.equal(observation!.attribution, "attributed");
  assert.equal(observation!.status, "unknown", "interference prevented the quiescence check");
});

test("a session too large to hold is reported, not held", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  const socket = h.last();
  const huge = Array.from({ length: 5_001 }, (_, index) =>
    message(`m${index}`, index % 2 === 0 ? "user" : "assistant", "x"),
  );
  socket.frame(socketSnapshot(socket, idle(huge)));
  const [observation] = await wait;
  assert.equal(observation!.status, "unknown");
  assert.match(observation!.detail ?? "", /larger than/i);
  assert.equal(observation!.answer, null);
});

test("a gap in the session's frames is re-read, never folded over", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  const socket = h.last();
  socket.frame(
    selected(
      socket.selection(),
      snapshotOf({ isStreaming: true, submission: { id: 1, outcome: "started" } }),
    ),
  );
  socket.frame(
    frameOf(
      socket.selection(),
      { _tag: "message_end", message: message("m2", "assistant", "the thing is done") },
      { sequence: 4 },
    ),
  );
  h.advance(500);
  assert.equal(h.sentOf("select").length, 2, "a gap re-attaches for a whole snapshot");
  socket.frame(socketSnapshot(socket, idle(answered())));
  const [observation] = await wait;
  assert.equal(observation!.status, "settled");
  assert.equal(observation!.answer, "the thing is done");
});

test("a wait reconnects by selecting only, and never replays a mutation", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  const first = h.last();
  first.frame(
    selected(
      first.selection(),
      snapshotOf({ isStreaming: true, submission: { id: 1, outcome: "started" } }),
    ),
  );
  first.serverClose(1006);
  h.advance(2_000);
  const second = h.last();
  second.accept();
  second.frame(socketSnapshot(second, idle(answered())));
  const [observation] = await wait;
  assert.equal(observation!.status, "settled");
  assert.equal(observation!.answer, "the thing is done");
  assert.deepEqual(
    h.sockets.flatMap((socket) =>
      socket.sent.map((m) => m._tag).filter((tag) => tag !== "ping" && tag !== "ack"),
    ),
    ["select", "select"],
    "observation only ever selects",
  );
});

test("each waited handle keeps its own connection, deadline and result", bounded, async () => {
  const h = world();
  const quick = { ...(await handleOf()), sessionId: "quick" };
  const quiet = { ...(await handleOf()), sessionId: "quiet" };
  const wait = waitSessions([quick, quiet], undefined, h.env);
  assert.equal(h.sockets.length, 2, "one connection per waited handle");
  const [first, second] = h.sockets;
  first!.accept();
  second!.accept();
  first!.frame(socketSnapshot(first!, idle(answered())));
  await settleMicrotasks();
  assert.ok(first!.isClosed(), "a settled handle releases its connection at once");
  assert.ok(!second!.isClosed(), "while the other keeps observing");
  h.advance(30_000);
  const [done, waiting] = await wait;
  assert.equal(done!.status, "settled");
  assert.equal(done!.ending, "observed");
  assert.equal(done!.answer, "the thing is done");
  assert.equal(waiting!.ending, "deadline", "the deadline is reported apart from the status");
  assert.equal(waiting!.answer, null);
  assert.equal(h.pendingTimers(), 0);
});

test("a wait below the floor still observes for a second", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], 5, h.env);
  let resolved = false;
  void wait.then(() => {
    resolved = true;
  });
  h.last().accept();
  h.advance(900);
  await settleMicrotasks();
  assert.equal(resolved, false, "a wait is never shorter than a second");
  h.advance(200);
  const [observation] = await wait;
  assert.equal(observation!.ending, "deadline");
});

test("an abort ends observation and leaves the session alone", bounded, async () => {
  const h = world();
  const controller = new AbortController();
  const wait = waitSessions([await handleOf()], undefined, h.env, controller.signal);
  h.last().accept();
  const socket = h.last();
  socket.frame(
    selected(
      socket.selection(),
      snapshotOf({ isStreaming: true, submission: { id: 1, outcome: "started" } }),
    ),
  );
  controller.abort();
  const [observation] = await wait;
  assert.equal(observation!.ending, "aborted");
  assert.equal(observation!.status, "running");
  assert.equal(h.sentOf("act").length, 0, "observation never stops or aborts Pi");
  assert.ok(socket.isClosed());
  assert.equal(h.pendingTimers(), 0);
});

test("compaction of a fresh session cannot silently restore attribution", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  h.last().frame(
    socketSnapshot(
      h.last(),
      idle([
        message("m0", "context", "A compacted conversation with missing inputs"),
        ...answered(),
      ]),
    ),
  );
  const [result] = await wait;
  assert.equal(result!.status, "unknown");
  assert.equal(result!.answer, null);
});

for (const replacement of ["baseline", "input"] as const) {
  test(
    `reused positional message ids cannot hide replaced ${replacement} text`,
    bounded,
    async () => {
      const h = world();
      const baseline = [message("m0", "context", "original startup")];
      const handle = await handleOf(baseline);
      const wait = waitSessions([handle], undefined, h.env);
      h.last().accept();
      h.last().frame(
        socketSnapshot(
          h.last(),
          idle([
            replacement === "baseline"
              ? message("m0", "context", "replacement startup")
              : baseline[0]!,
            message("m1", "user", replacement === "input" ? "different work" : "do the thing"),
            message("m2", "assistant", "not safely attributable"),
          ]),
        ),
      );
      const [result] = await wait;
      assert.equal(result!.status, "unknown");
      assert.equal(result!.answer, null);
    },
  );
}

test("late startup output before the initial user message is not its answer", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  h.last().frame(
    socketSnapshot(
      h.last(),
      idle([
        message("m0", "assistant", "startup output", { stopReason: "stop" }),
        message("m1", "user", "do the thing"),
      ]),
    ),
  );
  const [result] = await wait;
  assert.equal(result!.answer, null);
  assert.equal(result!.status, "unknown");
});

test("an empty final answer never falls back to earlier tool-use prose", bounded, async () => {
  const h = world();
  const wait = waitSessions([await handleOf()], undefined, h.env);
  h.last().accept();
  h.last().frame(
    socketSnapshot(
      h.last(),
      idle([
        message("m0", "user", "do the thing"),
        message("m1", "assistant", "checking files", { stopReason: "toolUse" }),
        message("m2", "assistant", "", { stopReason: "stop" }),
      ]),
    ),
  );
  const [result] = await wait;
  assert.equal(result!.status, "settled");
  assert.equal(result!.answer, null);
});

test(
  "intervention returns partial sibling observations promptly without stopping workers",
  bounded,
  async () => {
    const h = world();
    const handle = await handleOf();
    const wait = waitSessions([handle, handle], undefined, h.env);
    const [blocked, running] = h.sockets;
    blocked!.accept();
    running!.accept();
    running!.frame(
      socketSnapshot(
        running!,
        snapshotOf({ isStreaming: true, submission: { id: 1, outcome: "started" } }),
      ),
    );
    blocked!.frame(
      socketSnapshot(
        blocked!,
        snapshotOf({ submission: { id: 1, outcome: "started" } }, [], [dialog()]),
      ),
    );
    await settleMicrotasks();
    assert.ok(running!.isClosed(), "return immediately rather than waiting for the deadline");
    const results = await wait;
    assert.deepEqual(
      results.map((r) => r.status),
      ["waiting_for_input", "running"],
    );
    assert.ok(results.every((r) => r.ending === "observed"));
    assert.equal(h.sentOf("act").length, 0);
    assert.equal(h.pendingTimers(), 0);
  },
);
