/** Global provider credential orchestration. Pi's SDK owns provider configuration, token
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
import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  API_KEY_INVALID,
  API_KEY_PROVIDERS,
  type ApiKeyProvider,
  ProviderApiKeyChange,
} from "../shared/providerApiKeys.ts";
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
    readonly apiKeys: Effect.Effect<readonly ApiKeyProvider[], ProvidersError>;
    readonly changeApiKey: (change: ProviderApiKeyChange) => Effect.Effect<void, SignInError>;
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

/** Piano's OAuth providers: those Pi signs in to with OAuth, except openai-codex. The one rule
 * behind the Providers list, sign-in and sign-out, so none accepts a provider another refuses. */
const oauthProvider = (runtime: Runtime, id: string) =>
  id !== "openai-codex" && runtime.getProviders().some((p) => p.id === id && p.auth.oauth);

/** Piano's API-key providers: Pi's single-key providers that the setup catalog names. */
const apiKeyProvider = (runtime: Runtime, id: string) =>
  API_KEY_PROVIDERS.some((p) => p.id === id) &&
  runtime.getProviders().some((p) => p.id === id && p.auth.apiKey);

/** A credential write through Pi. Pi persists the credential before refreshing its local
 * snapshot, so a `CredentialSynchronizationError` for this `operation` means the write succeeded
 * and only the refresh did not: `false`, never a failed write. Anything else is rethrown. */
const persisted = async (
  operation: "login" | "logout",
  write: () => Promise<unknown>,
): Promise<boolean> => {
  try {
    await write();
    return true;
  } catch (cause) {
    if (cause instanceof CredentialSynchronizationError && cause.operation === operation)
      return false;
    throw cause;
  }
};

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
        if (!oauthProvider(runtime, provider)) {
          return {
            status: "error",
            message: "This provider does not support OAuth sign-in in Piano.",
          };
        }
        if ((await signedIn(runtime)).has(provider)) {
          return { status: "error", message: "Sign out of this provider before signing in again." };
        }
        if (signal.aborted) throw new Error("Sign-in cancelled.");
        const refreshed = await persisted("login", () =>
          runtime.login(provider, "oauth", interaction, { getDeviceId: factory.deviceId }),
        );
        return {
          status: "success",
          message: refreshed
            ? "Signed in. Start a new session to use the updated providers."
            : "Credentials saved. Start a new session to reload the provider catalog.",
        };
      },
    });
    /** A credential write through Pi, on the sign-in lane so no attempt overlaps it. Once the
     * lane is claimed, persistence, catalog invalidation and `after` finish even if the HTTP
     * client disconnects: releasing early would let another write race Pi's promise, and a
     * credential Pi persisted must change the usable models (INV-02). `run` refuses by throwing;
     * `failure` is all the person sees of why (INV-11). */
    const write = Effect.fn("ProviderLogin.write")(function* (
      busy: string,
      failure: string,
      run: (runtime: Runtime) => Promise<void>,
      after: Effect.Effect<void> = Effect.void,
    ) {
      yield* attempts
        .exclusive(
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: async () => run(await factory.create()),
              catch: () => new SignInError({ detail: failure }),
            });
            yield* facts.invalidate;
            yield* after;
          }),
          busy,
        )
        .pipe(Effect.uninterruptible);
    });
    return ProviderLogin.of({
      providers: Effect.tryPromise({
        try: async () => {
          const runtime = await factory.create();
          const oauth = await signedIn(runtime);
          return runtime
            .getProviders()
            .filter((p) => oauthProvider(runtime, p.id))
            .map((p) => ({ id: p.id, name: p.name, signedIn: oauth.has(p.id) }))
            .sort((a, b) => a.id.localeCompare(b.id));
        },
        catch: () => new ProvidersError({ detail: "Could not load OAuth providers." }),
      }),
      apiKeys: Effect.tryPromise({
        try: async () => {
          const runtime = await factory.create();
          const credentials = await runtime.listCredentials();
          return API_KEY_PROVIDERS.filter((entry) => apiKeyProvider(runtime, entry.id)).map(
            (entry) => ({
              ...entry,
              saved: credentials.some((c) => c.providerId === entry.id && c.type === "api_key"),
            }),
          );
        },
        catch: () => new ProvidersError({ detail: "Could not load API keys." }),
      }),
      changeApiKey: Effect.fn("ProviderLogin.changeApiKey")(function* (change) {
        yield* Schema.decodeUnknownEffect(ProviderApiKeyChange)(change).pipe(
          Effect.mapError(() => new SignInError({ detail: API_KEY_INVALID })),
        );
        yield* write(
          "A provider operation is already in progress. Finish it before changing an API key.",
          "Could not change API key. Check the key and try again.",
          async (runtime) => {
            if (!apiKeyProvider(runtime, change.provider))
              throw new Error("Unsupported API-key provider.");
            const credential = (await runtime.listCredentials()).find(
              (c) => c.providerId === change.provider,
            );
            // Never overwrite/remove an OAuth credential through the API Keys surface.
            if (credential && credential.type !== "api_key") throw new Error("Not an API key.");
            if (change.action === "remove" && !credential) throw new Error("No saved key.");
            if (change.action === "remove")
              await persisted("logout", () => runtime.logout(change.provider));
            else
              await persisted("login", () =>
                runtime.login(change.provider, "api_key", {
                  signal: new AbortController().signal,
                  notify: () => {},
                  prompt: async (prompt) => {
                    if (prompt.type !== "secret") throw new Error("Unsupported API-key prompt.");
                    return change.key;
                  },
                }),
              );
          },
        );
      }),
      // The flow itself reports a provider without OAuth sign-in, so the attempt shows why.
      signIn: attempts.lane((provider) => Effect.succeed(source(provider))),
      signOut: Effect.fn("ProviderLogin.signOut")(function* (provider) {
        const refused = "Could not sign out. Finish any sign-in in progress and try again.";
        yield* write(
          refused,
          refused,
          async (runtime) => {
            if (!oauthProvider(runtime, provider) || !(await signedIn(runtime)).has(provider))
              throw new Error("No OAuth credential for this provider.");
            await persisted("logout", () => runtime.logout(provider));
          },
          attempts.forget(provider),
        );
      }),
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
