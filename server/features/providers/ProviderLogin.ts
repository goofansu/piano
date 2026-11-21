import {
  CredentialSynchronizationError,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
import {
  API_KEY_PROVIDERS,
  type ApiKeyProvider,
  ProviderApiKeyChange,
} from "../../../shared/features/providers/providerApiKeys.ts";
import { readApiKey } from "../../../shared/literalSecret.ts";
import type { OAuthProvider } from "../../../shared/wire.ts";
import { DirectoryFacts } from "../../shared/DirectoryFacts.ts";
import { agentDir } from "../../shared/PiEnv.ts";
import {
  SignInAttempts,
  SignInError,
  type SignInLane,
  type SignInSource,
} from "../../shared/SignInAttempts.ts";

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

export class ProvidersError extends Data.TaggedError("ProvidersError")<{
  readonly detail: string;
}> {}

export class ProviderLogin extends Context.Service<
  ProviderLogin,
  {
    readonly providers: Effect.Effect<readonly OAuthProvider[], ProvidersError>;
    readonly signIn: SignInLane;
    readonly signOut: (provider: string) => Effect.Effect<void, SignInError>;
    readonly apiKeys: Effect.Effect<readonly ApiKeyProvider[], ProvidersError>;
    readonly changeApiKey: (change: ProviderApiKeyChange) => Effect.Effect<void, SignInError>;
  }
>()("piano/ProviderLogin") {}

const signedIn = async (runtime: Runtime, signal?: AbortSignal) =>
  new Set(
    (await runtime.listCredentials({ signal }))
      .filter((c) => c.type === "oauth")
      .map((c) => c.providerId),
  );

const oauthProvider = (runtime: Runtime, id: string) =>
  id !== "openai-codex" && runtime.getProviders().some((p) => p.id === id && p.auth.oauth);

const apiKeyProvider = (runtime: Runtime, id: string) =>
  API_KEY_PROVIDERS.some((p) => p.id === id) &&
  runtime.getProviders().some((p) => p.id === id && p.auth.apiKey);

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
    const attempts = yield* SignInAttempts.make({
      busy: "A provider operation is already in progress. Finish it before signing in.",
      afterSuccess: facts.invalidate,
    });
    const source = (provider: string): SignInSource => ({
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
    const write = Effect.fn("ProviderLogin.write")(function* (
      {
        busy,
        failure,
        after = Effect.void,
      }: { busy: string; failure: string; after?: Effect.Effect<void> },
      run: (runtime: Runtime) => Promise<void>,
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
        const read = change.action === "save" ? readApiKey(change.key) : undefined;
        if (read?.refusal !== undefined) return yield* new SignInError({ detail: read.refusal });
        const key = read?.value ?? "";
        yield* write(
          {
            busy: "A provider operation is already in progress. Finish it before changing an API key.",
            failure: "Could not change API key. Check the key and try again.",
          },
          async (runtime) => {
            if (!apiKeyProvider(runtime, change.provider))
              throw new Error("Unsupported API-key provider.");
            const credential = (await runtime.listCredentials()).find(
              (c) => c.providerId === change.provider,
            );
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
                    return key;
                  },
                }),
              );
          },
        );
      }),
      signIn: attempts.lane((provider) => Effect.succeed(source(provider))),
      signOut: Effect.fn("ProviderLogin.signOut")(function* (provider) {
        yield* write(
          {
            busy: "Could not sign out. Finish any sign-in in progress and try again.",
            failure: "Could not sign out. Refresh and try again.",
            after: attempts.forget(provider),
          },
          async (runtime) => {
            if (!oauthProvider(runtime, provider) || !(await signedIn(runtime)).has(provider))
              throw new Error("No OAuth credential for this provider.");
            await persisted("logout", () => runtime.logout(provider));
          },
        );
      }),
    });
  }),
);
