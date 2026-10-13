/** Global OAuth orchestration only. Pi's SDK owns provider configuration, token
 * exchange and locked credential persistence; no agent/session is embedded here.
 * SignInAttempts owns the attempt itself; this module is its provider source.
 * It is Piano's only reader of Pi credentials, so one signed-in rule serves the Providers UI,
 * sign-out and features such as sharing that act on the user's behalf.
 * A completed sign-in or sign-out changes the usable models, so this service
 * invalidates the model catalogs itself rather than relying on a client to poll. */
import {
  CredentialSynchronizationError,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import type { OAuthProvider } from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { agentDir } from "./PiEnv.ts";
import {
  SignInAttempts,
  SignInError,
  type SignInLane,
  type SignInSource,
} from "./SignInAttempts.ts";

type Interaction = Parameters<ModelRuntime["login"]>[2];
type Runtime = Pick<
  ModelRuntime,
  "getProviders" | "listCredentials" | "getAuth" | "login" | "logout"
>;
export const ProviderLoginRuntime = Context.Reference<{
  create: (signal?: AbortSignal) => Promise<Runtime>;
  deviceId: () => string;
}>("piano/ProviderLoginRuntime", {
  defaultValue: () => ({
    create: (signal) => ModelRuntime.create({ refreshOnCreate: false, signal }),
    deviceId: () => SettingsManager.create(process.cwd(), agentDir()).getOrCreateDeviceId(),
  }),
});

/** Pi's providers could not be read; `detail` is the text shown to the person. Pi's own error may
 * name local files, so it never reaches the detail; the user can only retry. */
export class ProvidersError extends Data.TaggedError("ProvidersError")<{
  readonly detail: string;
}> {}

export class ProviderLogin extends Context.Service<
  ProviderLogin,
  {
    readonly providers: Effect.Effect<readonly OAuthProvider[], ProvidersError>;
    /** Sign-in to a provider, by its id. */
    readonly signIn: SignInLane;
    readonly signOut: (provider: string) => Effect.Effect<void, SignInError>;
    /** A bearer token valid for at least five more minutes, only while the user is signed in to
     * the provider; undefined otherwise. Ambient API keys never authorize a Piano feature. */
    readonly bearer: (provider: string) => Effect.Effect<string | undefined, Error>;
  }
>()("piano/ProviderLogin") {}

/** Piano's one signed-in rule: Pi holds an OAuth credential for the provider. Reads Pi's
 * credential metadata, not tokens or the availability cache. */
const signedIn = async (runtime: Runtime, signal?: AbortSignal) =>
  new Set(
    (await runtime.listCredentials({ signal }))
      .filter((c) => c.type === "oauth")
      .map((c) => c.providerId),
  );

export const ProviderLoginLive = Layer.effect(
  ProviderLogin,
  Effect.gen(function* () {
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
          notify: (event) => {
            if (event.type === "auth_url")
              show({ url: event.url, message: event.instructions, userCode: undefined });
            else if (event.type === "device_code")
              show({
                url: event.verificationUri,
                userCode: event.userCode,
                message: "Open the sign-in page and enter this code.",
              });
            else show({ message: event.message });
          },
          prompt: (prompt) =>
            ask(
              {
                type: prompt.type,
                message: prompt.message,
                ...(prompt.type === "select"
                  ? { options: prompt.options }
                  : { placeholder: prompt.placeholder }),
              },
              { signal: prompt.signal },
            ),
        };
        const runtime = await factory.create();
        if (signal.aborted) throw new Error("Sign-in cancelled.");
        if (
          provider === "openai-codex" ||
          !runtime.getProviders().some((p) => p.id === provider && p.auth.oauth)
        ) {
          return {
            status: "error",
            message: "This provider does not support OAuth sign-in in Piano.",
          };
        }
        if ((await signedIn(runtime)).has(provider)) {
          return { status: "error", message: "Sign out of this provider before signing in again." };
        }
        if (signal.aborted) throw new Error("Sign-in cancelled.");
        try {
          await runtime.login(provider, "oauth", interaction, { getDeviceId: factory.deviceId });
        } catch (cause) {
          if (cause instanceof CredentialSynchronizationError && cause.operation === "login") {
            return {
              status: "success",
              message: "Credentials saved. Start a new session to reload the provider catalog.",
            };
          }
          throw cause;
        }
        return {
          status: "success",
          message: "Signed in. Start a new session to use the updated providers.",
        };
      },
    });
    return ProviderLogin.of({
      providers: Effect.tryPromise({
        try: async () => {
          const runtime = await factory.create();
          const oauth = await signedIn(runtime);
          return runtime
            .getProviders()
            .filter((p) => p.auth.oauth && p.id !== "openai-codex")
            .map((p) => ({ id: p.id, name: p.name, signedIn: oauth.has(p.id) }))
            .sort((a, b) => a.id.localeCompare(b.id));
        },
        catch: () => new ProvidersError({ detail: "Could not load OAuth providers." }),
      }),
      // The flow itself reports a provider without OAuth sign-in, so the attempt shows why.
      signIn: attempts.lane((provider) => Effect.succeed(source(provider))),
      signOut: (provider) =>
        attempts.exclusive(
          Effect.tryPromise({
            try: async () => {
              const runtime = await factory.create();
              if (
                !runtime.getProviders().some((p) => p.id === provider && p.auth.oauth) ||
                !(await signedIn(runtime)).has(provider)
              ) {
                throw new Error("No OAuth credential for this provider.");
              }
              try {
                await runtime.logout(provider);
              } catch (cause) {
                // The credential was removed even if refreshing Pi's local snapshot failed.
                if (
                  !(cause instanceof CredentialSynchronizationError && cause.operation === "logout")
                )
                  throw cause;
              }
            },
            catch: () =>
              new SignInError({
                detail: "Could not sign out. Finish any sign-in in progress and try again.",
              }),
          }).pipe(Effect.andThen(facts.invalidate), Effect.andThen(attempts.forget(provider))),
          "Could not sign out. Finish any sign-in in progress and try again.",
        ),
      bearer: Effect.fn("ProviderLogin.bearer")(function* (provider: string) {
        return yield* Effect.tryPromise(async (signal) => {
          const runtime = await factory.create(signal);
          if (!(await signedIn(runtime, signal)).has(provider)) return undefined;
          const auth = await runtime.getAuth(provider, { minOAuthValidityMs: 300_000, signal });
          const authorization = Object.entries(auth?.auth.headers ?? {}).find(
            ([name]) => name.toLowerCase() === "authorization",
          )?.[1];
          return (
            auth?.auth.apiKey ??
            (authorization ? /^Bearer\s+(.+)$/iu.exec(authorization)?.[1] : undefined)
          );
        });
      }),
    });
  }),
);
