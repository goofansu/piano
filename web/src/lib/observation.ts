export interface ObservationState<T> {
  key: string | null;
  value: T | undefined;
  error: string | undefined;
  failure: string | undefined;
  loading: boolean;
  mutating: boolean;
}

export interface ObservationEnvironment {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  onFocus: (listener: () => void) => () => void;
  hidden: () => boolean;
}

export interface ObservationOptions<T> {
  load: (signal: AbortSignal, key: string) => Promise<T>;
  interval?: (value: T | undefined) => number | undefined;
  focus?: boolean;
  environment?: ObservationEnvironment;
}

export interface Observation<T> {
  getState: () => ObservationState<T>;
  subscribe: (listener: () => void) => () => void;
  observe: (key: string | null, enabled?: boolean) => void;
  refresh: () => Promise<T | undefined>;
  refreshSoon: (ms: number) => void;
  reschedule: () => void;
  mutate: (
    run: (signal: AbortSignal, previous: T | undefined) => Promise<T | undefined>,
  ) => Promise<T | undefined>;
  start: () => () => void;
}

export const browserEnvironment: ObservationEnvironment = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  onFocus: (listener) => {
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  },
  hidden: () => document.hidden,
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createObservation<T>(options: ObservationOptions<T>): Observation<T> {
  const env = options.environment ?? browserEnvironment;
  let state: ObservationState<T> = {
    key: null,
    value: undefined,
    error: undefined,
    failure: undefined,
    loading: false,
    mutating: false,
  };
  const listeners = new Set<() => void>();
  let enabled = false,
    running = false;
  let work: { controller: AbortController; mutation: boolean } | null = null;
  let poll: unknown, soon: unknown, unfocus: (() => void) | undefined;

  const set = (patch: Partial<ObservationState<T>>) => {
    state = { ...state, ...patch };
    state.failure = state.loading ? undefined : state.error;
    for (const listener of listeners) listener();
  };
  const live = () => running && enabled && state.key !== null;
  const clearTimers = () => {
    if (poll !== undefined) env.clearTimeout(poll);
    if (soon !== undefined) env.clearTimeout(soon);
    poll = soon = undefined;
  };
  const cancel = () => {
    work?.controller.abort();
    work = null;
    clearTimers();
    if (state.loading || state.mutating) set({ loading: false, mutating: false });
  };
  const stopReading = () => {
    if (work && !work.mutation) {
      work.controller.abort();
      work = null;
      set({ loading: false });
    }
    clearTimers();
  };
  const schedule = () => {
    if (poll !== undefined) env.clearTimeout(poll);
    poll = undefined;
    const ms = live() && work === null ? options.interval?.(state.value) : undefined;
    if (ms === undefined) return;
    poll = env.setTimeout(function tick() {
      poll = undefined;
      if (!live()) return;
      if (env.hidden()) {
        poll = env.setTimeout(tick, ms);
        return;
      }
      void refresh();
    }, ms);
  };

  const refresh = async (): Promise<T | undefined> => {
    if (!live() || work?.mutation) return undefined;
    const key = state.key!;
    if (poll !== undefined) env.clearTimeout(poll);
    poll = undefined;
    work?.controller.abort();
    const mine = { controller: new AbortController(), mutation: false };
    work = mine;
    if (!state.loading) set({ loading: true });
    try {
      const value = await options.load(mine.controller.signal, key);
      if (work !== mine) return undefined;
      work = null;
      set({ value, error: undefined, loading: false });
      return value;
    } catch (error) {
      if (work !== mine) return undefined;
      work = null;
      set({ error: message(error), loading: false });
      return undefined;
    } finally {
      if (work === null && state.key === key) schedule();
    }
  };

  const mutate: Observation<T>["mutate"] = async (run) => {
    if (state.key === null) return undefined;
    const key = state.key;
    work?.controller.abort();
    if (soon !== undefined) {
      env.clearTimeout(soon);
      soon = undefined;
    }
    const mine = { controller: new AbortController(), mutation: true };
    work = mine;
    set({ mutating: true, loading: false });
    try {
      const value = await run(mine.controller.signal, state.value);
      if (work !== mine) return undefined;
      work = null;
      set(value === undefined ? { mutating: false } : { value, error: undefined, mutating: false });
      return value;
    } catch (error) {
      if (work !== mine) return undefined;
      work = null;
      set({ mutating: false });
      throw error;
    } finally {
      if (work === null && state.key === key) schedule();
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    observe: (key, nextEnabled = true) => {
      if (key === state.key && nextEnabled === enabled) return;
      if (key !== state.key) {
        cancel();
        set({ key, value: undefined, error: undefined });
      } else stopReading();
      enabled = nextEnabled;
      void refresh();
    },
    refresh,
    reschedule: schedule,
    refreshSoon: (ms) => {
      if (!live()) return;
      if (soon !== undefined) env.clearTimeout(soon);
      soon = undefined;
      if (ms <= 0) {
        void refresh();
        return;
      }
      soon = env.setTimeout(() => {
        soon = undefined;
        void refresh();
      }, ms);
    },
    mutate,
    start: () => {
      running = true;
      if (options.focus)
        unfocus = env.onFocus(() => {
          void refresh();
        });
      void refresh();
      return () => {
        running = false;
        unfocus?.();
        unfocus = undefined;
        cancel();
      };
    },
  };
}
