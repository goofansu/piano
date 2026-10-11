/** One sign-in attempt at a time per flow: its id, status, browser prompt, deadline, cancellation and
 * shutdown. Provider OAuth (Pi's ModelRuntime) and MCP OAuth (Pi's signInMcpServer) each plug in a
 * source that drives the actual flow; everything a browser can race against lives here (INV-04).
 * A source's own errors never reach the browser, since OAuth errors may carry token response
 * bodies (INV-11): only the outcome message it returns, or its fixed failure message, does. */
import { Data, Effect } from "effect";
import type { ProviderLoginState } from "../shared/wire.ts";

/** A refused request, shown to the user as `detail`. */
export class SignInError extends Data.TaggedError("SignInError")<{ readonly detail: string }> {}

/** Provider and MCP sign-in share one wire shape, so the browser shares one dialog. */
export type SignInState = ProviderLoginState;
type Prompt = NonNullable<SignInState["prompt"]>;
export type SignInPrompt = Omit<Prompt, "id">;
export interface SignInOutcome { readonly status: "success" | "error"; readonly message: string }

/** What a source's flow can do while its attempt runs. */
export interface SignInAttempt {
  /** Aborts on cancel, expiry and shutdown. */
  readonly signal: AbortSignal;
  /** Show the user where to go next. Ignored once the attempt has ended. */
  readonly show: (update: Pick<SignInState, "url" | "userCode" | "message">) => void;
  /** Ask the user. Rejects when `signal` (or the prompt's own signal) aborts, or the attempt ends.
   * `check` returns a detail to refuse an answer and keep asking. */
  readonly ask: (prompt: SignInPrompt, options?: { readonly signal?: AbortSignal; readonly check?: (value: string) => string | undefined }) => Promise<string>;
}

export interface SignInSource {
  /** The status line before the flow reports anything. */
  readonly message?: string;
  /** Shown in place of anything the flow throws (INV-11). */
  readonly failure: string;
  readonly run: (attempt: SignInAttempt) => Promise<SignInOutcome>;
}

export interface SignInPolicy {
  /** Detail of a start refused because another attempt or exclusive operation is running. */
  readonly busy: string;
  /** Runs after the flow succeeds, before success is reported, even when cancellation raced it. */
  readonly afterSuccess: Effect.Effect<void>;
  readonly expiresAfterMs?: number;
}

export interface SignInAttempts {
  /** A copy of the latest attempt, or null before the first. */
  readonly state: Effect.Effect<SignInState | null>;
  /** Whether an attempt is running, optionally for one subject. */
  readonly busy: (subject?: string) => boolean;
  readonly start: (subject: string, source: SignInSource) => Effect.Effect<SignInState, SignInError>;
  readonly answer: (id: string, promptId: string, value: string) => Effect.Effect<SignInState, SignInError>;
  readonly cancel: (id: string) => Effect.Effect<SignInState, SignInError>;
  /** Run an operation, such as sign-out, that no attempt may overlap; a start during it is refused. */
  readonly exclusive: <A, E, R>(operation: Effect.Effect<A, E, R>, busy: string) => Effect.Effect<A, E | SignInError, R>;
  /** Drop a finished attempt for `subject`, for example after signing out of it. */
  readonly forget: (subject: string) => Effect.Effect<void>;
}

const closed = "This sign-in prompt has already closed. Refresh and try again.";

export const SignInAttempts = {
  /** One lane of attempts, cancelled when the scope closes. */
  make: Effect.fn("SignInAttempts.make")(function* (policy: SignInPolicy) {
    let current: { state: SignInState; abort: AbortController; done: Promise<void>; active: boolean } | undefined;
    let pending: { id: string; check?: (value: string) => string | undefined; resolve: (value: string) => void; reject: (error: Error) => void } | undefined;
    let holding = false;
    const snapshot = () => current ? structuredClone(current.state) : null;
    const cancel = (message: string) => {
      if (current?.state.status !== "running") return;
      current.state = { id: current.state.id, provider: current.state.provider, status: "cancelled", message };
      current.abort.abort();
    };
    yield* Effect.addFinalizer(() => Effect.promise(async () => {
      cancel("Sign-in cancelled: Piano stopped.");
      await current?.done;
    }));

    const start = Effect.fn("SignInAttempts.start")(function* (subject: string, source: SignInSource) {
      if (holding || current?.active) return yield* new SignInError({ detail: policy.busy });
      const attempt: NonNullable<typeof current> = {
        state: { id: crypto.randomUUID(), provider: subject, status: "running", ...(source.message ? { message: source.message } : {}) },
        abort: new AbortController(), done: Promise.resolve(), active: true,
      };
      current = attempt;
      const { signal } = attempt.abort;
      const live = () => !signal.aborted && attempt.state.status === "running";
      const ask: SignInAttempt["ask"] = (prompt, options = {}) => new Promise((resolve, reject) => {
        const promptSignal = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
        if (!live() || promptSignal.aborted) { reject(new Error("Sign-in cancelled.")); return; }
        const id = crypto.randomUUID();
        const finish = (settle: () => void) => {
          promptSignal.removeEventListener("abort", aborted);
          if (pending?.id === id) pending = undefined;
          if (attempt.state.prompt?.id === id) delete attempt.state.prompt;
          settle();
        };
        const aborted = () => finish(() => reject(new Error("Sign-in cancelled.")));
        attempt.state.prompt = { id, ...prompt } as Prompt;
        pending = { id, check: options.check, resolve: value => finish(() => resolve(value)), reject: error => finish(() => reject(error)) };
        promptSignal.addEventListener("abort", aborted, { once: true });
      });
      const timer = setTimeout(() => cancel("Sign-in expired. Please try again."), policy.expiresAfterMs ?? 15 * 60_000);
      attempt.done = (async () => {
        let outcome: SignInOutcome;
        try { outcome = await source.run({ signal, ask, show: update => { if (live()) Object.assign(attempt.state, update); } }); }
        catch { outcome = { status: "error", message: source.failure }; }
        finally {
          clearTimeout(timer);
          pending?.reject(new Error("Sign-in finished."));
        }
        // Credentials changed even if cancellation won the race; report success only to a live attempt.
        if (outcome.status === "success") await Effect.runPromise(policy.afterSuccess).catch(() => undefined);
        if (live()) attempt.state = { id: attempt.state.id, provider: subject, ...outcome };
        attempt.active = false;
      })();
      return snapshot()!;
    });

    const answer = Effect.fn("SignInAttempts.answer")(function* (id: string, promptId: string, value: string) {
      const prompt = current?.state.prompt;
      if (current?.state.id !== id || current.state.status !== "running" || prompt?.id !== promptId || pending?.id !== promptId) {
        return yield* new SignInError({ detail: closed });
      }
      if (prompt.type === "select" && !prompt.options?.some(option => option.id === value)) {
        return yield* new SignInError({ detail: "Choose one of the offered options." });
      }
      const refused = pending.check?.(value);
      if (refused) return yield* new SignInError({ detail: refused });
      // Claim synchronously before resolving, so competing tabs cannot answer twice (INV-04).
      const claim = pending;
      pending = undefined;
      claim.resolve(value);
      return snapshot()!;
    });

    const attempts: SignInAttempts = {
      state: Effect.sync(snapshot),
      busy: subject => !!current?.active && (subject === undefined || current.state.provider === subject),
      start,
      answer,
      cancel: Effect.fn("SignInAttempts.cancel")(function* (id: string) {
        if (current?.state.id !== id) return yield* new SignInError({ detail: "This sign-in is no longer current." });
        cancel("Sign-in cancelled.");
        return snapshot()!;
      }),
      // Claim before the operation awaits, so another tab cannot start a sign-in under it.
      exclusive: <A, E, R>(operation: Effect.Effect<A, E, R>, busy: string) => Effect.suspend((): Effect.Effect<A, E | SignInError, R> => {
        if (holding || current?.active) return Effect.fail(new SignInError({ detail: busy }));
        holding = true;
        return operation.pipe(Effect.ensuring(Effect.sync(() => { holding = false; })));
      }),
      forget: subject => Effect.sync(() => { if (current && !current.active && current.state.provider === subject) current = undefined; }),
    };
    return attempts;
  }),
};
