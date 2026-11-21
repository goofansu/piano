import { Data, Effect } from "effect";
import type { ProviderLoginState } from "../../shared/wire.ts";

export class SignInError extends Data.TaggedError("SignInError")<{ readonly detail: string }> {}

export type SignInState = ProviderLoginState;
type Prompt = NonNullable<SignInState["prompt"]>;
export type SignInPrompt = Omit<Prompt, "id">;
export interface SignInOutcome {
  readonly status: "success" | "error";
  readonly message: string;
}

export interface SignInAttempt {
  readonly signal: AbortSignal;
  readonly show: (update: Pick<SignInState, "url" | "userCode" | "message">) => void;
  readonly ask: (
    prompt: SignInPrompt,
    options?: {
      readonly signal?: AbortSignal;
      readonly check?: (value: string) => string | undefined;
    },
  ) => Promise<string>;
}

export interface SignInSource {
  readonly message?: string;
  readonly failure: string;
  readonly run: (attempt: SignInAttempt) => Promise<SignInOutcome>;
}

export interface SignInPolicy {
  readonly busy: string;
  readonly afterSuccess: Effect.Effect<void>;
  readonly expiresAfterMs?: number;
}

export interface SignInAttempts {
  readonly state: Effect.Effect<SignInState | null>;
  readonly busy: (subject?: string) => boolean;
  readonly start: (
    subject: string,
    source: SignInSource,
  ) => Effect.Effect<SignInState, SignInError>;
  readonly answer: (
    id: string,
    promptId: string,
    value: string,
  ) => Effect.Effect<SignInState, SignInError>;
  readonly cancel: (id: string) => Effect.Effect<SignInState, SignInError>;
  readonly exclusive: <A, E, R>(
    operation: Effect.Effect<A, E, R>,
    busy: string,
  ) => Effect.Effect<A, E | SignInError, R>;
  readonly forget: (subject: string) => Effect.Effect<void>;
  readonly lane: (
    source: (subject: string) => Effect.Effect<SignInSource, SignInError>,
  ) => SignInLane;
}

export interface SignInLane {
  readonly state: Effect.Effect<SignInState | null>;
  readonly start: (subject: string) => Effect.Effect<SignInState, SignInError>;
  readonly answer: SignInAttempts["answer"];
  readonly cancel: SignInAttempts["cancel"];
}

const closed = "This sign-in prompt has already closed. Refresh and try again.";

export const SignInAttempts = {
  make: Effect.fn("SignInAttempts.make")(function* (policy: SignInPolicy) {
    let current:
      | { state: SignInState; abort: AbortController; done: Promise<void>; active: boolean }
      | undefined;
    let pending:
      | {
          id: string;
          check?: (value: string) => string | undefined;
          resolve: (value: string) => void;
          reject: (error: Error) => void;
        }
      | undefined;
    let holding = false;
    const snapshot = () => (current ? structuredClone(current.state) : null);
    const cancel = (message: string) => {
      if (current?.state.status !== "running") return;
      current.state = {
        id: current.state.id,
        provider: current.state.provider,
        status: "cancelled",
        message,
      };
      current.abort.abort();
    };
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        cancel("Sign-in cancelled: Piano stopped.");
        await current?.done;
      }),
    );

    const start = Effect.fn("SignInAttempts.start")(function* (
      subject: string,
      source: SignInSource,
    ) {
      if (holding || current?.active) return yield* new SignInError({ detail: policy.busy });
      const attempt: NonNullable<typeof current> = {
        state: {
          id: crypto.randomUUID(),
          provider: subject,
          status: "running",
          ...(source.message ? { message: source.message } : {}),
        },
        abort: new AbortController(),
        done: Promise.resolve(),
        active: true,
      };
      current = attempt;
      const { signal } = attempt.abort;
      const live = () => !signal.aborted && attempt.state.status === "running";
      const ask: SignInAttempt["ask"] = (prompt, options = {}) =>
        new Promise((resolve, reject) => {
          const promptSignal = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
          if (!live() || promptSignal.aborted) {
            reject(new Error("Sign-in cancelled."));
            return;
          }
          const id = crypto.randomUUID();
          const finish = (settle: () => void) => {
            promptSignal.removeEventListener("abort", aborted);
            if (pending?.id === id) pending = undefined;
            if (attempt.state.prompt?.id === id) delete attempt.state.prompt;
            settle();
          };
          const aborted = () => finish(() => reject(new Error("Sign-in cancelled.")));
          attempt.state.prompt = { id, ...prompt } as Prompt;
          pending = {
            id,
            check: options.check,
            resolve: (value) => finish(() => resolve(value)),
            reject: (error) => finish(() => reject(error)),
          };
          promptSignal.addEventListener("abort", aborted, { once: true });
        });
      const timer = setTimeout(
        () => cancel("Sign-in expired. Please try again."),
        policy.expiresAfterMs ?? 15 * 60_000,
      );
      attempt.done = (async () => {
        let outcome: SignInOutcome;
        try {
          outcome = await source.run({
            signal,
            ask,
            show: (update) => {
              if (live()) Object.assign(attempt.state, update);
            },
          });
        } catch {
          outcome = { status: "error", message: source.failure };
        } finally {
          clearTimeout(timer);
          pending?.reject(new Error("Sign-in finished."));
        }
        if (outcome.status === "success")
          await Effect.runPromise(policy.afterSuccess).catch(() => undefined);
        if (live()) attempt.state = { id: attempt.state.id, provider: subject, ...outcome };
        attempt.active = false;
      })();
      return snapshot()!;
    });

    const answer = Effect.fn("SignInAttempts.answer")(function* (
      id: string,
      promptId: string,
      value: string,
    ) {
      const prompt = current?.state.prompt;
      if (
        current?.state.id !== id ||
        current.state.status !== "running" ||
        prompt?.id !== promptId ||
        pending?.id !== promptId
      ) {
        return yield* new SignInError({ detail: closed });
      }
      if (prompt.type === "select" && !prompt.options?.some((option) => option.id === value)) {
        return yield* new SignInError({ detail: "Choose one of the offered options." });
      }
      const refused = pending.check?.(value);
      if (refused) return yield* new SignInError({ detail: refused });
      const claim = pending;
      pending = undefined;
      claim.resolve(value);
      return snapshot()!;
    });

    const state = Effect.sync(snapshot);
    const cancelAttempt = Effect.fn("SignInAttempts.cancel")(function* (id: string) {
      if (current?.state.id !== id)
        return yield* new SignInError({ detail: "This sign-in is no longer current." });
      cancel("Sign-in cancelled.");
      return snapshot()!;
    });
    const attempts: SignInAttempts = {
      state,
      busy: (subject) =>
        !!current?.active && (subject === undefined || current.state.provider === subject),
      start,
      answer,
      cancel: cancelAttempt,
      exclusive: <A, E, R>(operation: Effect.Effect<A, E, R>, busy: string) =>
        Effect.suspend((): Effect.Effect<A, E | SignInError, R> => {
          if (holding || current?.active) return Effect.fail(new SignInError({ detail: busy }));
          holding = true;
          return operation.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                holding = false;
              }),
            ),
          );
        }),
      forget: (subject) =>
        Effect.sync(() => {
          if (current && !current.active && current.state.provider === subject) current = undefined;
        }),
      lane: (source) => ({
        state,
        start: (subject) => Effect.flatMap(source(subject), (flow) => start(subject, flow)),
        answer,
        cancel: cancelAttempt,
      }),
    };
    return attempts;
  }),
};
