import {
  connectableHost,
  type Listener,
  sessionLinkOrigin,
} from "../../../server/shared/OriginPolicy.ts";
import { isLoopbackHostname } from "../../../shared/loopback.ts";
import {
  type LaunchEnv,
  SESSION_ORIGIN,
  SESSION_WS_URL,
} from "../../../shared/session/dispatch.ts";

export interface SessionEndpoint {
  readonly wsUrl: string;
  readonly origin: string;
}

export function sessionEndpoint(
  listener: Listener,
  origins: ReadonlySet<string>,
): SessionEndpoint | undefined {
  const host = connectableHost(listener.host);
  if (!isLoopbackHostname(host)) return undefined;
  const authority = `${host}:${listener.port}`;
  const origin = sessionLinkOrigin(origins, listener);
  if (origin === undefined) return undefined;
  return { wsUrl: `ws://${authority}/ws`, origin };
}

export const sessionEnvironment = (endpoint: SessionEndpoint): LaunchEnv => ({
  [SESSION_WS_URL]: endpoint.wsUrl,
  [SESSION_ORIGIN]: endpoint.origin,
});
