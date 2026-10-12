import {
  type ClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  type ServerMessage,
} from "@shared/wire";

export interface Connection {
  send: (m: ClientMessage) => void;
  close: () => void;
}

export interface ConnectionHandlers {
  onMessage: (m: ServerMessage) => void;
  onStatus: (connected: boolean) => void;
}

/** Auto-reconnecting WebSocket that speaks the shared wire schema. */
export function openConnection(handlers: ConnectionHandlers): Connection {
  const socket = { current: null as WebSocket | null };
  const recover = { current: () => {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const connect = () => {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    socket.current = ws;
    let lastDeliveryId = 0;
    let nonce: string | null = null;
    const lost = (code?: number) => {
      if (closed || socket.current !== ws) return;
      // A half-open socket may never finish its close handshake. Retire it now,
      // rather than waiting for onclose to disable actions and start recovery.
      socket.current = null;
      clearTimeout(heartbeat);
      handlers.onStatus(false);
      ws.close();
      if (code === 1013)
        handlers.onMessage({
          _tag: "toast",
          level: "warning",
          message:
            "Connection fell behind. Reconnecting for a current view; some live notices may have been missed.",
        });
      if (code === 1009) {
        handlers.onMessage({
          _tag: "toast",
          level: "error",
          message: "Session view exceeds the delivery limit. Reduce its context before reloading.",
        });
        return;
      }
      timer = setTimeout(connect, 2000);
    };
    recover.current = lost;
    const probe = () => {
      if (closed || socket.current !== ws) return;
      nonce = crypto.randomUUID();
      try {
        ws.send(encodeClientMessage({ _tag: "ping", nonce }));
      } catch {
        lost();
        return;
      }
      // Only the matching pong proves that the outgoing path works. Streaming
      // frames must not extend this deadline (INV-02/05).
      heartbeat = setTimeout(lost, 8000);
    };
    // Bound connection establishment too: mobile sockets can stick CONNECTING.
    heartbeat = setTimeout(lost, 10000);
    ws.onopen = () => {
      if (closed || socket.current !== ws) return;
      clearTimeout(heartbeat);
      handlers.onStatus(true);
      probe();
    };
    ws.onclose = (event) => lost(event.code);
    ws.onerror = () => lost();
    ws.onmessage = (e) => {
      if (closed || socket.current !== ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        const message = decodeServerMessage(String(e.data));
        // Protect caller-only results (for example restored drafts) as well as
        // sequenced session frames. These counters reset with this socket.
        if (message.deliveryId > lastDeliveryId) {
          if (message.deliveryId !== lastDeliveryId + 1)
            throw new Error("Delivery gap; reconnecting for current state");
          lastDeliveryId = message.deliveryId;
          if (message._tag === "pong") {
            if (nonce !== null && message.nonce === nonce) {
              nonce = null;
              clearTimeout(heartbeat);
              heartbeat = setTimeout(probe, 5000);
            }
          } else handlers.onMessage(message);
        }
        ws.send(encodeClientMessage({ _tag: "ack", deliveryId: message.deliveryId }));
      } catch (err) {
        console.warn("bad server message", err);
        // A frame we cannot project cannot be silently skipped.
        lost();
      }
    };
  };
  const offline = () => recover.current();
  const online = () => {
    if (!socket.current) {
      clearTimeout(timer);
      connect();
    }
  };
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  connect();
  return {
    send: (m) => {
      const ws = socket.current;
      try {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
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
      clearTimeout(timer);
      clearTimeout(heartbeat);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      recover.current = () => {};
      socket.current?.close();
      socket.current = null;
    },
  };
}
