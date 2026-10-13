/** Machine-wide setup of catalog MCP servers, not an MCP client for sessions. Pi owns the
 * configuration format, OAuth (discovery, registration, PKCE, refresh) and credential storage;
 * this module only decides which catalog entry to add or remove and relays Pi's sign-in prompts.
 * Nothing here mutates running sessions: a new session reads the updated setup. */
import { join } from "node:path";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
// Pi 1.1.0 exports neither its MCP credential store nor its sign-in flow. Keep these pinned
// compatibility dependencies here; McpSetup tests exercise the installed helpers. Recheck on
// every Pi upgrade and replace with a public interface when one exists (INV-12). McpConfigEntries
// holds the configuration helpers.
import { FileAuthStorageBackend } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import {
  createDefaultTransport,
  McpOAuthCredentialStore,
  McpServerConnection,
  McpServerLog,
  signInMcpServer,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.js";
import {
  MCP_CATALOG,
  type McpCatalogId,
  type McpServerSetup,
  type McpSetupRequest,
  type McpSetupState,
} from "../shared/mcp.ts";
import { authOf, McpConfigEntries } from "./McpConfigEntries.ts";
import { agentDir } from "./PiEnv.ts";
import {
  SignInAttempts,
  SignInError,
  type SignInLane,
  type SignInSource,
} from "./SignInAttempts.ts";

type CatalogServer = { id: McpCatalogId; name: string; url: string };
/** Where the entry signs in, when Pi authenticates it with MCP OAuth. */
const oauthUrl = (entry: McpServerEntry) => {
  const auth = authOf(entry.config);
  return auth._tag === "oauth" ? auth.url : undefined;
};

export const McpSetupEnvironment = Context.Reference<{
  directory: () => string;
  /** The catalog's endpoints; tests point them at a local server. */
  servers: () => readonly CatalogServer[];
}>("piano/McpSetupEnvironment", {
  defaultValue: () => ({ directory: agentDir, servers: () => MCP_CATALOG }),
});

export class McpSetupError extends Data.TaggedError("McpSetupError")<{ readonly detail: string }> {}
export class McpSetup extends Context.Service<
  McpSetup,
  {
    readonly state: Effect.Effect<McpSetupState>;
    readonly change: (request: McpSetupRequest) => Effect.Effect<McpSetupState, McpSetupError>;
    /** Sign-in to an installed catalog server, by its id; shaped as provider sign-in so the
     * browser shares one dialog. */
    readonly signIn: SignInLane;
  }
>()("piano/McpSetup") {}

export const McpSetupLive = Layer.effect(
  McpSetup,
  Effect.gen(function* () {
    const environment = yield* McpSetupEnvironment;
    const directory = environment.directory();
    const entries = yield* McpConfigEntries(directory);
    const credentials = new McpOAuthCredentialStore(
      new FileAuthStorageBackend(join(directory, "mcp-auth.json")),
      directory,
    );
    const catalog = (id: string) => {
      const server = environment.servers().find((server) => server.id === id);
      if (!server) throw new Error("Unknown MCP server.");
      return server;
    };
    const find = entries.find;
    const setup = (server: CatalogServer): McpServerSetup => {
      const observed = entries.observe(server);
      const detail = observed.status === "blocked" ? { detail: observed.detail } : {};
      if (!observed.entry)
        return { id: server.id, status: observed.status, oauth: true, signedIn: false, ...detail };
      const { entry, removalKey } = observed;
      const url = oauthUrl(entry);
      try {
        return {
          id: server.id,
          status: observed.status,
          oauth: !!url,
          signedIn: !!url && !!credentials.tokens(entry.name, url),
          removalKey,
          ...detail,
        };
      } catch {
        return {
          id: server.id,
          status: "blocked",
          oauth: !!url,
          signedIn: false,
          detail: "Check Pi's MCP credentials before continuing.",
        };
      }
    };
    const snapshot = (): McpSetupState => ({ servers: environment.servers().map(setup) });
    const writing = <A>(change: Effect.Effect<A, unknown>, detail: string) =>
      change.pipe(
        Effect.mapError(() => new McpSetupError({ detail })),
        Effect.map(snapshot),
      );

    // Its own lane, apart from provider sign-in: Pi's MCP callback reuses the registered client's port or
    // takes a free one, not a provider's fixed port, and a provider attempt this dialog cannot show must
    // not block it. Success stores a token only; the cached catalogs and commands do not depend on it.
    const attempts = yield* SignInAttempts.make({
      busy: "A sign-in is already in progress. Finish it before starting another.",
      afterSuccess: Effect.void,
    });
    const failure = (detail: string) => new McpSetupError({ detail });
    const signedInEntry = (id: string) => {
      const server = catalog(id);
      const entry = find(server);
      const url = entry && oauthUrl(entry);
      if (!entry || !url) throw new Error(`Install ${server.name} MCP before signing in.`);
      return { server, entry, url };
    };

    const source = (server: CatalogServer, entry: McpServerEntry, url: string): SignInSource => ({
      message: `Connecting to ${server.name}…`,
      // OAuth errors may include token response bodies. Never deliver or log them.
      failure: `Sign-in to ${server.name} failed. Check the authorization and try again.`,
      run: async ({ signal, show, ask }) => {
        let redirect: URL | undefined;
        // Check the pasted address before accepting it, so a mistyped paste asks again instead of failing the sign-in.
        const check = (value: string) => {
          let pasted: URL | undefined;
          try {
            pasted = new URL(value.trim());
          } catch {
            /* reported below */
          }
          if (
            !redirect ||
            !pasted ||
            pasted.origin !== redirect.origin ||
            pasted.pathname !== redirect.pathname ||
            pasted.searchParams.get("state") !== redirect.searchParams.get("state") ||
            !(pasted.searchParams.get("code") || pasted.searchParams.get("error"))
          ) {
            return "Paste the full address of the page your browser opened after approving.";
          }
        };
        const connection = new McpServerConnection({
          entry,
          cwd: directory,
          createTransport: createDefaultTransport,
          credentials,
          log: new McpServerLog(join(directory, "mcp.log")),
          onTools: () => {},
        });
        try {
          // Connecting first answers whether a sign-in is needed and records the server's challenge, as `pi mcp login` does.
          try {
            await connection.getClient();
            return { status: "success", message: `Already signed in to ${server.name}.` };
          } catch {
            if (connection.state !== "needs-auth")
              return {
                status: "error",
                message: `Could not reach ${server.name} MCP. Check the network and try again.`,
              };
          }
          await signInMcpServer({
            serverUrl: url,
            store: credentials.forServer(entry.name, url),
            settings: connection.oauthSettings(),
            challenge: connection.challenge,
            signal,
            prompt: {
              showAuthorizationUrl: (authorization) => {
                if (!["https:", "http:"].includes(authorization.protocol))
                  throw new Error("Unsupported authorization URL.");
                redirect = new URL(
                  authorization.searchParams.get("redirect_uri") ?? "http://127.0.0.1/callback",
                );
                redirect.searchParams.set("state", authorization.searchParams.get("state") ?? "");
                show({ url: authorization.href, message: `Approve access in ${server.name}.` });
              },
              // Piano often runs on another machine than the browser, whose redirect to Pi's loopback
              // callback then fails; the user pastes that address instead. A callback that does arrive aborts this.
              promptForRedirectUrl: (promptSignal) =>
                ask(
                  {
                    type: "text",
                    message: "If the page after approving does not load, paste its address here.",
                    placeholder: `${redirect?.origin ?? "http://127.0.0.1"}/callback?code=…`,
                  },
                  { signal: promptSignal, check },
                ).catch(() => undefined),
            },
          });
          connection.challenge = undefined;
          await connection.reconnect();
          return {
            status: "success",
            message: `Signed in. Start a new session to use ${server.name} tools.`,
          };
        } finally {
          await connection.close().catch(() => undefined);
        }
      },
    });

    return McpSetup.of({
      state: Effect.sync(snapshot),
      change: (request) => {
        switch (request.action) {
          case "install":
            return writing(
              Effect.try(() => catalog(request.server)).pipe(
                // Any existing entry for the endpoint is kept as the user configured it.
                Effect.flatMap((server) =>
                  entries.save(server, (existing) => (existing ? undefined : { url: server.url })),
                ),
              ),
              "Could not install this MCP server. Check Pi's global configuration and file permissions, then refresh.",
            );
          case "uninstall":
            return writing(
              Effect.try(() => {
                if (attempts.busy(request.server)) throw new Error("Sign-in in progress.");
                return catalog(request.server);
              }).pipe(
                Effect.flatMap((server) => entries.remove(server, request.removalKey)),
                // Stored tokens without a configuration have no other place in Piano to be removed.
                Effect.flatMap((entry) =>
                  Effect.try(() => {
                    const url = oauthUrl(entry);
                    if (url) credentials.remove(entry.name, url);
                  }),
                ),
              ),
              "Could not uninstall this MCP server. Its configuration may have changed. Refresh and confirm again.",
            );
          case "sign-out":
            return Effect.try({
              try: () => {
                if (attempts.busy()) throw new Error("Sign-in in progress.");
                const { entry, url } = signedInEntry(request.server);
                credentials.remove(entry.name, url);
                return snapshot();
              },
              catch: () =>
                failure(
                  "Could not sign out. Finish any sign-in in progress and refresh before retrying.",
                ),
            });
        }
      },
      signIn: attempts.lane((id) =>
        Effect.try({
          try: () => {
            const { server, entry, url } = signedInEntry(id);
            return source(server, entry, url);
          },
          catch: (cause) =>
            new SignInError({
              detail: cause instanceof Error ? cause.message : "Could not start sign-in.",
            }),
        }),
      ),
    });
  }),
);
