import {
  type ClientMessage,
  type DisconnectReason,
  decodeServerMessage,
  disconnectReason,
  encodeClientMessage,
  type ServerMessage,
} from "../../../shared/wire.ts";
import { LOCAL, machineFrameBytes, machineSocketUrl } from "./machine.ts";

export type SendDisposition = "not-sent" | "sent" | "uncertain";

export interface Connection {
  send: (m: ClientMessage) => SendDisposition;
  close: () => void;
}

export type { DisconnectReason };

export interface ConnectionHandlers {
  onMessage: (m: ServerMessage) => void;
  onStatus: (connected: boolean, reason?: DisconnectReason) => void;
}

export interface SocketEvents {
  open: () => void;
  close: (code: number) => void;
  error: () => void;
  message: (data: string) => void;
}

export interface SocketLike {
  isOpen: () => boolean;
  send: (data: string) => void;
  close: () => void;
}

export interface SocketEnvironment {
  open: (url: string, events: SocketEvents) => SocketLike;
  url: () => string;
  frameBytes: number;
  nonce: () => string;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  onOnline: (listener: () => void) => () => void;
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
  url: () => machineSocketUrl(LOCAL.id),
  frameBytes: machineFrameBytes(LOCAL.id),
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

const CONNECT_TIMEOUT = 10_000;
const PING_INTERVAL = 5_000;
const PONG_TIMEOUT = 8_000;
const RECONNECT_DELAY = 2_000;

const fits = (data: string, limit: number) =>
  data.length * 3 <= limit ||
  (data.length <= limit && new TextEncoder().encode(data).byteLength <= limit);

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
    let ws: SocketLike | null = null;
    const current = () => !closed && ws !== null && socket.current === ws;
    const lost = (code?: number) => {
      if (!current() || !ws) return;
      socket.current = null;
      env.clearTimeout(heartbeat);
      const reason = code === undefined ? undefined : disconnectReason(code);
      if (reason === "too-large") close();
      handlers.onStatus(false, reason);
      ws.close();
      if (closed) return;
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
          lost();
        }
      },
    });
    socket.current = ws;
    recover.current = lost;
    heartbeat = env.setTimeout(lost, CONNECT_TIMEOUT);
  };
  const stopOffline = env.onOffline(() => recover.current());
  const stopOnline = env.onOnline(() => {
    if (!socket.current) {
      env.clearTimeout(timer);
      connect();
    }
  });
  const close = () => {
    if (closed) return;
    closed = true;
    env.clearTimeout(timer);
    env.clearTimeout(heartbeat);
    stopOffline();
    stopOnline();
    recover.current = () => {};
    socket.current?.close();
    socket.current = null;
  };
  connect();
  return {
    send: (m) => {
      const ws = socket.current;
      let data: string;
      try {
        data = encodeClientMessage(m);
      } catch (err) {
        console.warn("unencodable client message", err);
        return "not-sent";
      }
      if (!fits(data, env.frameBytes)) {
        console.warn("client message exceeds the machine's frame limit");
        return "not-sent";
      }
      try {
        if (!ws?.isOpen()) {
          recover.current();
          return "not-sent";
        }
        ws.send(data);
        return "sent";
      } catch {
        recover.current();
        return "uncertain";
      }
    },
    close,
  };
}
