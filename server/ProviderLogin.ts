/** Global OAuth orchestration only. Pi's SDK owns provider configuration, token
 * exchange and locked credential persistence; no agent/session is embedded here.
 * SignInAttempts owns the attempt itself; this module is its provider source.
 * A completed sign-in or sign-out changes the usable models, so this service
 * invalidates the model catalogs itself rather than relying on a client to poll. */
import { CredentialSynchronizationError, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";
import type { OAuthProvider, ProviderLoginState } from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { agentDir } from "./PiEnv.ts";
import { SignInAttempts, SignInError, type SignInSource } from "./SignInAttempts.ts";

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
  readonly start: (provider: string) => Effect.Effect<ProviderLoginState, SignInError>;
  readonly answer: (id: string, promptId: string, value: string) => Effect.Effect<ProviderLoginState, SignInError>;
  readonly cancel: (id: string) => Effect.Effect<ProviderLoginState, SignInError>;
  readonly signOut: (provider: string) => Effect.Effect<void, SignInError>;
}>()("piano/ProviderLogin") {}

export const ProviderLoginLive = Layer.effect(ProviderLogin, Effect.gen(function* () {
  const factory = yield* ProviderLoginRuntime;
  const facts = yield* DirectoryFacts;
  // One lane for every provider: several providers bind the same loopback callback port, and a
  // sign-out must not race a sign-in. A completed sign-in changes the usable models, so the model
  // catalogs are invalidated before success is reported and a client that sees it re-probes fresh models.
  const attempts = yield* SignInAttempts.make({
    busy: "A provider operation is already in progress. Finish it before signing in.",
    afterSuccess: facts.invalidate,
  });
  const source = (provider: string): SignInSource => ({
    // Provider errors may include token response bodies. Never deliver or log them.
    failure: "Sign-in failed. Check the provider authorization and try again.",
    run: async ({ signal, show, ask }) => {
      const interaction: Interaction = {
        signal,
        notify: event => {
          if (event.type === "auth_url") show({ url: event.url, message: event.instructions, userCode: undefined });
          else if (event.type === "device_code") show({ url: event.verificationUri, userCode: event.userCode, message: "Open the sign-in page and enter this code." });
          else show({ message: event.message });
        },
        prompt: prompt => ask({ type: prompt.type, message: prompt.message,
          ...(prompt.type === "select" ? { options: prompt.options } : { placeholder: prompt.placeholder }) }, { signal: prompt.signal }),
      };
      const runtime = await factory.create();
      if (signal.aborted) throw new Error("Sign-in cancelled.");
      if (provider === "openai-codex" || !runtime.getProviders().some(p => p.id === provider && p.auth.oauth)) {
        return { status: "error", message: "This provider does not support OAuth sign-in in Piano." };
      }
      if ((await runtime.listCredentials()).some(c => c.providerId === provider && c.type === "oauth")) {
        return { status: "error", message: "Sign out of this provider before signing in again." };
      }
      if (signal.aborted) throw new Error("Sign-in cancelled.");
      try {
        await runtime.login(provider, "oauth", interaction, { getDeviceId: factory.deviceId });
      } catch (cause) {
        if (cause instanceof CredentialSynchronizationError && cause.operation === "login") {
          return { status: "success", message: "Credentials saved. Start a new session to reload the provider catalog." };
        }
        throw cause;
      }
      return { status: "success", message: "Signed in. Start a new session to use the updated providers." };
    },
  });
  return ProviderLogin.of({
    providers: Effect.tryPromise(async () => {
      const runtime = await factory.create();
      // Read Pi's credential metadata, not tokens or the availability cache.
      const signedIn = new Set((await runtime.listCredentials()).filter(c => c.type === "oauth").map(c => c.providerId));
      return runtime.getProviders().filter(p => p.auth.oauth && p.id !== "openai-codex")
        .map(p => ({ id: p.id, name: p.name, signedIn: signedIn.has(p.id) }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }),
    state: attempts.state,
    start: provider => attempts.start(provider, source(provider)),
    answer: attempts.answer,
    cancel: attempts.cancel,
    signOut: provider => attempts.exclusive(Effect.tryPromise({
      try: async () => {
        const runtime = await factory.create();
        if (!runtime.getProviders().some(p => p.id === provider && p.auth.oauth)
          || !(await runtime.listCredentials()).some(c => c.providerId === provider && c.type === "oauth")) {
          throw new Error("No OAuth credential for this provider.");
        }
        try { await runtime.logout(provider); }
        catch (cause) {
          // The credential was removed even if refreshing Pi's local snapshot failed.
          if (!(cause instanceof CredentialSynchronizationError && cause.operation === "logout")) throw cause;
        }
      },
      catch: () => new SignInError({ detail: "Could not sign out. Finish any sign-in in progress and try again." }),
    }).pipe(Effect.andThen(facts.invalidate), Effect.andThen(attempts.forget(provider))),
    "Could not sign out. Finish any sign-in in progress and try again."),
  });
}));
