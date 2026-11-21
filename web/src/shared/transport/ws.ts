import { MAX_MESSAGE_BYTES } from "../../../../shared/session/attachments.ts";
import {
  type ConnectionHandlers,
  type SocketEnvironment,
  openConnection as connect,
} from "../../../../shared/transport/ws.ts";

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
  frameBytes: MAX_MESSAGE_BYTES,
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

export const openConnection = (
  handlers: ConnectionHandlers,
  environment = browserSocketEnvironment,
) => connect(handlers, environment);
