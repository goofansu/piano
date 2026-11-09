/** Machine identity belongs above a backend's workspace/session projection (INV-07). */
import type { AddressBar } from "./navigation.ts";

export interface Machine {
  id: string;
  name: string;
}
export const LOCAL: Machine = { id: "local", name: "Local" };

export function machineLocation(pathname: string): { id: string; pathname: string } {
  const match = pathname.match(/^\/m\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/.*)?$/);
  return match
    ? { id: match[1], pathname: match[2] ?? "/new" }
    : pathname.startsWith("/m/")
      ? { id: "", pathname: "/new" }
      : { id: "local", pathname };
}
export const machinePath = (id: string, path: string) =>
  id === "local" ? path : `/m/${encodeURIComponent(id)}${path}`;
export const machineSocketPath = (id: string) =>
  id === "local" ? "/ws" : `/peer/${encodeURIComponent(id)}/ws`;

/** Each navigation owns its prefix; late work cannot adopt the newly selected machine. */
export function machineAddress(id: string, address: AddressBar): AddressBar {
  return {
    ...address,
    location: () => ({
      ...address.location(),
      pathname: machineLocation(address.location().pathname).pathname,
    }),
    push: (path) => address.push(machinePath(id, path)),
    replace: (path) => address.replace(machinePath(id, path)),
    onPop: (listener) =>
      address.onPop(() => {
        if (machineLocation(address.location().pathname).id === id) listener();
      }),
  };
}

/**
 * No relative fallback: each supported remote request has an immutable owner. A remote offers its
 * commands and, as its own pickers save them, its default model and effort (ADR 0004).
 */
export function peerApiPath(id: string, path: string): string {
  if (id === "local") return path;
  if (
    path !== "/api/session/commands" &&
    path !== "/api/commands" &&
    path !== "/api/settings/defaults"
  )
    throw new Error("Unavailable on this machine.");
  return `/peer/${encodeURIComponent(id)}${path}`;
}
