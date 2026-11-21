import { toast } from "sonner";

export interface SetupActionsState<C, S> {
  running: string | undefined;
  error: string;
  confirmation: C | undefined;
  signIn: { subject: S; key: string } | undefined;
}

export interface SetupActionsOptions {
  refresh: () => void;
  success: (message: string, id: string) => void;
  failure?: ((message: string) => void) | "keep";
  newKey?: () => string;
}

export interface SetupChange<A> {
  id: string;
  run: () => Promise<A>;
  done?: string | ((result: A) => string | undefined);
  fallback: string;
}

export interface SetupActions<C, S> {
  getState: () => SetupActionsState<C, S>;
  subscribe: (listener: () => void) => () => void;
  run: <A>(change: SetupChange<A>) => Promise<A | undefined>;
  confirm: (confirmation: C) => void;
  cancel: () => void;
  openSignIn: (subject: S) => void;
  closeSignIn: () => void;
}

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

export function createSetupActions<C = never, S = never>(
  options: SetupActionsOptions,
): SetupActions<C, S> {
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const report =
    options.failure === "keep"
      ? (error: string) => set({ error })
      : (options.failure ?? ((text: string) => void toast.error(text)));
  let state: SetupActionsState<C, S> = {
    running: undefined,
    error: "",
    confirmation: undefined,
    signIn: undefined,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SetupActionsState<C, S>>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run: async (change) => {
      if (state.running !== undefined) return undefined;
      set({ running: change.id, error: "" });
      try {
        const result = await change.run();
        const done = typeof change.done === "function" ? change.done(result) : change.done;
        if (done) options.success(done, change.id);
        return result;
      } catch (cause) {
        const text = message(cause, change.fallback);
        report(text);
        return undefined;
      } finally {
        options.refresh();
        set({ running: undefined, confirmation: undefined });
      }
    },
    confirm: (confirmation) => set({ confirmation }),
    cancel: () => {
      if (state.running === undefined && state.confirmation !== undefined)
        set({ confirmation: undefined });
    },
    openSignIn: (subject) => set({ signIn: { subject, key: newKey() } }),
    closeSignIn: () => {
      if (state.signIn) set({ signIn: undefined });
    },
  };
}
