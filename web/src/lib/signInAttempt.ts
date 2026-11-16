import type { LoginPrompt, OAuthProvider, ProviderLoginState } from "@shared/wire";
import type { SignInRequest } from "./api.ts";
import { browserEnvironment, type ObservationEnvironment } from "./observation.ts";

export interface SignInAttemptState {
  attempt: ProviderLoginState | null;
  busy: boolean;
  error: string;
  connectionError: string;
}

export type SignInApi = (request?: SignInRequest) => Promise<ProviderLoginState | null>;

export interface SignInAttemptOptions {
  api: SignInApi;
  provider: string;
  signedIn: () => void;
  close: () => void;
  environment?: Pick<ObservationEnvironment, "setTimeout" | "clearTimeout">;
}

export interface SignInAttempt {
  getState: () => SignInAttemptState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  answer: (promptId: string, value: string) => void;
  retry: () => void;
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
  let notified: string | undefined;
  let generation = 0;
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

  const apply = (patch: Partial<SignInAttemptState> & { attempt: ProviderLoginState | null }) => {
    publish(patch);
    if (active) notify(patch.attempt);
  };

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
  description: string | undefined;
  success: boolean;
  message: string | undefined;
  url: string | undefined;
  link: "body" | "footer" | null;
  deviceCode: string | undefined;
  prompt: LoginPrompt | undefined;
  label: string | undefined;
  busy: boolean;
  loading: boolean;
  alert: string | undefined;
  footer: { dismissLabel: string; dismissPrimary: boolean; retry: boolean } | undefined;
}

const promptLabel = (message: string) =>
  message
    .replace(/\blog ?in\b/gi, (word) => (word[0] === "L" ? "Sign-in" : "sign-in"))
    .replace(/:\s*$/, "");

export function signInDialogView({
  state: { attempt, busy, error, connectionError },
  provider,
  providers,
}: {
  state: SignInAttemptState;
  provider: string;
  providers: readonly OAuthProvider[];
}): SignInDialogView {
  const running = attempt?.status === "running";
  const success = attempt?.status === "success";
  const prompt = running ? attempt.prompt : undefined;
  const url = running ? safeUrl(attempt.url) : undefined;
  const id = attempt?.provider ?? provider;
  const name = providers.find((candidate) => candidate.id === id)?.name ?? id;
  const select = prompt?.type === "select";
  return {
    title: `Sign in to ${name}`,
    description: select
      ? (prompt.options?.length ?? 0) > 1
        ? "On another machine, choose a device-code or copy-code method."
        : undefined
      : url && !prompt
        ? "Waiting for authorization…"
        : "Follow the steps to connect your account.",
    success,
    message: prompt && !select ? undefined : attempt?.message,
    url,
    link: url ? (prompt ? "body" : "footer") : null,
    deviceCode: attempt?.userCode,
    prompt,
    label: prompt && (select ? "Method" : promptLabel(prompt.message)),
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
