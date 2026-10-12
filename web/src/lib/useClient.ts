import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { AppState } from "../store.ts";
import { type Client, createClient, type Notify } from "./client.ts";
import { openConnection } from "./ws.ts";

/** One client for the page, connected while mounted; components read its state and call it directly. */
export function useClient(
  initial: () => AppState,
  notify: Notify,
): { state: AppState; client: Client } {
  const [client] = useState(() =>
    createClient({ initial: initial(), connect: openConnection, notify }),
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
        // useSyncExternalStore renders synchronously. Painting every wire frame
        // can starve acknowledgements and overflow an otherwise healthy socket.
        // Only paints are coalesced: projection, notices and protocol work stay
        // synchronous, even in a background tab where animation frames pause.
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
