export const LOOPBACK_HOSTNAMES: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

export const isLoopbackHostname = (hostname: string): boolean =>
  LOOPBACK_HOSTNAMES.includes(hostname);
