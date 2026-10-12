import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createWorktreeOperation,
  type WorktreeOperation,
  type WorktreeOperationOptions,
  type WorktreeOperationState,
} from "./worktreeOperation.ts";

/** One worktree operation for the directory picker, listening while mounted; `ready` may change between renders. */
export function useWorktreeOperation(
  client: WorktreeOperationOptions["client"],
  ready: (path: string) => void,
): WorktreeOperation & WorktreeOperationState {
  const latest = useRef(ready);
  latest.current = ready;
  const [operation] = useState(() =>
    createWorktreeOperation({ client, ready: (path) => latest.current(path) }),
  );
  useEffect(() => operation.start(), [operation]);
  const state = useSyncExternalStore(operation.subscribe, operation.getState);
  return { ...operation, ...state };
}
