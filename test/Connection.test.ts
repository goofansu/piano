import assert from "node:assert/strict";
import { test } from "node:test";
import { type ClientMessage, encodeServerMessage, type ServerMessage } from "../shared/wire.ts";
import {
  type DisconnectReason,
  openConnection,
  type SocketEnvironment,
  type SocketEvents,
} from "../web/src/lib/ws.ts";

/** A socket the test plays the server for: it accepts, sends frames and closes. */
interface FakeSocket {
  url: string;
  sent: ClientMessage[];
  closed: boolean;
  accept: () => void;
  frame: (message: ServerMessage, deliveryId: number) => void;
  serverClose: (code: number) => void;
}

/** A connection over fake sockets, a clock the test advances and network events it fires. */
function harness(onDisconnect?: () => void) {
  let now = 0;
  let ids = 0;
  let nonces = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const online = new Set<() => void>();
  const offline = new Set<() => void>();
  const sockets: FakeSocket[] = [];
  const statuses: Array<[boolean, DisconnectReason?]> = [];
  const messages: ServerMessage[] = [];
  const env: SocketEnvironment = {
    open: (url: string, events: SocketEvents) => {
      let open = false;
      const socket: FakeSocket = {
        url,
        sent: [],
        closed: false,
        accept: () => {
          open = true;
          events.open();
        },
        frame: (message, deliveryId) => events.message(encodeServerMessage(message, deliveryId)),
        serverClose: (code) => {
          open = false;
          events.close(code);
        },
      };
      sockets.push(socket);
      return {
        isOpen: () => open && !socket.closed,
        send: (data) => {
          if (!open || socket.closed) throw new Error("socket is not open");
          socket.sent.push(JSON.parse(data) as ClientMessage);
        },
        close: () => {
          socket.closed = true;
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
    onOnline: (listener) => {
      online.add(listener);
      return () => online.delete(listener);
    },
    onOffline: (listener) => {
      offline.add(listener);
      return () => offline.delete(listener);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...timers]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].run();
    }
    now = until;
  };
  const connection = openConnection(
    {
      onMessage: (m) => messages.push(m),
      onStatus: (connected, reason) => {
        statuses.push(reason === undefined ? [connected] : [connected, reason]);
        if (!connected) onDisconnect?.();
      },
    },
    env,
  );
  const last = () => sockets.at(-1)!;
  const acks = (socket: FakeSocket) =>
    socket.sent.flatMap((m) => (m._tag === "ack" ? [m.deliveryId] : []));
  const pings = (socket: FakeSocket) =>
    socket.sent.flatMap((m) => (m._tag === "ping" ? [m.nonce] : []));
  /** The delivered frames, named by the session each `hosts` frame carries. */
  const delivered = () =>
    messages.map((m) => (m._tag === "hosts" ? m.hosts[0]!.sessionId : m._tag));
  return {
    connection,
    sockets,
    statuses,
    delivered,
    advance,
    last,
    acks,
    pings,
    pendingTimers: () => timers.size,
    goOnline: () => {
      for (const listener of [...online]) listener();
    },
    goOffline: () => {
      for (const listener of [...offline]) listener();
    },
    listeners: () => online.size + offline.size,
  };
}

const hosts = (n: number): ServerMessage => ({
  _tag: "hosts",
  hosts: [{ cwd: `/scratch/${n}`, sessionId: `s${n}`, streaming: false }],
});

test("INV-05: frames are acked and delivered in deliveryId order on the environment's URL", () => {
  const h = harness();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.last().url, "ws://piano.test/ws");
  h.last().accept();
  assert.deepEqual(h.statuses, [[true]]);
  h.last().frame(hosts(1), 1);
  h.last().frame(hosts(2), 2);
  assert.deepEqual(h.delivered(), ["s1", "s2"]);
  assert.deepEqual(h.acks(h.last()), [1, 2]);
});

test("INV-05: a duplicate or older deliveryId is acked but not delivered again", () => {
  const h = harness();
  h.last().accept();
  h.last().frame(hosts(1), 1);
  h.last().frame(hosts(2), 2);
  h.last().frame(hosts(2), 2);
  h.last().frame(hosts(1), 1);
  assert.deepEqual(h.delivered(), ["s1", "s2"]);
  assert.deepEqual(h.acks(h.last()), [1, 2, 2, 1]);
  assert.deepEqual(h.statuses, [[true]], "a repeat is not a reason to reconnect");
});

test("INV-05: a deliveryId gap drops the socket and reconnects after 2 s with fresh counters", (t) => {
  t.mock.method(console, "warn", () => {});
  const h = harness();
  const first = h.last();
  first.accept();
  first.frame(hosts(1), 1);
  first.frame(hosts(3), 3);
  assert.deepEqual(h.delivered(), ["s1"], "a frame after a gap is not delivered");
  assert.deepEqual(h.statuses, [[true], [false]]);
  assert.ok(first.closed);
  h.advance(1999);
  assert.equal(h.sockets.length, 1);
  h.advance(1);
  assert.equal(h.sockets.length, 2);
  h.last().accept();
  h.last().frame(hosts(4), 1);
  assert.deepEqual(h.delivered(), ["s1", "s4"]);
  assert.deepEqual(h.acks(h.last()), [1]);
  assert.deepEqual(h.statuses, [[true], [false], [true]]);
});

test("INV-02: only the pong for the latest ping keeps the socket alive", () => {
  const h = harness();
  const socket = h.last();
  socket.accept();
  const [nonce] = h.pings(socket);
  assert.ok(nonce, "an open socket is probed at once");
  h.advance(7000);
  socket.frame({ _tag: "pong", nonce: "stale" }, 1);
  socket.frame(hosts(1), 2);
  h.advance(999);
  assert.deepEqual(h.statuses, [[true]]);
  h.advance(1);
  assert.deepEqual(h.statuses, [[true], [false]], "8 s without the matching pong is a lost socket");
  assert.ok(socket.closed);
});

test("INV-02: a matching pong schedules the next ping, whose deadline streaming does not extend", () => {
  const h = harness();
  const socket = h.last();
  socket.accept();
  h.advance(7000);
  socket.frame({ _tag: "pong", nonce: h.pings(socket)[0]! }, 1);
  h.advance(4999);
  assert.equal(h.pings(socket).length, 1);
  h.advance(1);
  assert.equal(h.pings(socket).length, 2, "the next ping goes 5 s after the pong");
  for (let n = 2; n < 9; n++) {
    h.advance(1000);
    socket.frame(hosts(n), n);
  }
  h.advance(999);
  assert.deepEqual(h.statuses, [[true]]);
  h.advance(1);
  assert.deepEqual(h.statuses, [[true], [false]]);
});

test("a socket stuck connecting is dropped at 10 s and replaced", () => {
  const h = harness();
  const stuck = h.last();
  h.advance(9999);
  assert.equal(stuck.closed, false);
  h.advance(1);
  assert.ok(stuck.closed);
  assert.deepEqual(h.statuses, [[false]]);
  h.advance(2000);
  assert.equal(h.sockets.length, 2);
  h.last().accept();
  assert.deepEqual(h.statuses, [[false], [true]]);
});

test("close 1013 reports falling behind and reconnects; 1009 reports the size limit and stays closed", () => {
  const behind = harness();
  behind.last().accept();
  behind.last().serverClose(1013);
  assert.deepEqual(behind.statuses, [[true], [false, "behind"]]);
  behind.advance(2000);
  assert.equal(behind.sockets.length, 2);

  const tooLarge = harness();
  tooLarge.last().accept();
  tooLarge.last().serverClose(1009);
  assert.deepEqual(tooLarge.statuses, [[true], [false, "too-large"]]);
  tooLarge.advance(60_000);
  tooLarge.goOffline();
  tooLarge.goOnline();
  tooLarge.connection.send({ _tag: "ping", nonce: "after-fatal-loss" });
  assert.equal(
    tooLarge.sockets.length,
    1,
    "neither timers nor network changes recover a fatal loss",
  );
  assert.equal(tooLarge.pendingTimers(), 0);
  assert.equal(tooLarge.listeners(), 0, "fatal loss releases the connection's network listeners");
  tooLarge.connection.close();
  assert.deepEqual(tooLarge.statuses, [[true], [false, "too-large"]]);
});

test("any other close is a plain loss that reconnects", () => {
  const h = harness();
  h.last().accept();
  h.last().serverClose(1006);
  assert.deepEqual(h.statuses, [[true], [false]]);
  h.advance(2000);
  assert.equal(h.sockets.length, 2);
});

test("sending on a socket that is not open starts recovery instead of throwing", () => {
  const h = harness();
  const connecting = h.last();
  h.connection.send({ _tag: "ping", nonce: "early" });
  assert.deepEqual(connecting.sent, []);
  assert.ok(connecting.closed);
  assert.deepEqual(h.statuses, [[false]]);
  h.advance(2000);
  h.last().accept();
  h.connection.send({ _tag: "ping", nonce: "later" });
  assert.ok(h.last().sent.some((m) => m._tag === "ping" && m.nonce === "later"));
});

test("going offline drops the socket at once; coming online reconnects without waiting", () => {
  const h = harness();
  const first = h.last();
  first.accept();
  h.goOffline();
  assert.ok(first.closed);
  assert.deepEqual(h.statuses, [[true], [false]]);
  h.goOnline();
  assert.equal(h.sockets.length, 2);
  h.advance(2000);
  assert.equal(h.sockets.length, 2, "the pending retry was replaced, not added to");
  h.goOnline();
  assert.equal(h.sockets.length, 2, "online with a socket in hand opens no other");
});

test("closing from a disconnect handler leaves no reconnect timer behind", () => {
  const h = harness(() => h.connection.close());
  h.last().accept();
  h.last().serverClose(1006);
  assert.equal(h.pendingTimers(), 0);
  assert.equal(h.listeners(), 0);
  h.advance(60_000);
  assert.equal(h.sockets.length, 1);
});

test("close() stops timers, network listeners and reconnects, and ignores the old socket", () => {
  const h = harness();
  const socket = h.last();
  socket.accept();
  h.connection.close();
  assert.ok(socket.closed);
  assert.equal(h.pendingTimers(), 0);
  assert.equal(h.listeners(), 0);
  socket.serverClose(1013);
  socket.frame(hosts(1), 1);
  h.advance(60_000);
  assert.equal(h.sockets.length, 1);
  assert.deepEqual(h.statuses, [[true]]);
  assert.deepEqual(h.delivered(), []);
});
