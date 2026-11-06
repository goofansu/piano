/** Connects the dispatch tools to their launching Piano; no endpoint comes from tool input. */
import { SESSION_ORIGIN, SESSION_WS_URL } from "../../shared/dispatch.ts";
import { isLoopbackHostname } from "../../shared/loopback.ts";
import type { SocketEnvironment } from "../../web/src/lib/ws.ts";

export interface DispatchConfiguration {
  url: string;
  origin: string;
}

/** Only launch configuration supplies the endpoint; tool arguments cannot redirect it. */
export function dispatchConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): DispatchConfiguration | undefined {
  const wsUrl = env[SESSION_WS_URL];
  const configured = env[SESSION_ORIGIN];
  if (!wsUrl || !configured) return undefined;
  try {
    const url = new URL(wsUrl);
    const origin = new URL(configured);
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      !isLoopbackHostname(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/ws" ||
      url.search ||
      url.hash ||
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== configured
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
      // Node's WebSocket accepts Undici's options, including Origin, but the shared transport's
      // DOM typings omit that overload. DispatchSocket.test covers the runtime constructor.
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
