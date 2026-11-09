/** Machine identity belongs above a backend's workspace/session projection (INV-07). */
import { RemoteRequests } from "../../../shared/http.ts";
import {
  isLocalId,
  isMachineId,
  LOCAL,
  type Machine,
  machineFrameBytes,
} from "../../../shared/machine.ts";
import type { AddressBar } from "./navigation.ts";

export { isLocalId, LOCAL, type Machine, machineFrameBytes };

/** `/m/<id>/…` addresses a remote; an ID no machine could take addresses none (`""`). */
export function machineLocation(pathname: string): { id: string; pathname: string } {
  if (!pathname.startsWith("/m/")) return { id: LOCAL.id, pathname };
  const match = pathname.match(/^\/m\/([^/]+)(\/.*)?$/);
  return match && isMachineId(match[1])
    ? { id: match[1], pathname: match[2] ?? "/new" }
    : { id: "", pathname: "/new" };
}
export const machinePath = (id: string, path: string) =>
  isLocalId(id) ? path : `/m/${encodeURIComponent(id)}${path}`;
/** Where this Piano's gateway answers for a remote machine. */
const peerPath = (id: string, path: string) => `/peer/${encodeURIComponent(id)}${path}`;
/** Local answers on this Piano's own socket; a remote's goes through the gateway. */
const machineSocketPath = (id: string) => (isLocalId(id) ? "/ws" : peerPath(id, "/ws"));
/** The one place a machine's socket URL is built from the page's own address. */
export const machineSocketUrl = (
  id: string,
  { protocol, host }: Pick<Location, "protocol" | "host"> = location,
) => `${protocol === "https:" ? "wss:" : "ws:"}//${host}${machineSocketPath(id)}`;

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

const remotePaths = new Set<string>(RemoteRequests.map((request) => request.browser.path));

/**
 * No relative fallback: each supported remote request has an immutable owner. A remote answers
 * only the requests its gateway relays (`RemoteRequests`, ADR 0004).
 */
export function peerApiPath(id: string, path: string): string {
  if (isLocalId(id)) return path;
  if (!remotePaths.has(path)) throw new Error("Unavailable on this machine.");
  return peerPath(id, path);
}
