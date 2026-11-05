/** Machine-wide setup of MCP servers in Pi's global configuration, not an MCP client for sessions.
 * Pi owns the configuration format and its validation, OAuth (discovery, registration, PKCE,
 * refresh) and credential storage; this module decides which entries to add, change or remove,
 * installs catalog servers by their known endpoint or command, and relays Pi's sign-in prompts.
 * Nothing here mutates running sessions: a new session reads the updated setup. */
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig, McpServerEntry } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer } from "effect";
// Pi 1.4.0 exports neither its MCP credential store nor its sign-in flow. Keep these pinned
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
  type McpCatalogServer,
  type McpServerConfigView,
  type McpServerEdit,
  type McpServerSetup,
  type McpSetupRequest,
  type McpSetupState,
} from "../shared/mcp.ts";
import {
  authOf,
  isCommandEntry,
  isTarget,
  type McpCatalogTarget,
  McpConfigEntries,
  McpConfigEntryError,
  removalKey,
} from "./McpConfigEntries.ts";
import { agentDir } from "./PiEnv.ts";
import {
  SignInAttempts,
  SignInError,
  type SignInLane,
  type SignInSource,
} from "./SignInAttempts.ts";

type CatalogServer = McpCatalogTarget & { readonly id: McpCatalogId };
/** Where the entry signs in, when Pi authenticates it with MCP OAuth. */
const oauthUrl = (entry: McpServerEntry) => {
  const auth = authOf(entry.config);
  return auth._tag === "oauth" ? auth.url : undefined;
};
/** The catalog as this machine reaches it: a local CLI's path is resolved against the home
 * directory of the account running Piano here, so no filesystem path is on the wire (INV-11). */
const catalogServers = (): readonly CatalogServer[] =>
  MCP_CATALOG.map(({ id, name, command, url }: McpCatalogServer) =>
    command
      ? {
          id,
          name,
          command: join(
            homedir(),
            (process.platform === "win32" && command.windows) || command.home,
          ),
          args: command.args,
        }
      : { id, name, url },
  );
/** What a new catalog entry configures. */
const configOf = (server: CatalogServer): McpServerConfig =>
  isCommandEntry(server)
    ? { command: server.command, args: [...server.args] }
    : { url: server.url };

const isAuthorization = (header: string) => header.toLowerCase() === "authorization";
const withoutAuthorization = (headers: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => !isAuthorization(key)));
const authorizationOf = (headers: Record<string, string> | undefined) =>
  Object.entries(headers ?? {}).find(([key]) => isAuthorization(key))?.[1];

/** The entry as the browser edits it: the `Authorization` value stays on this machine. */
const configView = (config: McpServerConfig): McpServerConfigView =>
  "url" in config
    ? {
        url: config.url,
        headers: withoutAuthorization(config.headers),
        hasAuthorization: authorizationOf(config.headers) !== undefined,
      }
    : {
        command: config.command,
        args: [...(config.args ?? [])],
        env: { ...config.env },
        ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
      };

/** The dialog's fields merged into the entry: Pi's other keys stay; a change of transport drops
 * the other transport's keys; an `authorization` left out keeps the saved header. */
const merged = (existing: McpServerConfig, edit: McpServerEdit): McpServerConfig => {
  const { type: _type, ...kept } = existing as McpServerConfig & { type?: string };
  if ("url" in edit) {
    const { command: _c, args: _a, env: _e, cwd: _d, ...rest } = kept as Record<string, unknown>;
    const previous = "url" in existing ? authorizationOf(existing.headers) : undefined;
    const authorization =
      edit.authorization === undefined ? previous : (edit.authorization ?? undefined);
    const headers = {
      ...(authorization !== undefined ? { Authorization: authorization } : {}),
      ...withoutAuthorization(edit.headers),
    };
    const { headers: _h, ...other } = rest;
    return {
      ...other,
      url: edit.url,
      ...(Object.keys(headers).length ? { headers } : {}),
    } as McpServerConfig;
  }
  const {
    url: _u,
    headers: _h,
    oauth: _o,
    auth: _p,
    args: _a,
    env: _e,
    cwd: _d,
    ...other
  } = kept as Record<string, unknown>;
  return {
    ...other,
    command: edit.command,
    ...(edit.args.length ? { args: [...edit.args] } : {}),
    ...(Object.keys(edit.env).length ? { env: { ...edit.env } } : {}),
    ...(edit.cwd ? { cwd: edit.cwd } : {}),
  } as McpServerConfig;
};

export const McpSetupEnvironment = Context.Reference<{
  directory: () => string;
  /** The catalog's endpoints and resolved local commands; tests point them at a fake. */
  servers: () => readonly CatalogServer[];
}>("piano/McpSetupEnvironment", {
  defaultValue: () => ({ directory: agentDir, servers: catalogServers }),
});

export class McpSetupError extends Data.TaggedError("McpSetupError")<{
  readonly detail: string;
  readonly field?: string;
}> {}
export class McpSetup extends Context.Service<
  McpSetup,
  {
    readonly state: Effect.Effect<McpSetupState>;
    readonly change: (request: McpSetupRequest) => Effect.Effect<McpSetupState, McpSetupError>;
    /** Sign-in to a configured server, by its entry name; shaped as provider sign-in so the
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
    const catalogOf = (config: McpServerConfig) =>
      environment.servers().find((server) => isTarget(config, server));
    /** How the user knows the entry: its catalog name, else its own. */
    const label = (entry: McpServerEntry) => catalogOf(entry.config)?.name ?? entry.name;
    const setup = (entry: McpServerEntry): McpServerSetup => {
      const url = oauthUrl(entry);
      const common = {
        name: entry.name,
        config: configView(entry.config),
        oauth: !!url,
        removalKey: removalKey(entry),
      };
      const matched = catalogOf(entry.config);
      const identity = matched ? { ...common, catalog: matched.id } : common;
      const detail =
        entry.config.enabled === false || entry.config.exposure === "hidden"
          ? {
              detail: `${label(entry)} MCP is disabled or hidden in Pi. Enable it in Pi before continuing.`,
            }
          : {};
      try {
        return {
          ...identity,
          signedIn: !!url && !!credentials.tokens(entry.name, url),
          ...detail,
        };
      } catch {
        return {
          ...identity,
          signedIn: false,
          detail: "Check Pi's MCP credentials before continuing.",
        };
      }
    };
    const snapshot = (): McpSetupState => {
      const problem = entries.problem();
      if (problem) return { servers: [], available: [], problem };
      const list = entries.list();
      return {
        servers: list.map(setup),
        available: environment
          .servers()
          .filter((server) => !list.some((entry) => isTarget(entry.config, server)))
          .map((server) =>
            list.some((entry) => entry.name === server.id)
              ? { id: server.id, detail: `Another MCP server is named ${server.id}.` }
              : { id: server.id },
          ),
      };
    };
    const failure = (cause: unknown, fallback: string) =>
      cause instanceof McpConfigEntryError && cause.field
        ? new McpSetupError({ detail: cause.detail, field: cause.field })
        : new McpSetupError({ detail: fallback });
    const writing = <A>(change: Effect.Effect<A, unknown>, detail: string) =>
      change.pipe(
        Effect.mapError((cause) => failure(cause, detail)),
        Effect.map(snapshot),
      );

    // Its own lane, apart from provider sign-in: Pi's MCP callback reuses the registered client's port or
    // takes a free one, not a provider's fixed port, and a provider attempt this dialog cannot show must
    // not block it. Success stores a token only; the cached catalogs and commands do not depend on it.
    const attempts = yield* SignInAttempts.make({
      busy: "A sign-in is already in progress. Finish it before starting another.",
      afterSuccess: Effect.void,
    });
    const signedInEntry = (name: string) => {
      const entry = entries.named(name);
      if (!entry) {
        const server = environment.servers().find((server) => server.id === name);
        throw new Error(
          server
            ? `Install ${server.name} MCP before signing in.`
            : `Add ${name} MCP before signing in.`,
        );
      }
      const url = oauthUrl(entry);
      // A local command, a provider token or an Authorization header: Pi needs no sign-in here.
      if (!url) throw new Error(`${label(entry)} MCP does not sign in.`);
      return { entry, url, name: label(entry) };
    };

    const source = (name: string, entry: McpServerEntry, url: string): SignInSource => ({
      message: `Connecting to ${name}…`,
      // OAuth errors may include token response bodies. Never deliver or log them.
      failure: `Sign-in to ${name} failed. Check the authorization and try again.`,
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
            return { status: "success", message: `Already signed in to ${name}.` };
          } catch {
            if (connection.state !== "needs-auth")
              return {
                status: "error",
                message: `Could not reach ${name} MCP. Check the network and try again.`,
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
                show({ url: authorization.href, message: `Approve access in ${name}.` });
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
            message: `Signed in. Start a new session to use ${name} tools.`,
          };
        } finally {
          await connection.close().catch(() => undefined);
        }
      },
    });

    // Stored tokens are keyed by name and endpoint, whatever the entry authenticates with now: an
    // entry switched to a header after signing in keeps them, and a reinstall would reuse them.
    // Removal and a change of name or endpoint drop them, since Piano has no other place to.
    const dropCredentials = (entry: McpServerEntry) => {
      if ("url" in entry.config) credentials.remove(entry.name, entry.config.url);
    };

    return McpSetup.of({
      state: Effect.sync(snapshot),
      change: (request) => {
        switch (request.action) {
          case "install":
            return writing(
              Effect.try(() => catalog(request.server)).pipe(
                // An entry already at the endpoint or command, whatever its name, is kept as the user configured it.
                Effect.flatMap((server) =>
                  entries.list().some((entry) => isTarget(entry.config, server))
                    ? Effect.void
                    : entries.add([{ name: server.id, config: configOf(server) }]),
                ),
              ),
              "Could not install this MCP server. Check Pi's global configuration and file permissions, then refresh.",
            );
          case "add":
            return writing(
              entries.add(request.servers),
              "Could not add this MCP server. Check Pi's global configuration and file permissions, then refresh.",
            );
          case "update":
            return writing(
              Effect.try(() => {
                if (attempts.busy(request.name)) throw new Error("Sign-in in progress.");
              }).pipe(
                Effect.flatMap(() => {
                  const before = entries.named(request.name);
                  return entries
                    .update(request.name, request.removalKey, request.rename, (existing) =>
                      merged(existing, request.config),
                    )
                    .pipe(
                      Effect.tap((saved) =>
                        Effect.sync(() => {
                          // Tokens for the old name or endpoint can never be found again.
                          const was = before && oauthUrl(before);
                          const is = oauthUrl(saved);
                          if (before && was && (saved.name !== before.name || is !== was))
                            dropCredentials(before);
                        }),
                      ),
                    );
                }),
              ),
              "Could not save this MCP server. Its configuration may have changed. Refresh and try again.",
            );
          case "remove":
            return writing(
              Effect.try(() => {
                if (attempts.busy(request.name)) throw new Error("Sign-in in progress.");
              }).pipe(
                // Credentials go first, so a failure leaves the entry installed to remove again.
                Effect.flatMap(() =>
                  entries.removeNamed(request.name, request.removalKey, dropCredentials),
                ),
              ),
              "Could not remove this MCP server. Its configuration may have changed. Refresh and confirm again.",
            );
          case "sign-out":
            return Effect.try({
              try: () => {
                if (attempts.busy()) throw new Error("Sign-in in progress.");
                const { entry, url } = signedInEntry(request.name);
                credentials.remove(entry.name, url);
                return snapshot();
              },
              catch: () =>
                new McpSetupError({
                  detail:
                    "Could not sign out. Finish any sign-in in progress and refresh before retrying.",
                }),
            });
        }
      },
      signIn: attempts.lane((name) =>
        Effect.try({
          try: () => {
            const { entry, url, name: shown } = signedInEntry(name);
            return source(shown, entry, url);
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
