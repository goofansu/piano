/**
 * One sign-in dialog's attempt: a provider's or an MCP server's, through the same request shape.
 * Opening it reads the server's attempt and starts a new one unless one is already running, once,
 * however often `start` is called, so a remounted dialog re-attaches instead of signing in twice.
 * A running attempt is polled while nothing else is in flight; an answer, retry or cancellation
 * supersedes any poll in flight, so a read that started before the change never overwrites the
 * change's result. A failed poll reports a lost connection until the next poll answers. `signedIn`
 * runs once per attempt, including when only the cancellation's reply shows the attempt had
 * already succeeded. Explicit dismissal cancels a running attempt; stopping (a browser leaving)
 * keeps it. `signInDialogView` derives what the dialog shows from the attempt's state. Nothing here
 * depends on React.
 */
import type { LoginPrompt, OAuthProvider, ProviderLoginState } from "@shared/wire";
import type { SignInRequest } from "./api.ts";
import { browserEnvironment, type ObservationEnvironment } from "./observation.ts";

export interface SignInAttemptState {
  /** The server's attempt as last read; `null` when it has none. */
  attempt: ProviderLoginState | null;
  /** Opening, an answer, a retry or a cancellation is in flight. */
  busy: boolean;
  /** The last action's failure, cleared by the next action or an attempt that stopped running. */
  error: string;
  /** Set by a failed poll, cleared by the next poll that answers. */
  connectionError: string;
}

export type SignInApi = (request?: SignInRequest) => Promise<ProviderLoginState | null>;

export interface SignInAttemptOptions {
  api: SignInApi;
  /** Start this provider's sign-in on opening unless an attempt is already running. */
  provider: string;
  /** The attempt succeeded; runs once per attempt. */
  signedIn: () => void;
  /** The dialog should close. */
  close: () => void;
  environment?: Pick<ObservationEnvironment, "setTimeout" | "clearTimeout">;
}

export interface SignInAttempt {
  getState: () => SignInAttemptState;
  subscribe: (listener: () => void) => () => void;
  /** Opens the attempt on first call and polls while running; returns the stop function, which keeps the attempt. */
  start: () => () => void;
  answer: (promptId: string, value: string) => void;
  /** Starts a new attempt for the same provider after one failed or was cancelled. */
  retry: () => void;
  /** Cancels a running attempt and closes; ignored while anything is in flight. */
  dismiss: () => void;
}

export const POLL_MS = 750;
export const CONNECTION_LOST = "Connection lost. Sign-in will resume when Piano reconnects.";
export const CANCEL_FAILED = "Could not cancel sign-in. Check your connection and try again.";

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Could not complete sign-in.";

export function createSignInAttempt({
  api,
  provider,
  signedIn,
  close,
  environment = browserEnvironment,
}: SignInAttemptOptions): SignInAttempt {
  let state: SignInAttemptState = { attempt: null, busy: true, error: "", connectionError: "" };
  const listeners = new Set<() => void>();
  let active = false;
  let opened = false;
  let dismissing = false;
  /** The attempt `signedIn` last ran for. */
  let notified: string | undefined;
  /** Bumped by every action and stop; a poll applies only within the generation it started in. */
  let generation = 0;
  /** The generation whose poll loop is running. */
  let looping = -1;
  let timer: unknown;

  const publish = (patch: Partial<SignInAttemptState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const notify = (attempt: ProviderLoginState | null) => {
    if (attempt?.status !== "success" || notified === attempt.id) return;
    notified = attempt.id;
    signedIn();
  };

  /** A read or action's result becomes the attempt; success is announced while the dialog is open. */
  const apply = (patch: Partial<SignInAttemptState> & { attempt: ProviderLoginState | null }) => {
    publish(patch);
    if (active) notify(patch.attempt);
  };

  /** Supersede any poll: drop its timer and its reply. */
  const halt = () => {
    generation++;
    if (timer !== undefined) environment.clearTimeout(timer);
    timer = undefined;
  };

  const arm = (version: number) => {
    timer = environment.setTimeout(() => {
      timer = undefined;
      void poll(version);
    }, POLL_MS);
  };

  const poll = async (version: number) => {
    let next: ProviderLoginState | null;
    try {
      next = await api();
    } catch {
      if (version !== generation) return;
      publish({ connectionError: CONNECTION_LOST });
      arm(version);
      return;
    }
    if (version !== generation) return;
    apply({
      attempt: next,
      connectionError: "",
      ...(next?.status !== "running" && { error: "" }),
    });
    if (next?.status === "running") arm(version);
    else looping = -1;
  };

  const schedule = () => {
    if (!active || looping === generation || state.busy) return;
    if (state.attempt?.status !== "running") return;
    looping = generation;
    arm(generation);
  };

  const change = async (request: SignInRequest) => {
    halt();
    publish({ busy: true, error: "" });
    try {
      apply({ attempt: await api(request) });
    } catch (error) {
      publish({ error: failure(error) });
    } finally {
      halt();
      publish({ busy: false });
      schedule();
    }
  };

  /** Runs once per dialog however often `start` does, so a remount never signs in twice. */
  const open = async () => {
    opened = true;
    try {
      const current = await api();
      apply({
        attempt:
          provider && current?.status !== "running"
            ? await api({ method: "POST", body: { provider } })
            : current,
      });
    } catch (error) {
      publish({ error: failure(error) });
    } finally {
      publish({ busy: false });
      schedule();
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
    start: () => {
      active = true;
      if (!opened) void open();
      notify(state.attempt);
      schedule();
      return () => {
        active = false;
        halt();
      };
    },
    answer: (promptId, value) => {
      const { attempt, busy } = state;
      if (busy || !attempt) return;
      void change({ method: "PUT", body: { id: attempt.id, promptId, value } });
    },
    retry: () => {
      const { attempt, busy } = state;
      if (busy || !attempt) return;
      void change({ method: "POST", body: { provider: attempt.provider } });
    },
    dismiss: () => {
      // Do not abandon an opening or answer whose resulting attempt is not known yet.
      if (state.busy || dismissing) return;
      dismissing = true;
      const { attempt } = state;
      if (attempt?.status !== "running") {
        close();
        return;
      }
      halt();
      publish({ busy: true, error: "" });
      void (async () => {
        try {
          const result = await api({ method: "DELETE", body: { id: attempt.id } });
          // Authorization may have completed before cancellation reached the server.
          notify(result);
          close();
        } catch {
          publish({ error: CANCEL_FAILED });
        } finally {
          halt();
          dismissing = false;
          publish({ busy: false });
          schedule();
        }
      })();
    },
  };
}

/** The sign-in page's address when it is safe to link: http(s) without credentials. */
function safeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export interface SignInDialogView {
  title: string;
  description: string;
  /** The attempt succeeded; `message` is then the success detail. */
  success: boolean;
  message: string | undefined;
  /** The sign-in page to open, only when the attempt runs and it is a safe http(s) link. */
  url: string | undefined;
  /** Where "Open sign-in page" shows: beside a prompt, in the footer, or nowhere. */
  link: "body" | "footer" | null;
  deviceCode: string | undefined;
  /** The running attempt's question; its form replaces the footer. */
  prompt: LoginPrompt | undefined;
  busy: boolean;
  /** Something is in flight and no prompt is showing. */
  loading: boolean;
  /** The last action's failure, else a lost connection. */
  alert: string | undefined;
  /** Absent while a prompt shows its own Cancel and Continue. */
  footer: { dismissLabel: string; dismissPrimary: boolean; retry: boolean } | undefined;
}

/** What the sign-in dialog shows. Pure; the component renders it. */
export function signInDialogView({
  state: { attempt, busy, error, connectionError },
  provider,
  providers,
}: {
  state: SignInAttemptState;
  /** The provider the dialog was opened for, named until the attempt names its own. */
  provider: string;
  providers: readonly OAuthProvider[];
}): SignInDialogView {
  const running = attempt?.status === "running";
  const success = attempt?.status === "success";
  const prompt = running ? attempt.prompt : undefined;
  const url = running ? safeUrl(attempt.url) : undefined;
  const id = attempt?.provider ?? provider;
  const name = providers.find((candidate) => candidate.id === id)?.name ?? id;
  return {
    title: `Sign in to ${name}`,
    description:
      prompt?.type === "select"
        ? "Choose a sign-in method."
        : url && !prompt
          ? "Waiting for authorization…"
          : "Follow the steps to connect your account.",
    success,
    message: attempt?.message,
    url,
    link: url ? (prompt ? "body" : "footer") : null,
    deviceCode: attempt?.userCode,
    prompt,
    busy,
    loading: busy && !prompt,
    alert: error || connectionError || undefined,
    footer: prompt
      ? undefined
      : {
          dismissLabel: success ? "Done" : running || busy ? "Cancel" : "Close",
          dismissPrimary: success,
          retry: attempt?.status === "error" || attempt?.status === "cancelled",
        },
  };
}

/** A prompt's answer may be sent: nothing is in flight and a select has a choice. The Continue
 * button and the form's submit guard both read this. */
export function canSubmitAnswer({
  prompt,
  busy,
  value,
}: {
  prompt: LoginPrompt;
  busy: boolean;
  value: string;
}): boolean {
  return !busy && !(prompt.type === "select" && !value);
}
