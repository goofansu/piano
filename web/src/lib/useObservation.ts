import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createObservation, type Observation } from "./observation.ts";

export interface UseObservationOptions<T> {
  /** `false` keeps the value but stops reading; becoming `true` reads afresh. Default `true`. */
  enabled?: boolean;
  /** Read again when the window regains focus. Fixed for the component's lifetime. */
  focus?: boolean;
  interval?: (value: T | undefined) => number | undefined;
  /** Any change reads again after `debounce` milliseconds (default 0), coalescing quick changes. */
  trigger?: unknown;
  debounce?: number;
}

/**
 * A live observation of `key` while mounted; `null` is idle. The returned value is only ever the
 * current key's, even during the render in which the key changes (INV-07).
 */
export function useObservation<T>(key: string | null, load: (signal: AbortSignal, key: string) => Promise<T>, options: UseObservationOptions<T> = {}) {
  const latest = useRef({ load, interval: options.interval });
  latest.current = { load, interval: options.interval };
  const [observation] = useState<Observation<T>>(() => createObservation<T>({
    load: (signal, k) => latest.current.load(signal, k),
    interval: value => latest.current.interval?.(value),
    focus: options.focus,
  }));
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
    loading: current && state.loading,
    mutating: current && state.mutating,
    refresh: observation.refresh,
    mutate: observation.mutate,
  };
}
