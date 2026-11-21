import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { openConnection } from "../shared/transport/ws.ts";
import { type Client, type ClientOptions, createClient, type Notify } from "./client.ts";
import type { AppState } from "./store.ts";

export function useClient(
  initial: () => AppState,
  notify: Notify,
  options: Partial<Pick<ClientOptions, "connect" | "lastDirectory">> = {},
): { state: AppState; client: Client } {
  const [client] = useState(() =>
    createClient({ initial: initial(), connect: openConnection, notify, ...options }),
  );
  useEffect(() => client.start(), [client]);
  const subscribe = useCallback(
    (listener: () => void) => {
      let frame: number | undefined;
      const flush = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        listener();
      };
      const unsubscribe = client.subscribe((update) => {
        if (update === "immediate") flush();
        else if (frame === undefined) frame = requestAnimationFrame(flush);
      });
      return () => {
        unsubscribe();
        if (frame !== undefined) cancelAnimationFrame(frame);
      };
    },
    [client],
  );
  const state = useSyncExternalStore(subscribe, client.getState);
  return { state, client };
}
