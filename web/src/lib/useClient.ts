import { useEffect, useState, useSyncExternalStore } from "react";
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
  const state = useSyncExternalStore(client.subscribe, client.getState);
  return { state, client };
}
