import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createObservation, type Observation } from "./observation.ts";

export interface UseObservationOptions {
  enabled?: boolean;
  focus?: boolean;
  trigger?: unknown;
  debounce?: number;
}

export function useObservation<T>(
  key: string | null,
  load: (signal: AbortSignal, key: string) => Promise<T>,
  options: UseObservationOptions = {},
) {
  const latest = useRef(load);
  latest.current = load;
  const [observation] = useState<Observation<T>>(() =>
    createObservation<T>({
      load: (signal, k) => latest.current(signal, k),
      focus: options.focus,
    }),
  );
  useEffect(() => observation.start(), [observation]);
  const enabled = options.enabled ?? true;
  useEffect(() => observation.observe(key, enabled), [observation, key, enabled]);
  const seen = useRef(options.trigger);
  const { trigger, debounce = 0 } = options;
  useEffect(() => {
    if (Object.is(seen.current, trigger)) return;
    seen.current = trigger;
    observation.refreshSoon(debounce);
  }, [observation, trigger, debounce]);
  const state = useSyncExternalStore(observation.subscribe, observation.getState);
  const current = state.key === key;
  return {
    value: current ? state.value : undefined,
    error: current ? state.error : undefined,
    failure: current ? state.failure : undefined,
    loading: current && state.loading,
    mutating: current && state.mutating,
    refresh: observation.refresh,
    mutate: observation.mutate,
  };
}
