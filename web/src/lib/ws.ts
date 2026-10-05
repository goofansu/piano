import { useEffect, useRef, useState } from "react";
import { type ClientMessage, decodeServerMessage, encodeClientMessage, type ServerMessage } from "@shared/wire";

export interface Connection {
  send: (m: ClientMessage) => void;
}

/** Auto-reconnecting WebSocket that speaks the shared wire schema. */
export function useConnection(onMessage: (m: ServerMessage) => void, onStatus: (connected: boolean) => void): Connection {
  const socket = useRef<WebSocket | null>(null);
  const handlers = useRef({ onMessage, onStatus });
  handlers.current = { onMessage, onStatus };
  const [conn] = useState<Connection>(() => ({
    send: (m) => {
      const ws = socket.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encodeClientMessage(m));
    },
  }));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      socket.current = ws;
      let lastDeliveryId = 0;
      ws.onopen = () => { if (!closed && socket.current === ws) handlers.current.onStatus(true); };
      ws.onclose = (event) => {
        if (closed || socket.current !== ws) return;
        handlers.current.onStatus(false);
        if (event.code === 1013) handlers.current.onMessage({ _tag: "toast", level: "warning", message: "Connection fell behind. Reconnecting for a current view; some live notices may have been missed." });
        if (event.code === 1009) {
          handlers.current.onMessage({ _tag: "toast", level: "error", message: "Session view exceeds the delivery limit. Reduce its context before reloading." });
          return;
        }
        timer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        if (closed || socket.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        try {
          const message = decodeServerMessage(String(e.data));
          // Protect caller-only results (for example restored drafts) as well as
          // sequenced session frames. These counters reset with this socket.
          if (message.deliveryId > lastDeliveryId) {
            if (message.deliveryId !== lastDeliveryId + 1) throw new Error("Delivery gap; reconnecting for current state");
            lastDeliveryId = message.deliveryId;
            handlers.current.onMessage(message);
          }
          ws.send(encodeClientMessage({ _tag: "ack", deliveryId: message.deliveryId }));
        } catch (err) {
          console.warn("bad server message", err);
          // A frame we cannot project cannot be silently skipped.
          ws.close();
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, []);

  return conn;
}
