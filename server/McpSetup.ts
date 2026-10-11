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
import { createDefaultTransport, McpOAuthCredentialStore, McpServerConnection, McpServerLog, signInMcpServer } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.js";
import { MCP_CATALOG, type McpCatalogId, type McpServerSetup, type McpSetupRequest, type McpSetupState } from "../shared/mcp.ts";
import type { ProviderLoginState } from "../shared/wire.ts";
import { McpConfigEntries } from "./McpConfigEntries.ts";
import { agentDir } from "./PiEnv.ts";

type CatalogServer = { id: McpCatalogId; name: string; url: string };
/** Pi's rule: an HTTP server without provider auth or an Authorization header signs in with MCP OAuth. */
const oauthUrl = (entry: McpServerEntry) => "url" in entry.config && !entry.config.auth
  && !Object.keys(entry.config.headers ?? {}).some(header => header.toLowerCase() === "authorization") ? entry.config.url : undefined;

export const McpSetupEnvironment = Context.Reference<{
  directory: () => string;
  /** The catalog's endpoints; tests point them at a local server. */
  servers: () => readonly CatalogServer[];
}>("piano/McpSetupEnvironment", { defaultValue: () => ({ directory: agentDir, servers: () => MCP_CATALOG }) });

export class McpSetupError extends Data.TaggedError("McpSetupError")<{ readonly detail: string }> {}
export class McpSetup extends Context.Service<McpSetup, {
  readonly state: Effect.Effect<McpSetupState>;
  readonly change: (request: McpSetupRequest) => Effect.Effect<McpSetupState, McpSetupError>;
  /** The current sign-in attempt, shaped as provider sign-in so the browser shares one dialog. */
  readonly login: Effect.Effect<ProviderLoginState | null>;
  readonly startLogin: (server: string) => Effect.Effect<ProviderLoginState, McpSetupError>;
  readonly answerLogin: (id: string, promptId: string, value: string) => Effect.Effect<ProviderLoginState, McpSetupError>;
  readonly cancelLogin: (id: string) => Effect.Effect<ProviderLoginState, McpSetupError>;
}>()("piano/McpSetup") {}

export const McpSetupLive = Layer.effect(McpSetup, Effect.gen(function* () {
  const environment = yield* McpSetupEnvironment;
  const directory = environment.directory();
  const entries = yield* McpConfigEntries(directory);
  const credentials = new McpOAuthCredentialStore(new FileAuthStorageBackend(join(directory, "mcp-auth.json")), directory);
  const catalog = (id: string) => {
    const server = environment.servers().find(server => server.id === id);
    if (!server) throw new Error("Unknown MCP server.");
    return server;
  };
  const find = entries.find;
  const setup = (server: CatalogServer): McpServerSetup => {
    const observed = entries.observe(server);
    const detail = observed.status === "blocked" ? { detail: observed.detail } : {};
    if (!observed.entry) return { id: server.id, status: observed.status, oauth: true, signedIn: false, ...detail };
    const { entry, removalKey } = observed;
    const url = oauthUrl(entry);
    try {
      return { id: server.id, status: observed.status, oauth: !!url, signedIn: !!url && !!credentials.tokens(entry.name, url), removalKey, ...detail };
    } catch {
      return { id: server.id, status: "blocked", oauth: !!url, signedIn: false, detail: "Check Pi's MCP credentials before continuing." };
    }
  };
  const snapshot = (): McpSetupState => ({ servers: environment.servers().map(setup) });
  const writing = <A>(change: Effect.Effect<A, unknown>, detail: string) => change.pipe(
    Effect.mapError(() => new McpSetupError({ detail })), Effect.map(snapshot));

  let current: { state: ProviderLoginState; abort: AbortController; done: Promise<void>; active: boolean; redirect?: URL } | undefined;
  let pending: { id: string; resolve: (value: string | undefined) => void } | undefined;
  const cancel = (message: string) => {
    if (current?.state.status !== "running") return;
    current.state = { id: current.state.id, provider: current.state.provider, status: "cancelled", message };
    current.abort.abort();
  };
  yield* Effect.addFinalizer(() => Effect.promise(async () => { cancel("Sign-in cancelled: Piano stopped."); await current?.done; }));
  const failure = (detail: string) => new McpSetupError({ detail });
  const signedInEntry = (id: string) => {
    const server = catalog(id);
    const entry = find(server);
    const url = entry && oauthUrl(entry);
    if (!entry || !url) throw new Error(`Install ${server.name} MCP before signing in.`);
    return { server, entry, url };
  };

  return McpSetup.of({
    state: Effect.sync(snapshot),
    change: request => {
      switch (request.action) {
        case "install": return writing(Effect.try(() => catalog(request.server)).pipe(
          // Any existing entry for the endpoint is kept as the user configured it.
          Effect.flatMap(server => entries.save(server, existing => existing ? undefined : { url: server.url }))),
        "Could not install this MCP server. Check Pi's global configuration and file permissions, then refresh.");
        case "uninstall": return writing(Effect.try(() => {
          if (current?.active && current.state.provider === request.server) throw new Error("Sign-in in progress.");
          return catalog(request.server);
        }).pipe(
          Effect.flatMap(server => entries.remove(server, request.removalKey)),
          // Stored tokens without a configuration have no other place in Piano to be removed.
          Effect.flatMap(entry => Effect.try(() => { const url = oauthUrl(entry); if (url) credentials.remove(entry.name, url); }))),
        "Could not uninstall this MCP server. Its configuration may have changed. Refresh and confirm again.");
        case "sign-out": return Effect.try({
          try: () => {
            if (current?.active) throw new Error("Sign-in in progress.");
            const { entry, url } = signedInEntry(request.server);
            credentials.remove(entry.name, url);
            return snapshot();
          },
          catch: () => failure("Could not sign out. Finish any sign-in in progress and refresh before retrying."),
        });
      }
    },
    login: Effect.sync(() => current ? structuredClone(current.state) : null),
    startLogin: id => Effect.try({
      try: () => {
        if (current?.active) throw new Error("A sign-in is already in progress. Finish it before starting another.");
        const { server, entry, url } = signedInEntry(id);
        const attempt: NonNullable<typeof current> = { state: { id: crypto.randomUUID(), provider: server.id, status: "running", message: `Connecting to ${server.name}…` },
          abort: new AbortController(), done: Promise.resolve(), active: true };
        current = attempt;
        const { signal } = attempt.abort;
        const timer = setTimeout(() => cancel("Sign-in expired. Please try again."), 15 * 60_000);
        const finish = (status: "success" | "error", message: string) => {
          if (!signal.aborted) attempt.state = { id: attempt.state.id, provider: server.id, status, message };
        };
        attempt.done = (async () => {
          const connection = new McpServerConnection({ entry, cwd: directory, createTransport: createDefaultTransport, credentials,
            log: new McpServerLog(join(directory, "mcp.log")), onTools: () => {} });
          try {
            // Connecting first answers whether a sign-in is needed and records the server's challenge, as `pi mcp login` does.
            try {
              await connection.getClient();
              finish("success", `Already signed in to ${server.name}.`);
              return;
            } catch {
              if (connection.state !== "needs-auth") { finish("error", `Could not reach ${server.name} MCP. Check the network and try again.`); return; }
            }
            await signInMcpServer({
              serverUrl: url, store: credentials.forServer(entry.name, url), settings: connection.oauthSettings(), challenge: connection.challenge, signal,
              prompt: {
                showAuthorizationUrl: authorization => {
                  if (!["https:", "http:"].includes(authorization.protocol)) throw new Error("Unsupported authorization URL.");
                  attempt.redirect = new URL(authorization.searchParams.get("redirect_uri") ?? "http://127.0.0.1/callback");
                  attempt.redirect.searchParams.set("state", authorization.searchParams.get("state") ?? "");
                  Object.assign(attempt.state, { url: authorization.href, message: `Approve access in ${server.name}.` });
                },
                // Piano often runs on another machine than the browser, whose redirect to Pi's loopback
                // callback then fails; the user pastes that address instead. A callback that does arrive aborts this.
                promptForRedirectUrl: promptSignal => new Promise(resolve => {
                  const promptId = crypto.randomUUID();
                  const done = (value: string | undefined) => {
                    promptSignal.removeEventListener("abort", aborted);
                    if (pending?.id === promptId) pending = undefined;
                    if (attempt.state.prompt?.id === promptId) delete attempt.state.prompt;
                    resolve(value);
                  };
                  const aborted = () => done(undefined);
                  if (promptSignal.aborted) { aborted(); return; }
                  attempt.state.prompt = { id: promptId, type: "text", message: "If the page after approving does not load, paste its address here.", placeholder: `${attempt.redirect?.origin ?? "http://127.0.0.1"}/callback?code=…` };
                  pending = { id: promptId, resolve: done };
                  promptSignal.addEventListener("abort", aborted, { once: true });
                }),
              },
            });
            connection.challenge = undefined;
            await connection.reconnect();
            finish("success", `Signed in. Start a new session to use ${server.name} tools.`);
          } catch {
            // OAuth errors may include token response bodies. Never deliver or log them.
            finish("error", `Sign-in to ${server.name} failed. Check the authorization and try again.`);
          } finally {
            clearTimeout(timer);
            pending?.resolve(undefined);
            attempt.active = false;
            await connection.close().catch(() => undefined);
          }
        })();
        return structuredClone(attempt.state);
      },
      catch: cause => failure(cause instanceof Error ? cause.message : "Could not start sign-in."),
    }),
    answerLogin: (id, promptId, value) => Effect.try({
      try: () => {
        if (current?.state.id !== id || current.state.status !== "running" || pending?.id !== promptId) throw failure("This sign-in prompt has already closed. Refresh and try again.");
        // Check the pasted address here, so a mistyped paste asks again instead of failing the sign-in.
        const expected = current.redirect;
        let pasted: URL | undefined;
        try { pasted = new URL(value.trim()); } catch { /* reported below */ }
        if (!expected || !pasted || pasted.origin !== expected.origin || pasted.pathname !== expected.pathname
          || pasted.searchParams.get("state") !== expected.searchParams.get("state") || !(pasted.searchParams.get("code") || pasted.searchParams.get("error"))) {
          throw failure("Paste the full address of the page your browser opened after approving.");
        }
        const claim = pending;
        pending = undefined;
        claim.resolve(value);
        return structuredClone(current.state);
      },
      catch: cause => cause instanceof McpSetupError ? cause : failure("Could not complete sign-in."),
    }),
    cancelLogin: id => Effect.try({
      try: () => {
        if (current?.state.id !== id) throw new Error("stale");
        cancel("Sign-in cancelled.");
        return structuredClone(current.state);
      },
      catch: () => failure("This sign-in is no longer current."),
    }),
  });
}));
