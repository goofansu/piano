import { useRef, useState, useSyncExternalStore } from "react";
import { createSetupActions, type SetupActions, type SetupActionsOptions } from "./setupActions.ts";

/** One section's setup actions while mounted; the latest `options` are used for each change. */
export function useSetupActions<C = never, S = never>(options: SetupActionsOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [actions] = useState<SetupActions<C, S>>(() =>
    createSetupActions<C, S>({
      refresh: () => latest.current.refresh(),
      success: (text, id) => latest.current.success(text, id),
      // Where failures go is fixed when the section mounts; a reporter is read when it is called.
      failure:
        typeof options.failure === "function"
          ? (text) => {
              const { failure } = latest.current;
              if (typeof failure === "function") failure(text);
            }
          : options.failure,
      newKey: options.newKey,
    }),
  );
  const state = useSyncExternalStore(actions.subscribe, actions.getState);
  return { ...state, ...actions };
}
