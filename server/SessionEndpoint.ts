/**
 * How a Pi child reaches the Piano that spawned it.
 *
 * Piano's bundled session extension connects back over the same `/ws` the browser uses, and a
 * child has no browser to supply an address or an `Origin`. The launch therefore hands it both,
 * derived from this instance's listener and its configured origins — never from a request or
 * proxy header (INV-11). The origin is *chosen from* the allowed set rather than added to it, so
 * bootstrapping a child can never widen the policy `configuredOrigins` fixed at startup.
 *
 * The address names the listener, not a proxy: the child runs beside the server, so it reaches
 * the loopback port directly even when the only allowed origin is a public proxy origin.
 */
import { type LaunchEnv, SESSION_ORIGIN, SESSION_WS_URL } from "../shared/dispatch.ts";
import { isLoopbackHostname } from "../shared/loopback.ts";
import { connectableHost, type Listener, sessionLinkOrigin } from "./OriginPolicy.ts";

export interface SessionEndpoint {
  /** The WebSocket Piano already serves, addressed on the listener. */
  readonly wsUrl: string;
  /** The `sessionLinkOrigin`: the upgrade header, and the base of a `/s/<id>` link to the UI. */
  readonly origin: string;
}

/**
 * Undefined when no origin is configured: without one the child cannot pass the origin check,
 * and inventing an origin for it would be the policy change this function exists to prevent.
 */
export function sessionEndpoint(
  listener: Listener,
  origins: ReadonlySet<string>,
): SessionEndpoint | undefined {
  const host = connectableHost(listener.host);
  if (!isLoopbackHostname(host)) return undefined;
  const authority = `${host}:${listener.port}`;
  // Any allowed origin passes the upgrade check, so the one links use serves as the header too.
  const origin = sessionLinkOrigin(origins, listener);
  if (origin === undefined) return undefined;
  return { wsUrl: `ws://${authority}/ws`, origin };
}

/**
 * The environment a spawned Pi passes to the session extension. `PIANO_SESSION_ORIGIN` is both
 * the `Origin` header for the upgrade and the base for a `/s/<id>` link into Piano's UI; there is no
 * separate base-URL variable, because a second spelling of the same origin could drift from it.
 */
export const sessionEnvironment = (endpoint: SessionEndpoint): LaunchEnv => ({
  [SESSION_WS_URL]: endpoint.wsUrl,
  [SESSION_ORIGIN]: endpoint.origin,
});
