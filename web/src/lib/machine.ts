import { RemoteRequests } from "../../../shared/http.ts";
import {
  isLocalId,
  isMachineId,
  LOCAL,
  type Machine,
  machineFrameBytes,
} from "../../../shared/machine.ts";
import { IMAGE_PATHS } from "../../../shared/remoteImages.ts";
import { machineLocationMemory } from "./machineMemory.ts";
import type { AddressBar } from "./navigation.ts";

export { isLocalId, LOCAL, type Machine, machineFrameBytes };

export function machineLocation(pathname: string): { id: string; pathname: string } {
  if (!pathname.startsWith("/m/")) return { id: LOCAL.id, pathname };
  const match = pathname.match(/^\/m\/([^/]+)(\/.*)?$/);
  return match && isMachineId(match[1])
    ? { id: match[1], pathname: match[2] ?? "/new" }
    : { id: "", pathname: "/new" };
}
export const machinePath = (id: string, path: string) =>
  isLocalId(id) ? path : `/m/${encodeURIComponent(id)}${path}`;
const peerPath = (id: string, path: string) => `/peer/${encodeURIComponent(id)}${path}`;
const machineSocketPath = (id: string) => (isLocalId(id) ? "/ws" : peerPath(id, "/ws"));
export const machineSocketUrl = (
  id: string,
  { protocol, host }: Pick<Location, "protocol" | "host"> = location,
) => `${protocol === "https:" ? "wss:" : "ws:"}//${host}${machineSocketPath(id)}`;

export function machineAddress(
  id: string,
  address: AddressBar,
  remembered: Pick<ReturnType<typeof machineLocationMemory>, "write"> = machineLocationMemory(id),
): AddressBar {
  const arrive = (path: string) => remembered.write(path.replace(/[?#].*$/, ""));
  const shown = () => {
    const at = machineLocation(address.location().pathname);
    return at.id === id ? at.pathname : undefined;
  };
  return {
    ...address,
    location: () => ({
      ...address.location(),
      pathname: machineLocation(address.location().pathname).pathname,
    }),
    push: (path) => {
      address.push(machinePath(id, path));
      arrive(path);
    },
    replace: (path) => {
      address.replace(machinePath(id, path));
      arrive(path);
    },
    onPop: (listener) => {
      const start = shown();
      if (start !== undefined) arrive(start);
      return address.onPop(() => {
        const page = shown();
        if (page === undefined) return;
        arrive(page);
        listener();
      });
    },
  };
}

const remotePaths = new Set<string>([
  ...RemoteRequests.map((request) => request.browser.path),
  ...IMAGE_PATHS,
]);

export function peerApiPath(id: string, path: string): string {
  if (isLocalId(id)) return path;
  if (!remotePaths.has(path)) throw new Error("Unavailable on this machine.");
  return peerPath(id, path);
}
