/** Machine-wide setup of MCP servers in Pi's global configuration, not an MCP client for sessions.
 * Pi owns the configuration format and its validation, OAuth (discovery, registration, PKCE,
 * refresh) and credential storage; this module decides which entries to add, change or remove,
 * connects catalog servers by their known endpoint, and relays Pi's sign-in prompts. An entry is
 * saved only once Pi's own client has connected to it: a URL server is reached, signing in first
 * when it asks, and a local command is started and stopped again. Nothing here mutates running
 * sessions: a new session reads the updated setup. */
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
  type McpServerConfigView,
  type McpServerEdit,
  type McpServerSetup,
  type McpSetupChange,
  type McpSetupRequest,
  type McpSetupState,
} from "../shared/mcp.ts";
import {
  authOf,
  isTarget,
  type McpCatalogEntry,
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

type CatalogServer = McpCatalogEntry & { readonly id: McpCatalogId };
/** Where the entry signs in, when Pi authenticates it with MCP OAuth. */
const oauthUrl = (entry: McpServerEntry) => {
  const auth = authOf(entry.config);
  return auth._tag === "oauth" ? auth.url : undefined;
};
/** How long connecting to a URL server before saving it may take, Pi's retries included. */
const CONNECT_TIMEOUT_MS = 20_000;
/** How long a local command may take to start: `npx` or `uvx` may download the server first. */
const START_TIMEOUT_MS = 60_000;

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
  /** The catalog's endpoints; tests point them at a fake. */
  servers: () => readonly CatalogServer[];
}>("piano/McpSetupEnvironment", {
  defaultValue: () => ({ directory: agentDir, servers: () => MCP_CATALOG }),
});

export class McpSetupError extends Data.TaggedError("McpSetupError")<{
  readonly detail: string;
  readonly field?: string;
}> {}
export class McpSetup extends Context.Service<
  McpSetup,
  {
    readonly state: Effect.Effect<McpSetupState>;
    readonly change: (request: McpSetupRequest) => Effect.Effect<McpSetupChange, McpSetupError>;
    /** Sign-in to a configured server by its entry name, or to the server a change is waiting to
     * save by the subject the change answered with; shaped as provider sign-in so the browser
     * shares one dialog. */
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
              detail: `MCP ${label(entry)} is disabled or hidden in Pi. Enable it in Pi before continuing.`,
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
        Effect.map((): McpSetupChange => ({ state: snapshot() })),
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
      if (!entry) throw new Error(`Add MCP ${name} before signing in.`);
      const url = oauthUrl(entry);
      // A local command, a provider token or an Authorization header: Pi needs no sign-in here.
      if (!url) throw new Error(`MCP ${label(entry)} does not sign in.`);
      return { entry, url, name: label(entry) };
    };

    /** Tokens a sign-in stored for an entry that was never saved: no saved entry can use them. */
    const forgetUnsaved = (name: string, url: string) => {
      const saved = entries.named(name);
      if (saved && oauthUrl(saved) === url) return;
      try {
        credentials.remove(name, url);
      } catch {
        /* Nothing to find them by later; a later sign-in replaces them. */
      }
    };
    /** Whether Pi's own client connects to `entry`, unsaved: connected, asks for a sign-in, or
     * failed with Pi's reason (a command's includes the tail of its stderr). */
    const reach = async (
      entry: McpServerEntry,
    ): Promise<"connected" | "sign-in" | { readonly failed: string | undefined }> => {
      const connection = new McpServerConnection({
        entry,
        cwd: directory,
        createTransport: createDefaultTransport,
        credentials,
        log: new McpServerLog(join(directory, "mcp.log")),
        onTools: () => {},
      });
      const timer = setTimeout(
        () => void connection.close().catch(() => undefined),
        "url" in entry.config ? CONNECT_TIMEOUT_MS : START_TIMEOUT_MS,
      );
      try {
        await connection.getClient();
        return "connected";
      } catch {
        return connection.state === "needs-auth" && oauthUrl(entry)
          ? "sign-in"
          : { failed: connection.error };
      } finally {
        clearTimeout(timer);
        await connection.close().catch(() => undefined);
      }
    };
    /** The one change waiting for its sign-in before it saves; a newer one replaces it. Its
     * sign-in subject is its own, never an entry name: retrying it from its dialog finds it, while
     * a saved entry's Reconnect, which passes the entry's name, never saves a change left waiting. */
    let waiting:
      | {
          subject: string;
          /** The entries it changes: the one it saves and, renamed, the one it replaces. */
          names: ReadonlySet<string>;
          entry: McpServerEntry;
          url: string;
          save: Effect.Effect<unknown, McpConfigEntryError>;
        }
      | undefined;
    let waits = 0;
    /** A sign-in is running for the entry `name`: its own, or a change's waiting to save it. */
    const signingIn = (name: string) =>
      attempts.busy(name) || (!!waiting?.names.has(name) && attempts.busy(waiting.subject));

    /** The sign-in to `entry`, a saved one or one waiting to be saved: `save` writes it once
     * signed in, and a sign-in that ends without saving drops the tokens it stored. */
    const source = (
      name: string,
      entry: McpServerEntry,
      url: string,
      save?: () => Promise<unknown>,
    ): SignInSource => ({
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
        let saved = !save;
        const done = async (signedIn: string) => {
          if (save) {
            try {
              await save();
            } catch {
              return {
                status: "error" as const,
                message: `Could not save MCP ${name}. Refresh and try again.`,
              };
            }
            saved = true;
            return {
              status: "success" as const,
              message: `Connected. Start a new session to use ${name} tools.`,
            };
          }
          return { status: "success" as const, message: signedIn };
        };
        try {
          // Connecting first answers whether a sign-in is needed and records the server's challenge, as `pi mcp login` does.
          try {
            await connection.getClient();
            return await done(`Already signed in to ${name}.`);
          } catch {
            if (connection.state !== "needs-auth")
              return {
                status: "error",
                message: `Could not reach MCP ${name}. Check the network and try again.`,
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
          return await done(`Signed in. Start a new session to use ${name} tools.`);
        } finally {
          await connection.close().catch(() => undefined);
          if (!saved) forgetUnsaved(entry.name, url);
        }
      },
    });

    // Stored tokens are keyed by name and endpoint, whatever the entry authenticates with now: an
    // entry switched to a header after signing in keeps them, and a reinstall would reuse them.
    // Removal and a change of name or endpoint drop them, since Piano has no other place to.
    const dropCredentials = (entry: McpServerEntry) => {
      if ("url" in entry.config) credentials.remove(entry.name, entry.config.url);
    };

    /** Saves `entry` with `save` once Pi's client has connected to it. A URL server that asks for
     * a sign-in waits for it; one that cannot be reached is refused on its URL, without Pi's reason,
     * which may hold a response body. A command that does not start is refused with Pi's reason. */
    const saveConnected = (
      entry: McpServerEntry,
      save: Effect.Effect<unknown, McpConfigEntryError>,
      fallback: string,
      replaces?: string,
    ): Effect.Effect<McpSetupChange, McpSetupError> =>
      Effect.promise(() => reach(entry)).pipe(
        Effect.flatMap((reached) => {
          if (reached === "connected") return writing(save, fallback);
          const url = oauthUrl(entry);
          if (reached === "sign-in" && url) {
            const subject = `${entry.name}#waiting-${++waits}`;
            const names = new Set([entry.name, ...(replaces ? [replaces] : [])]);
            waiting = { subject, names, entry, url, save };
            return Effect.succeed({ state: snapshot(), signIn: subject });
          }
          if (!("url" in entry.config)) {
            const reason = reached === "sign-in" ? undefined : reached.failed;
            return Effect.fail(
              new McpSetupError({
                detail: `Could not start MCP ${label(entry)}. Check the command, its arguments and environment, then try again.${reason ? `\n${reason}` : ""}`,
                field: "config",
              }),
            );
          }
          const auth = authOf(entry.config)._tag === "header" ? ", the Authorization header" : "";
          return Effect.fail(
            new McpSetupError({
              detail: `Could not connect to MCP ${label(entry)}. Check the URL${auth} and the network, then try again.`,
              field: "config",
            }),
          );
        }),
      );
    const prepared = <A>(prepare: () => A, fallback: string) =>
      Effect.try({ try: prepare, catch: (cause) => failure(cause, fallback) });

    return McpSetup.of({
      state: Effect.sync(snapshot),
      change: (request) => {
        switch (request.action) {
          case "connect": {
            const fallback =
              "Could not connect this MCP server. Check Pi's global configuration and file permissions, then refresh.";
            return prepared(() => {
              const server = catalog(request.server);
              // An entry already at the endpoint, whatever its name, is kept as the user configured it.
              if (entries.list().some((entry) => isTarget(entry.config, server))) return undefined;
              return entries.prepare({
                name: server.id,
                config: { url: server.url },
              });
            }, fallback).pipe(
              Effect.flatMap((entry) =>
                entry
                  ? saveConnected(
                      entry,
                      entries.add([{ name: entry.name, config: entry.config }]),
                      fallback,
                    )
                  : Effect.succeed({ state: snapshot() }),
              ),
            );
          }
          case "add": {
            const fallback =
              "Could not add this MCP server. Check Pi's global configuration and file permissions, then refresh.";
            return prepared(() => entries.prepare(request), fallback).pipe(
              Effect.flatMap((entry) =>
                saveConnected(
                  entry,
                  entries.add([{ name: entry.name, config: entry.config }]),
                  fallback,
                ),
              ),
            );
          }
          case "update": {
            const fallback =
              "Could not save this MCP server. Its configuration may have changed. Refresh and try again.";
            const configure = (existing: McpServerConfig) => merged(existing, request.config);
            return prepared(() => {
              if (signingIn(request.name)) throw new Error("Sign-in in progress.");
              return entries.prepareUpdate(
                request.name,
                request.removalKey,
                request.rename,
                configure,
              );
            }, fallback).pipe(
              Effect.flatMap((entry) => {
                const before = entries.named(request.name);
                const save = entries
                  .update(request.name, request.removalKey, request.rename, configure)
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
                return saveConnected(entry, save, fallback, request.name);
              }),
            );
          }
          case "remove":
            return writing(
              Effect.try(() => {
                if (signingIn(request.name)) throw new Error("Sign-in in progress.");
              }).pipe(
                // Credentials go first, so a failure leaves the entry installed to remove again.
                Effect.flatMap(() =>
                  entries.removeNamed(request.name, request.removalKey, dropCredentials),
                ),
              ),
              "Could not remove this MCP server. Its configuration may have changed. Refresh and confirm again.",
            );
        }
      },
      signIn: attempts.lane((subject) =>
        Effect.try({
          try: () => {
            const change = waiting?.subject === subject ? waiting : undefined;
            if (change) {
              const save = () =>
                Effect.runPromise(change.save).then(() => {
                  if (waiting === change) waiting = undefined;
                });
              return source(label(change.entry), change.entry, change.url, save);
            }
            if (!entries.named(subject) && subject.includes("#waiting-"))
              throw new Error("This change is no longer waiting. Save it again.");
            const { entry, url, name: shown } = signedInEntry(subject);
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
