/** Global OAuth orchestration only. Pi's SDK owns provider configuration, token
 * exchange and locked credential persistence; no agent/session is embedded here. */
import { CredentialSynchronizationError, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";
import type { OAuthProvider, ProviderLoginState } from "../shared/wire.ts";
import { agentDir } from "./PiEnv.ts";

type Interaction = Parameters<ModelRuntime["login"]>[2];
type Runtime = Pick<ModelRuntime, "getProviders" | "listCredentials" | "login" | "logout">;
export const ProviderLoginRuntime = Context.Reference<{ create: () => Promise<Runtime>; deviceId: () => string }>("piano/ProviderLoginRuntime", {
  defaultValue: () => ({
    create: () => ModelRuntime.create({ refreshOnCreate: false }),
    deviceId: () => SettingsManager.create(process.cwd(), agentDir()).getOrCreateDeviceId(),
  }),
});

export class ProviderLogin extends Context.Service<ProviderLogin, {
  readonly providers: Effect.Effect<readonly OAuthProvider[], Error>;
  readonly state: Effect.Effect<ProviderLoginState | null>;
  readonly start: (provider: string) => Effect.Effect<ProviderLoginState, Error>;
  readonly answer: (id: string, promptId: string, value: string) => Effect.Effect<ProviderLoginState, Error>;
  readonly cancel: (id: string) => Effect.Effect<ProviderLoginState, Error>;
  readonly signOut: (provider: string) => Effect.Effect<void, Error>;
}>()("piano/ProviderLogin") {}

export const ProviderLoginLive = Layer.effect(ProviderLogin, Effect.gen(function* () {
  const factory = yield* ProviderLoginRuntime;
  let current: { state: ProviderLoginState; abort: AbortController; done: Promise<void>; active: boolean } | undefined;
  let pending: { id: string; resolve: (value: string) => void; reject: (error: Error) => void } | undefined;
  let signingOut = false;
  const snapshot = () => current ? structuredClone(current.state) : null;
  const error = (message: string) => new Error(message);
  const cancel = (message: string) => {
    if (current?.state.status !== "running") return;
    current.state = { id: current.state.id, provider: current.state.provider, status: "cancelled", message };
    current.abort.abort();
  };
  yield* Effect.addFinalizer(() => Effect.promise(async () => {
    cancel("Sign-in cancelled: Piano stopped.");
    await current?.done;
  }));
  return ProviderLogin.of({
    providers: Effect.tryPromise(async () => {
      const runtime = await factory.create();
      // Read Pi's credential metadata, not tokens or the availability cache.
      const signedIn = new Set((await runtime.listCredentials()).filter(c => c.type === "oauth").map(c => c.providerId));
      return runtime.getProviders().filter(p => p.auth.oauth)
        .map(p => ({ id: p.id, name: p.auth.oauth!.name, signedIn: signedIn.has(p.id) }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }),
    state: Effect.sync(snapshot),
    start: provider => Effect.try(() => {
      // Serialize globally: several providers bind the same loopback callback port.
      if (signingOut || current?.active) throw error("A provider operation is already in progress. Finish it before signing in.");
      const attempt = { state: { id: crypto.randomUUID(), provider, status: "running" } as ProviderLoginState,
        abort: new AbortController(), done: Promise.resolve(), active: true };
      current = attempt;
      const signal = attempt.abort.signal;
      const timer = setTimeout(() => cancel("Sign-in expired. Please try again."), 15 * 60_000);
      const interaction: Interaction = {
        signal,
        notify: event => {
          if (signal.aborted) return;
          if (event.type === "auth_url") Object.assign(attempt.state, { url: event.url, message: event.instructions, userCode: undefined });
          else if (event.type === "device_code") Object.assign(attempt.state, { url: event.verificationUri, userCode: event.userCode, message: "Open the sign-in page and enter this code." });
          else attempt.state.message = event.message;
        },
        prompt: prompt => new Promise<string>((resolve, reject) => {
          const promptSignal = prompt.signal ? AbortSignal.any([signal, prompt.signal]) : signal;
          if (promptSignal.aborted) { reject(error("Sign-in cancelled.")); return; }
          const id = crypto.randomUUID();
          const finish = (value?: string, failure?: Error) => {
            promptSignal.removeEventListener("abort", aborted);
            if (pending?.id === id) pending = undefined;
            if (attempt.state.prompt?.id === id) delete attempt.state.prompt;
            if (failure) reject(failure); else resolve(value!);
          };
          const aborted = () => finish(undefined, error("Sign-in cancelled."));
          attempt.state.prompt = { id, type: prompt.type, message: prompt.message,
            ...(prompt.type === "select" ? { options: prompt.options } : { placeholder: prompt.placeholder }) };
          pending = { id, resolve: value => finish(value), reject: failure => finish(undefined, failure) };
          promptSignal.addEventListener("abort", aborted, { once: true });
        }),
      };
      attempt.done = (async () => {
        try {
          const runtime = await factory.create();
          if (signal.aborted) return;
          if (!runtime.getProviders().some(p => p.id === provider && p.auth.oauth)) {
            attempt.state = { id: attempt.state.id, provider, status: "error", message: "This provider does not support OAuth sign-in in Piano." };
            return;
          }
          if ((await runtime.listCredentials()).some(c => c.providerId === provider && c.type === "oauth")) {
            attempt.state = { id: attempt.state.id, provider, status: "error", message: "Sign out of this provider before signing in again." };
            return;
          }
          if (signal.aborted) return;
          await runtime.login(provider, "oauth", interaction, { getDeviceId: factory.deviceId });
          attempt.state = { id: attempt.state.id, provider, status: "success", message: "Signed in. Start a new session to use the updated providers." };
        } catch (cause) {
          if (cause instanceof CredentialSynchronizationError && cause.operation === "login") {
            attempt.state = { id: attempt.state.id, provider, status: "success", message: "Credentials saved. Start a new session to reload the provider catalog." };
          } else if (!signal.aborted) {
            // Provider errors may include token response bodies. Never deliver or log them.
            attempt.state = { id: attempt.state.id, provider, status: "error", message: "Sign-in failed. Check the provider authorization and try again." };
          }
        } finally {
          clearTimeout(timer);
          pending?.reject(error("Sign-in finished."));
          attempt.active = false;
        }
      })();
      return snapshot()!;
    }),
    answer: (id, promptId, value) => Effect.try(() => {
      const prompt = current?.state.prompt;
      if (current?.state.id !== id || current.state.status !== "running" || prompt?.id !== promptId || pending?.id !== promptId) throw error("This sign-in prompt has already closed. Refresh and try again.");
      if (prompt.type === "select" && !prompt.options?.some(o => o.id === value)) throw error("Choose one of the offered options.");
      // Claim synchronously before resolving; competing tabs cannot answer twice.
      const claim = pending;
      pending = undefined;
      claim.resolve(value);
      return snapshot()!;
    }),
    signOut: provider => Effect.tryPromise({
      try: async () => {
        // Claim before awaiting so another tab cannot race login with logout.
        if (signingOut || current?.active) throw error("Provider operation in progress.");
        signingOut = true;
        try {
          const runtime = await factory.create();
          if (!runtime.getProviders().some(p => p.id === provider && p.auth.oauth)
            || !(await runtime.listCredentials()).some(c => c.providerId === provider && c.type === "oauth")) {
            throw error("No OAuth credential for this provider.");
          }
          try { await runtime.logout(provider); }
          catch (cause) {
            // The credential was removed even if refreshing Pi's local snapshot failed.
            if (!(cause instanceof CredentialSynchronizationError && cause.operation === "logout")) throw cause;
          }
          if (current?.state.provider === provider) current = undefined;
        } finally { signingOut = false; }
      },
      catch: () => error("Could not sign out. Finish any sign-in in progress and try again."),
    }),
    cancel: id => Effect.try(() => {
      if (current?.state.id !== id) throw error("This sign-in is no longer current.");
      cancel("Sign-in cancelled.");
      return snapshot()!;
    }),
  });
}));
