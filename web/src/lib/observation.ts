/**
 * One live observation of an HTTP-backed fact, keyed by identity (INV-07). A value belongs to the
 * key it was read for: changing the key aborts that key's reads, drops their late responses and
 * starts from nothing, so an older workspace's or session's value is never shown as current.
 * Reads refresh on demand, on window focus, on an interval and on a debounced trigger. A mutation
 * supersedes in-flight reads and holds new ones off until it settles, so a read that started
 * before a change can never overwrite the change's result. Nothing here depends on React.
 */

export interface ObservationState<T> {
  /** The identity `value` and `error` belong to; `null` while idle. */
  key: string | null;
  value: T | undefined;
  /** The last read's failure for this key, kept until a read or mutation succeeds. */
  error: string | undefined;
  /** A read is in flight. */
  loading: boolean;
  /** A mutation is in flight; reads wait for it. */
  mutating: boolean;
}

/** Timers, focus and visibility, behind a seam so the policy runs in Node. */
export interface ObservationEnvironment {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  /** Subscribes to window focus; returns the unsubscribe function. */
  onFocus: (listener: () => void) => () => void;
  /** Interval reads are skipped while the page is hidden. */
  hidden: () => boolean;
}

export interface ObservationOptions<T> {
  load: (signal: AbortSignal, key: string) => Promise<T>;
  /** Milliseconds until the next read after one settles, given the current value; `undefined` stops polling. */
  interval?: (value: T | undefined) => number | undefined;
  /** Read again whenever the window regains focus. */
  focus?: boolean;
  environment?: ObservationEnvironment;
}

export interface Observation<T> {
  getState: () => ObservationState<T>;
  subscribe: (listener: () => void) => () => void;
  /**
   * Follow `key`. A different key discards the old one's value and work; `enabled: false` keeps
   * the value but aborts reads and stops refreshing. Becoming enabled reads the key afresh.
   */
  observe: (key: string | null, enabled?: boolean) => void;
  /** Reads now, superseding an in-flight read. Resolves with the value it published, if any. */
  refresh: () => Promise<T | undefined>;
  /** Reads after `ms` unless called again first; `ms <= 0` reads now. */
  refreshSoon: (ms: number) => void;
  /**
   * Runs a change for the current key with the value it applies to. Its result (if not
   * `undefined`) becomes the value unless the key changed or another mutation started meanwhile;
   * it resolves with that applied value. A failure rejects and leaves the value alone.
   */
  mutate: (run: (signal: AbortSignal, previous: T | undefined) => Promise<T | undefined>) => Promise<T | undefined>;
  /** Installs focus and resumes reading; returns the stop function, which aborts all work. */
  start: () => () => void;
}

export const browserEnvironment: ObservationEnvironment = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  onFocus: listener => { window.addEventListener("focus", listener); return () => window.removeEventListener("focus", listener); },
  hidden: () => document.hidden,
};

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createObservation<T>(options: ObservationOptions<T>): Observation<T> {
  const env = options.environment ?? browserEnvironment;
  let state: ObservationState<T> = { key: null, value: undefined, error: undefined, loading: false, mutating: false };
  const listeners = new Set<() => void>();
  let enabled = false, running = false;
  /** The in-flight read or mutation; only the current one may publish. */
  let work: { controller: AbortController; mutation: boolean } | null = null;
  let poll: unknown, soon: unknown, unfocus: (() => void) | undefined;

  const set = (patch: Partial<ObservationState<T>>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const live = () => running && enabled && state.key !== null;
  const clearTimers = () => {
    if (poll !== undefined) env.clearTimeout(poll);
    if (soon !== undefined) env.clearTimeout(soon);
    poll = soon = undefined;
  };
  const cancel = () => {
    work?.controller.abort(); work = null;
    clearTimers();
    if (state.loading || state.mutating) set({ loading: false, mutating: false });
  };
  /** Pausing keeps a change in flight; it still belongs to this key. */
  const stopReading = () => {
    if (work && !work.mutation) { work.controller.abort(); work = null; set({ loading: false }); }
    clearTimers();
  };
  const schedule = () => {
    if (poll !== undefined) env.clearTimeout(poll);
    poll = undefined;
    const ms = live() ? options.interval?.(state.value) : undefined;
    if (ms === undefined) return;
    poll = env.setTimeout(function tick() {
      poll = undefined;
      if (!live()) return;
      if (env.hidden()) { poll = env.setTimeout(tick, ms); return; }
      void refresh();
    }, ms);
  };

  const refresh = async (): Promise<T | undefined> => {
    if (!live() || work?.mutation) return undefined;
    const key = state.key!;
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

  const mutate: Observation<T>["mutate"] = async run => {
    if (state.key === null) return undefined;
    const key = state.key;
    work?.controller.abort();
    if (soon !== undefined) { env.clearTimeout(soon); soon = undefined; }
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
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    observe: (key, nextEnabled = true) => {
      if (key === state.key && nextEnabled === enabled) return;
      if (key !== state.key) { cancel(); set({ key, value: undefined, error: undefined }); }
      else stopReading();
      enabled = nextEnabled;
      void refresh();
    },
    refresh,
    refreshSoon: ms => {
      if (!live()) return;
      if (soon !== undefined) env.clearTimeout(soon);
      soon = undefined;
      if (ms <= 0) { void refresh(); return; }
      soon = env.setTimeout(() => { soon = undefined; void refresh(); }, ms);
    },
    mutate,
    start: () => {
      running = true;
      if (options.focus) unfocus = env.onFocus(() => { void refresh(); });
      void refresh();
      return () => {
        running = false;
        unfocus?.(); unfocus = undefined;
        cancel();
      };
    },
  };
}
