import { useRef, useState, useSyncExternalStore } from "react";
import { createSetupActions, type SetupActions, type SetupActionsOptions } from "./setupActions.ts";

/** One section's setup actions while mounted; the latest `options` are used for each change. */
export function useSetupActions<C = never, S = never>(options: SetupActionsOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [actions] = useState<SetupActions<C, S>>(() => createSetupActions<C, S>({
    refresh: () => latest.current.refresh(),
    success: (text, id) => latest.current.success(text, id),
    failure: options.failure && (text => latest.current.failure?.(text)),
    newKey: options.newKey,
  }));
  const state = useSyncExternalStore(actions.subscribe, actions.getState);
  return { ...state, ...actions };
}
