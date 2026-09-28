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
      ws.onopen = () => handlers.current.onStatus(true);
      ws.onclose = () => {
        handlers.current.onStatus(false);
        if (!closed) timer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          handlers.current.onMessage(decodeServerMessage(String(e.data)));
        } catch (err) {
          console.warn("bad server message", err);
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
