/**
 * What a Settings section does when the user changes setup: one change at a time, a confirmation
 * before a destructive one, a sign-in dialog, and a re-read of the section's facts once a change
 * settles either way. The confirmation keeps its subject after closing, so its dialog keeps its
 * wording while it animates closed. Each sign-in gets a fresh key, so reopening the dialog starts
 * it afresh. Nothing here depends on React.
 */

export interface SetupActionsState<C, S> {
  /** The id of the change in flight; every setup control waits for it. */
  running: string | undefined;
  /** The last change's failure, cleared when another starts. */
  error: string;
  /** The confirmation last asked for, kept after it closes. */
  confirmation: C | undefined;
  /** Whether that confirmation is on screen. */
  confirming: boolean;
  /** The sign-in dialog's subject, with the key that names this opening of it. */
  signIn: { subject: S; key: string } | undefined;
}

export interface SetupActionsOptions {
  /** Re-reads the section's facts; called after every change, whether it succeeded or failed. */
  refresh: () => void;
  /** Announces a finished change, given the change's id. */
  success: (message: string, id: string) => void;
  /** Reports a failure instead of keeping it in `error`, for a section without an error alert. */
  failure?: (message: string) => void;
  /** Names one opening of the sign-in dialog. */
  newKey?: () => string;
}

export interface SetupChange<A> {
  /** Which change runs, so its control can show progress. */
  id: string;
  run: () => Promise<A>;
  /** Announced after the change succeeds, given its result. */
  done?: string | ((result: A) => string | undefined);
  /** Shown when the change fails without a message of its own. */
  fallback: string;
}

export interface SetupActions<C, S> {
  getState: () => SetupActionsState<C, S>;
  subscribe: (listener: () => void) => () => void;
  /** Runs one change unless another is in flight; resolves with its result, or `undefined` if it failed or did not run. */
  run: <A>(change: SetupChange<A>) => Promise<A | undefined>;
  confirm: (confirmation: C) => void;
  /** Closes the confirmation, unless its change is still running. */
  cancel: () => void;
  openSignIn: (subject: S) => void;
  closeSignIn: () => void;
  clearError: () => void;
}

const message = (cause: unknown, fallback: string) => cause instanceof Error && cause.message ? cause.message : fallback;

export function createSetupActions<C = never, S = never>(options: SetupActionsOptions): SetupActions<C, S> {
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  let state: SetupActionsState<C, S> = { running: undefined, error: "", confirmation: undefined, confirming: false, signIn: undefined };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SetupActionsState<C, S>>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run: async change => {
      if (state.running !== undefined) return undefined;
      set({ running: change.id, error: "" });
      try {
        const result = await change.run();
        const done = typeof change.done === "function" ? change.done(result) : change.done;
        if (done) options.success(done, change.id);
        return result;
      } catch (cause) {
        const text = message(cause, change.fallback);
        if (options.failure) options.failure(text);
        else set({ error: text });
        return undefined;
      } finally {
        // The re-read starts first, so no moment shows the change settled on facts it may have changed.
        options.refresh();
        set({ running: undefined, confirming: false });
      }
    },
    confirm: confirmation => set({ confirmation, confirming: true }),
    cancel: () => { if (state.running === undefined && state.confirming) set({ confirming: false }); },
    openSignIn: subject => set({ signIn: { subject, key: newKey() } }),
    closeSignIn: () => { if (state.signIn) set({ signIn: undefined }); },
    clearError: () => { if (state.error) set({ error: "" }); },
  };
}
