/** Node 24's WebSocket accepts Undici's options, including an explicit Origin header. */
import type { SocketEnvironment } from "../../web/src/lib/ws.ts";

export interface DispatchConfiguration {
  url: string;
  origin: string;
}

/** Only launch configuration supplies the endpoint; tool arguments cannot redirect it. */
export function dispatchConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): DispatchConfiguration | undefined {
  if (!env.PIANO_SESSION_WS_URL || !env.PIANO_SESSION_ORIGIN) return undefined;
  try {
    const url = new URL(env.PIANO_SESSION_WS_URL);
    const origin = new URL(env.PIANO_SESSION_ORIGIN);
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/ws" ||
      url.search ||
      url.hash ||
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== env.PIANO_SESSION_ORIGIN
    )
      return undefined;
    return { url: url.href, origin: origin.origin };
  } catch {
    return undefined;
  }
}

export function nodeSocketEnvironment(config: DispatchConfiguration): SocketEnvironment {
  return {
    url: () => config.url,
    nonce: () => crypto.randomUUID(),
    open: (url, events) => {
      // The shared browser transport brings DOM typings into this program; its constructor
      // declaration omits Node's supported options overload (covered by DispatchSocket.test).
      const NodeWebSocket = WebSocket as unknown as {
        new (url: string, options: { headers: Record<string, string> }): WebSocket;
      };
      const socket = new NodeWebSocket(url, { headers: { Origin: config.origin } });
      socket.onopen = () => events.open();
      socket.onclose = (event) => events.close(event.code);
      socket.onerror = () => events.error();
      socket.onmessage = (event) => events.message(String(event.data));
      return {
        isOpen: () => socket.readyState === WebSocket.OPEN,
        send: (data) => socket.send(data),
        close: () => socket.close(),
      };
    },
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    onOnline: () => () => {},
    onOffline: () => () => {},
  };
}
