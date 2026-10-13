/**
 * The browser's WebSocket transport (INV-02/05). It acks every frame it reads, delivers each
 * deliveryId once and in order, and reconnects for a current view rather than skipping a gap. A
 * socket counts as alive only while the pong for its latest ping arrives in time; one stuck
 * connecting is dropped too. Why it gave up is reported as data; the client decides what the
 * person is told. Nothing here depends on React.
 */
// Relative, not @shared: module tests load this file directly in Node.
import {
  type ClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  type ServerMessage,
} from "../../../shared/wire.ts";

export interface Connection {
  send: (m: ClientMessage) => void;
  close: () => void;
}

/**
 * Why a socket closed when the person should hear about it: the server dropped a reader that
 * fell behind (1013, reconnects), or a frame exceeded the delivery limit (1009, stays closed).
 */
export type DisconnectReason = "behind" | "too-large";

export interface ConnectionHandlers {
  onMessage: (m: ServerMessage) => void;
  onStatus: (connected: boolean, reason?: DisconnectReason) => void;
}

/** What a socket reports; `close` carries the close code. */
export interface SocketEvents {
  open: () => void;
  close: (code: number) => void;
  error: () => void;
  message: (data: string) => void;
}

export interface SocketLike {
  /** The socket can send and its frames count (`WebSocket.OPEN`). */
  isOpen: () => boolean;
  send: (data: string) => void;
  close: () => void;
}

/** Sockets, timers, network status, the URL and ping nonces, behind a seam so the policy runs in Node. */
export interface SocketEnvironment {
  open: (url: string, events: SocketEvents) => SocketLike;
  url: () => string;
  nonce: () => string;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  /** Subscribes to the browser going online; returns the unsubscribe function. */
  onOnline: (listener: () => void) => () => void;
  /** Subscribes to the browser going offline; returns the unsubscribe function. */
  onOffline: (listener: () => void) => () => void;
}

export const browserSocketEnvironment: SocketEnvironment = {
  open: (url, events) => {
    const ws = new WebSocket(url);
    ws.onopen = () => events.open();
    ws.onclose = (event) => events.close(event.code);
    ws.onerror = () => events.error();
    ws.onmessage = (event) => events.message(String(event.data));
    return {
      isOpen: () => ws.readyState === WebSocket.OPEN,
      send: (data) => ws.send(data),
      close: () => ws.close(),
    };
  },
  url: () => `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  nonce: () => crypto.randomUUID(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  onOnline: (listener) => {
    window.addEventListener("online", listener);
    return () => window.removeEventListener("online", listener);
  },
  onOffline: (listener) => {
    window.addEventListener("offline", listener);
    return () => window.removeEventListener("offline", listener);
  },
};

/** Milliseconds a socket may take to open. Mobile sockets can stick connecting. */
const CONNECT_TIMEOUT = 10_000;
/** Milliseconds after a matching pong before the next ping. */
const PING_INTERVAL = 5_000;
/** Milliseconds a ping waits for its pong. */
const PONG_TIMEOUT = 8_000;
/** Milliseconds between losing a socket and opening the next. */
const RECONNECT_DELAY = 2_000;

const reasons: Partial<Record<number, DisconnectReason>> = { 1013: "behind", 1009: "too-large" };

/** Auto-reconnecting WebSocket that speaks the shared wire schema. */
export function openConnection(
  handlers: ConnectionHandlers,
  env: SocketEnvironment = browserSocketEnvironment,
): Connection {
  const socket = { current: null as SocketLike | null };
  const recover = { current: () => {} };
  let timer: unknown;
  let heartbeat: unknown;
  let closed = false;
  const connect = () => {
    if (closed) return;
    let lastDeliveryId = 0;
    let nonce: string | null = null;
    // Assigned before any event can arrive: the browser only dispatches after this turn.
    let ws: SocketLike | null = null;
    const current = () => !closed && ws !== null && socket.current === ws;
    const lost = (code?: number) => {
      if (!current() || !ws) return;
      // A half-open socket may never finish its close handshake. Retire it now,
      // rather than waiting for onclose to disable actions and start recovery.
      socket.current = null;
      env.clearTimeout(heartbeat);
      const reason = code === undefined ? undefined : reasons[code];
      handlers.onStatus(false, reason);
      ws.close();
      if (reason === "too-large") return;
      timer = env.setTimeout(connect, RECONNECT_DELAY);
    };
    const probe = () => {
      if (!current() || !ws) return;
      nonce = env.nonce();
      try {
        ws.send(encodeClientMessage({ _tag: "ping", nonce }));
      } catch {
        lost();
        return;
      }
      // Only the matching pong proves that the outgoing path works. Streaming
      // frames must not extend this deadline (INV-02/05).
      heartbeat = env.setTimeout(lost, PONG_TIMEOUT);
    };
    ws = env.open(env.url(), {
      open: () => {
        if (!current()) return;
        env.clearTimeout(heartbeat);
        handlers.onStatus(true);
        probe();
      },
      close: (code) => lost(code),
      error: () => lost(),
      message: (data) => {
        if (!current() || !ws?.isOpen()) return;
        try {
          const message = decodeServerMessage(data);
          // Protect caller-only results (for example restored drafts) as well as
          // sequenced session frames. These counters reset with this socket.
          if (message.deliveryId > lastDeliveryId) {
            if (message.deliveryId !== lastDeliveryId + 1)
              throw new Error("Delivery gap; reconnecting for current state");
            lastDeliveryId = message.deliveryId;
            if (message._tag === "pong") {
              if (nonce !== null && message.nonce === nonce) {
                nonce = null;
                env.clearTimeout(heartbeat);
                heartbeat = env.setTimeout(probe, PING_INTERVAL);
              }
            } else handlers.onMessage(message);
          }
          ws.send(encodeClientMessage({ _tag: "ack", deliveryId: message.deliveryId }));
        } catch (err) {
          console.warn("bad server message", err);
          // A frame we cannot project cannot be silently skipped.
          lost();
        }
      },
    });
    socket.current = ws;
    recover.current = lost;
    // Bound connection establishment too: mobile sockets can stick CONNECTING.
    heartbeat = env.setTimeout(lost, CONNECT_TIMEOUT);
  };
  const stopOffline = env.onOffline(() => recover.current());
  const stopOnline = env.onOnline(() => {
    if (!socket.current) {
      env.clearTimeout(timer);
      connect();
    }
  });
  connect();
  return {
    send: (m) => {
      const ws = socket.current;
      try {
        if (!ws?.isOpen()) {
          recover.current();
          return;
        }
        ws.send(encodeClientMessage(m));
      } catch {
        recover.current();
      }
    },
    close: () => {
      closed = true;
      env.clearTimeout(timer);
      env.clearTimeout(heartbeat);
      stopOffline();
      stopOnline();
      recover.current = () => {};
      socket.current?.close();
      socket.current = null;
    },
  };
}
