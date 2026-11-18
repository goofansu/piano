# Pi 1.1.0: a Piano-local HTTPS MCP callback adapter

Research only, 2026-10-11. Installed packages and executable source inspected at Piano
`45a835dab6bed4b3a2b284c2c5171452679b7992`, Node `v24.21.0`:
`@earendil-works/pi-coding-agent@1.1.0` and `@earendil-works/pi-mcp@1.1.0`.
No implementation, commit, deployment, real credential access, external registration,
network login, or production change. The synthetic experiment below made **no network
requests and opened no listening socket**.

## Conclusion

**Feasible without an upstream change, but not entirely through public Pi APIs.**

- Public `@earendil-works/pi-mcp/oauth` primitives accept an arbitrary redirect string,
  including HTTPS, perform discovery/DCR/PKCE/code exchange, and accept callback **code
  and `iss` directly**, without invoking `OAuthCallbackServer`.
- **State is not a callback input to `authorizeMcp`.** Piano must validate state and
  browser binding before calling it, and own one-use attempt/cancellation semantics.
- Pi's existing `mcp-auth.json` storage and runtime refresh accept the resulting state.
  This was exercised with actual installed code and entirely synthetic credentials.
  However, `McpOAuthCredentialStore` and `createMcpAuthProvider` are **private coding-agent
  module exports, not public package exports**. There is no public Pi MCP file-store
  factory equivalent in 1.1.0.
- `oauth.callbackUrl` in normal `mcp.json` remains HTTP-loopback-only. Do **not** put the
  HTTPS callback there, patch Pi's listener, rewrite an authorization URL after creation,
  or replace Pi's session/MCP runtime. Replace only the hosted sign-in orchestration,
  using Pi's public OAuth engine and version-pinned private credential-store adapter.

Sources: [public exports][exports], [provider][provider], [flow][flow],
[private integration][pi-oauth], [config validator][config-validator],
[package export maps][pi-package].

## Scope and source provenance

This note owns the **installed Pi interface, persistence, refresh and synthetic runtime
feasibility** investigation. Piano routing/auth/browser lifecycle observations below
were supplied by the main investigation; they are not independently verified here.
The earlier [Linear remote OAuth note][linear-note] owns provider/spec research. Its
live metadata observations are not repeated or revalidated here, and do not prove
Linear accepts this HTTPS redirect/client registration.

Read fully: installed Pi `docs/mcp.md`, its relevant cross-references `security.md`,
`cli.md`, `sdk.md`, `extensions.md`, `settings.md`, `configuration.md`,
`environment-variables.md`, and `cli-integration.md`; standalone pi-mcp `README.md` and
`CHANGELOG.md`; and the SDK `14-codemode-mcp.ts` example. Examined shipped `.d.ts` and
executable `.js`, including OAuth provider/flow/discovery/callback, credential-store,
config validation, and MCP runtime integration. Installed source is authoritative for
this result; links to `node_modules` below require the locked dependencies installed.
[Pi MCP docs][mcp-doc] [Standalone usage][mcp-readme] [SDK example][sdk-example]

Architectural constraints: preserve [ADR 0001][adr] and [INV-01/02/04/09/11/12][invariants].
This is a small sign-in adapter, not a second MCP runtime or credential authority.

## 1. Concrete exported interfaces

### Public import: `@earendil-works/pi-mcp/oauth`

The package explicitly exports the `./oauth` subpath. Useful runtime exports are:

- `McpOAuthProvider`, `MemoryOAuthStateStore`, `authorizeMcp`, `adaptOAuthProvider`;
- `startAuthorization`, `registerClient`, `exchangeAuthorizationCode`,
  `refreshAuthorization`, `stepUpScope`;
- discovery/selection functions `discoverOAuthServerInfo`,
  `discoverProtectedResourceMetadata`, `discoverAuthorizationServerMetadata`,
  `buildAuthorizationServerDiscoveryUrls`, `parseWwwAuthenticate`,
  `resourceUrlFromServerUrl`, `selectResource`;
- `OAuthCallbackServer` (optional; **not needed** here);
- `OAuthError`, `OAuthIssuerMismatchError`, `OAuthInsecureEndpointError`,
  `OAuthRegistrationError`, `McpOAuthAuthorizationRequiredError`.

Relevant exact declarations, with documentation comments omitted:
[exports][exports] [flow types][flow-types] [provider types][provider-types]

```ts
export interface McpOAuthState {
  serverUrl: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  tokensExpireAt?: number;
  codeVerifier?: string;
  oauthState?: string;
  discovery?: OAuthDiscoveryState;
}
export interface McpOAuthStateStore {
  load(): McpOAuthState | undefined | Promise<McpOAuthState | undefined>;
  save(state: McpOAuthState): void | Promise<void>;
}
export interface OAuthClientMetadataDocument {
  url: string;
  redirectUrl: string;
}
export interface McpOAuthProviderOptions {
  serverUrl: string | URL;
  redirectUrl: string | URL;
  clientMetadata: Omit<OAuthClientMetadata, "redirect_uris"> & {
    redirect_uris?: string[];
  };
  clientMetadataDocument?: (
    metadata: AuthorizationServerMetadata | undefined,
  ) => OAuthClientMetadataDocument | undefined;
  clientId?: string;
  clientSecret?: string;
  store?: McpOAuthStateStore;
  onRedirect(url: URL): void | Promise<void>;
}
export interface OAuthFlowOptions {
  serverUrl: string | URL;
  authorizationCode?: string;
  iss?: string;
  scope?: string;
  resourceMetadataUrl?: URL;
  authorizationServerMetadataUrl?: URL;
  fetch?: McpFetch;
  signal?: AbortSignal;
  skipIssuerValidation?: boolean;
  skipRefresh?: boolean;
}
export type OAuthFlowResult = "AUTHORIZED" | "REDIRECT";
export declare function authorizeMcp(
  provider: OAuthClientProvider,
  options: OAuthFlowOptions,
): Promise<OAuthFlowResult>;
```

`McpFetch`, exported from the main `@earendil-works/pi-mcp` package, is exactly
`(input: string | URL, init?: RequestInit) => Promise<Response>`.
[Fetch/auth interface][auth-types]

`McpOAuthProvider` implements the following public interface; use it rather than
reimplementing PKCE/discovery/token exchange:

```ts
export type AddClientAuthentication = (
  headers: Headers, params: URLSearchParams, url: string | URL,
  metadata?: AuthorizationServerMetadata,
) => void | Promise<void>;
export interface OAuthClientProvider {
  readonly redirectUrl: string | URL;
  readonly clientMetadata: OAuthClientMetadata;
  clientMetadataDocument?(metadata: AuthorizationServerMetadata | undefined):
    OAuthClientMetadataDocument | undefined;
  state?(): string | Promise<string>;
  clientInformation(): OAuthClientInformationMixed | undefined |
    Promise<OAuthClientInformationMixed | undefined>;
  saveClientInformation?(information: OAuthClientInformationMixed): void | Promise<void>;
  tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
  saveTokens(tokens: OAuthTokens): void | Promise<void>;
  redirectToAuthorization(url: URL): void | Promise<void>;
  saveCodeVerifier(verifier: string): void | Promise<void>;
  codeVerifier(): string | Promise<string>;
  addClientAuthentication?: AddClientAuthentication;
  invalidateCredentials?(kind: "all" | "client" | "tokens" | "verifier" | "discovery"):
    void | Promise<void>;
  saveDiscoveryState?(state: OAuthDiscoveryState): void | Promise<void>;
  discoveryState?(): OAuthDiscoveryState | undefined | Promise<OAuthDiscoveryState | undefined>;
}
```

Important concrete-provider behavior:

- `redirectUrl` becomes `String(options.redirectUrl)`, not a loopback-validated URL.
  Default `clientMetadata.redirect_uris` is `[redirectUrl]`; defaults also request
  authorization-code/refresh-token grants and code responses. Passing a string keeps
  its spelling; a caller-created `URL` may already have normalized it.
- `serverUrl` is normalized with `String(new URL(options.serverUrl))`. The provider
  ignores stored state with a different `serverUrl`.
- `state(): Promise<string>` generates 32 random bytes as hex **only if no stored
  `oauthState` exists**. It otherwise returns the old value.
- `saveTokens(tokens)` records expiry in epoch milliseconds from `expires_in` and
  retains other fields, including **old state and verifier**. `tokens()` does not
  itself refresh or reject an expired token.
- `invalidateCredentials("verifier")` removes only the verifier. There is no
  state-only invalidation method; `"all"` removes tokens, registration, discovery,
  verifier and state, so it is not appropriate merely to clean up an attempt.
- Writes serialize only within that provider instance, not across instances/processes.
  A `load` then `save` sequence is not a cross-process transaction.

[Provider implementation][provider]

### More granular public functions (usually unnecessary)

Exact signatures are in [flow declarations][flow-types]. In particular:

```ts
export interface TokenRequestOptions {
  metadata?: AuthorizationServerMetadata;
  clientInformation: OAuthClientInformationMixed;
  resource?: string;
  addClientAuthentication?: AddClientAuthentication;
  fetch?: McpFetch;
  signal?: AbortSignal;
}
export declare function exchangeAuthorizationCode(
  authorizationServerUrl: string | URL,
  options: TokenRequestOptions & {
    code: string; codeVerifier: string; redirectUrl: string | URL;
  },
): Promise<OAuthTokens>;
export declare function refreshAuthorization(
  authorizationServerUrl: string | URL,
  options: TokenRequestOptions & { refreshToken: string },
): Promise<OAuthTokens>;
```

`startAuthorization` accepts `redirectUrl`, `state`, scope/resource/metadata/client
information and returns `{ authorizationUrl: URL; codeVerifier: string }`.
`registerClient` accepts client metadata including `redirect_uris`. Neither needs a
listener. But directly calling `exchangeAuthorizationCode` bypasses the **issuer
check in `authorizeMcp`** and neither low-level function persists tokens. Prefer the
higher-level public function. [Flow implementation][flow]

### Private coding-agent interfaces needed for compatibility

The following are exported by the **file**
`dist/extensions/mcp/oauth.js`, not by `@earendil-works/pi-coding-agent` or a public
package subpath. Exact relevant signatures: [private declarations][pi-oauth-types]

```ts
export interface McpOAuthServerStore extends McpOAuthStateStore {
  withRefreshLock<T>(fn: () => Promise<T>): Promise<T>;
}
// Public members of the file-exported class:
// new McpOAuthCredentialStore(backend?: AuthStorageBackend, lockDir?: string)
// forServer(name: string, serverUrl: string): McpOAuthServerStore
// tokens(name: string, serverUrl: string): McpOAuthState["tokens"]
// remove(name: string, serverUrl: string): boolean

export interface McpAuthProvider extends AuthProvider {
  settled(): Promise<void>;
}
export declare function createMcpAuthProvider(options: {
  serverUrl: string;
  store: McpOAuthServerStore;
  settings: () => McpOAuthSettings;
  onChallenge: (challenge: OAuthChallenge) => void;
}): McpAuthProvider;
```

`McpOAuthSettings` has `clientId?: string`, `clientSecret?: string` (already resolved),
`callbackPort?: number`, `callbackUrl?: string` (loopback), `scope?: string`,
`clientName?: string`, `clientRegistration?: "dcr" | "cimd"`,
`authServerMetadataUrl?: URL`.

`signInMcpServer` is also file-exported, with this exact call shape:

```ts
export declare function signInMcpServer(options: {
  serverUrl: string;
  store: McpOAuthStateStore;
  settings: McpOAuthSettings;
  challenge?: OAuthChallenge;
  prompt: McpSignInPrompt;
  signal?: AbortSignal;
}): Promise<void>;
export interface McpSignInPrompt {
  showAuthorizationUrl(url: URL): void;
  promptForRedirectUrl(signal: AbortSignal): Promise<string | undefined>;
}
```

**It cannot be the HTTPS adapter:** it unconditionally calls its loopback listener
before running the flow, even when refresh alone could complete sign-in. Paste is
raced against that listener, not a listener-free injection interface. Private
`createProvider`, `callbackSettings`, `responseFromRedirectUrl`, and
`waitForAuthorizationResponse` are not file exports at all. [Private implementation][pi-oauth]

The public `createMcpExtension` options expose `openUrl`, `credentials`, configuration
and transport hooks, but no callback-listener/sign-in-flow replacement hook. The
`credentials` type references the private class; that does not make its constructor
a public export. [Extension options][extension-types] [Root exports][pi-index]

Import classification verified at runtime:

```js
import { McpOAuthProvider, authorizeMcp } from '@earendil-works/pi-mcp/oauth'; // public
// This throws ERR_PACKAGE_PATH_NOT_EXPORTED:
await import('@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.js');
// This works in this installed layout, but is a private, version-sensitive dependency:
const entry = import.meta.resolve('@earendil-works/pi-coding-agent');
const privateOAuth = await import(new URL('./extensions/mcp/oauth.js', entry));
```

No `.ts` source condition is needed for the public OAuth import in Node. If adopted,
declare pi-mcp as a direct aligned dependency rather than relying on npm hoisting of
Pi's transitive `^1.1.0` dependency; pin/check both packages and this private layout on
upgrades. A separately overridden Pi executable is not proven compatible by testing
the npm dependency alone. [Package maps][mcp-package] [Pi package][pi-package]

## 2. Listener-free HTTPS flow and missing safeguards

The intended sequence is:

1. Resolve the already-authorized MCP entry through existing Pi integration. Establish
   one server-owned attempt and a fixed trusted HTTPS redirect before registration.
2. Create `McpOAuthProvider({ serverUrl, redirectUrl, clientMetadata, store, onRedirect })`.
   Clear/replace old **attempt** state safely so `state()` cannot reuse it; account for
   registration migration below. Capture the authorization URL through `onRedirect`.
3. Call `authorizeMcp(provider, flowOptions)`. `REDIRECT` means display that URL;
   `AUTHORIZED` may mean an existing grant was refreshed without browser interaction.
4. On callback, validate the attempt's exact destination, unique/nonempty parameters,
   state and initiating-browser binding, errors, expiry/cancellation and one-use claim.
   Then pass `{ ...sameFlowOptions, authorizationCode: code, iss }` to `authorizeMcp`.
5. Require `AUTHORIZED`, successful persistence and the intended MCP reconnect outcome
   before reporting connected. Clean up only the owned attempt's state/verifier.

**No socket, URL paste, or `OAuthCallbackServer` instance is required.** The callback
is delivered to the same provider/attempt; this is not injection into an already
running CLI `signInMcpServer` operation. [Flow][flow] [Callback server][callback]

Preserved by Pi's public flow:

- DCR sends the exact HTTPS `redirect_uris`; `application_type` is inferred as `web`
  for a normal remote HTTPS host, instead of `native` for a loopback/custom scheme.
- PKCE S256, identical redirect at authorization and code exchange, discovery/resource
  selection, requested-scope recording, token persistence, refresh-token preservation
  when refresh omits a new refresh token, and scope retention on refresh.
- With discovered metadata, present `iss` must equal `metadata.issuer` **exactly**.
  If metadata advertises `authorization_response_iss_parameter_supported`, absent
  `iss` also fails, before token exchange. Keep `skipIssuerValidation` unset/false.
  Without metadata that check is not enforced: do not interpret the function as an
  unconditional issuer guarantee. Configured metadata URLs are trusted overrides.

[Flow][flow] [Discovery][discovery]

Responsibilities **not** supplied by these primitives:

- Callback state verification, fresh state per attempt, browser binding, duplicate
  parameter rejection, replay protection, attempt deadlines, atomic answer/cancel
  arbitration, and removal of pending state/verifier on success or cancellation.
  Reusing one durable provider store for simultaneous attempts overwrites verifier
  state; serialize sign-ins per credential identity or isolate attempt-local state.
- Discovery/issuer/client/redirect/scope must stay bound to the attempt. Reuse the same
  flow options at exchange. An explicit metadata override is fetched again, so a
  changing document is not an immutable attempt snapshot. For a shared fixed callback,
  initially restrict support to the known issuer-response-capable server (Linear),
  failing closed on missing issuer metadata; do not silently generalize to many
  issuers without `iss`. Pi's CIMD code uses distinct callback paths in that case.
- Calls have **no default timeout**. Supply an abort/deadline and time-bounded fetch.
  Pi's higher-level helper adds 15 seconds per OAuth request. Cancellation during
  exchange/refresh has uncertain remote outcomes; never label it as a guaranteed
  rollback or discard a returned rotated refresh token before saving it.
- `authorizeMcp` retries certain OAuth failures after invalidating credentials:
  invalid/unauthorized client invalidates all; invalid grant invalidates tokens.
  These mutations matter when using a live durable store. Do not assume a failed
  attempt leaves the previous grant untouched. Do not retry an already-consumed
  callback as a new attempt.
- Do not expose raw registration/error bodies, authorization/callback URLs, code,
  state, verifier or tokens through logs/diagnostics. Lower-level errors can contain
  remote response text. These primitives are not an egress/SSRF policy engine.

[Provider][provider] [Flow][flow] [Private timeout/cleanup behavior][pi-oauth]

## 3. Credential persistence, refresh, and migration

### Compatible durable format, private adapter

`McpOAuthCredentialStore()` defaults to `<getAgentDir()>/mcp-auth.json`, not provider
`auth.json` or Piano's Registry. `forServer(name, url)` keys state as:

```text
mcp__<name with '-' replaced by '_'>|<String(new URL(serverUrl))>
```

Different names sharing a URL retain separate accounts. Same name/URL in different
configs shares credentials. A legacy URL-only key is migrated to the first named
server that loads it. The state value is the public `McpOAuthState` shape above.
Tokens use `access_token`, `refresh_token`, `token_type`, optional `expires_in`,
`scope`, `id_token`; expiry is also stored as `tokensExpireAt`.
[Credential store][pi-oauth] [Token types][oauth-types]

The backend serializes file reads/writes using `proper-lockfile`, preserves other
server keys, and creates files/directories with modes 0600/0700. Those modes apply
on creation, not a chmod repair of an existing path. There is also a separate
per-server **refresh** lock, held across reading old tokens, remote refresh and
saving the replacement; stale/wait intervals are 20/25 seconds. Supplying a custom
backend without `lockDir` means no cross-process refresh lock. A general store
`load()`/`save()` pair is not protected by that whole-operation lock.
[File backend][auth-storage] [MCP locks][pi-oauth]

Use the same agent directory, canonical server identity and Pi store as the runtime.
Do not copy tokens into the Registry, browser state, a bearer header in `mcp.json`,
or a second persistent token store. A transient attempt-local store is reasonable
for isolating verifier/state and staging a new registration, but promoting its result
must merge/compare under the shared store's coordination policy; blindly restoring a
pre-attempt snapshot can erase a concurrent refresh, logout or newer sign-in. The
adapter's safe commit/cleanup policy needs a regression check, not just file locking.

### Existing Pi runtime can refresh HTTPS-created credentials

`createMcpAuthProvider` reads current state before sending a token; it refreshes within
30 seconds of expiry or after 401, shares in-process refresh work, takes the store's
cross-process refresh lock and checks whether the stale token was already replaced.
It obtains a redirect from configured loopback settings, else the stored client's
first registered redirect, else a fallback loopback URI. **Refresh token requests do
not send `redirect_uri`**, so an HTTPS DCR client remains usable by an unchanged Pi
MCP connection. It preserves grant scope when refresh omits it, and `settled()` lets
shutdown wait for a refresh to finish saving. Insufficient scope requires sign-in,
not a refresh. [Private refresh implementation][pi-oauth] [Token requests][flow]

The public `adaptOAuthProvider` is **not** equivalent to Pi's runtime helper: it shares
401 refresh within one wrapper, but lacks Pi's proactive expiry logic, per-server
cross-process lock and `settled()` lifecycle contract. Do not replace Pi's runtime
provider just to change callback handling.

The built-in extension notices changed credentials for `needs-auth` connections at
`turn_start` and reconnects them. Already-connected requests reload tokens through
its auth provider. This is not an immediate push/reconnect guarantee for every live
session; Piano's explicit setup reconnect/check remains a separate acceptance step.
[Extension change detection][extension-runtime] [Connection auth][connection-runtime]

### Redirect/client migration is mandatory

`McpOAuthProvider` does not check whether stored DCR `clientInformation.redirect_uris`
contains its new `redirectUrl`; `authorizeMcp` reuses that client if present. Thus an
old loopback registration can silently be reused to request a disallowed HTTPS
redirect. The existing high-level `signInMcpServer` explicitly drops incompatible
registration/tokens before its own loopback flow. The new adapter needs an equivalent,
intentional migration decision, not just `new McpOAuthProvider({ redirectUrl: https })`.
[Provider][provider] [Private sign-in preparation][pi-oauth]

Bound the first slice to a known DCR server. Stage a fresh HTTPS-compatible client
when the old registration does not include the exact callback; preserve prior usable
credentials on cancelled migration where possible, and only promote a complete new
registration/token pair. Do not run an old refresh against a newly replaced client.
An existing manually configured `clientId` must already allow the exact HTTPS URI;
Piano cannot fix its remote registration locally. A configured secret must be resolved
through the existing Pi mechanism and matched to that client, not copied from user input.

Pi's `cimd` option is **not** an HTTPS alternative: its pi.dev documents name loopback
redirects and its private selection code assumes `/callback` or `/callback/<id>`.
The public provider supports a custom `clientMetadataDocument` function, but hosting
and operating Piano's own CIMD would be a separate scope. Exclude it initially.
Running CLI/TUI loopback sign-in later may replace the HTTPS registration in the
shared credential identity; a future hosted sign-in must recheck it. Likewise handle
public-origin changes deliberately rather than retaining incompatible registrations.
[Pi OAuth/CIMD docs][mcp-doc] [Private client document selection][pi-oauth]

## 4. Synthetic runtime evidence

Command: `node --input-type=module` with the self-contained program in the appendix,
from the Piano root. Exit **0** on the revision/environment above. Actual installed
public OAuth exports were used, followed by actual private Pi storage/refresh helpers
via the explicitly identified private file import. All remote endpoints used reserved
`.example` names and an in-process fake fetch; credentials were synthetic strings.
Default fetch and `net.Server.listen` were fail-closed. No browser or child Pi was started.

Retained output:

```text
PASS public OAuth import; private package subpath rejected; absolute private import works
PASS HTTPS DCR application_type=web; exact authorization redirect; PKCE S256; state; resource/scope discovery
PASS missing/wrong iss rejected before token exchange
PASS synthetic callback exchange; exact redirect; PKCE verifier; tokens/expiry/requested scope persisted
PASS Pi private credential-store key/JSON reload; existing runtime 401 refresh; rotation; scope retention; HTTPS registration retained
PASS existing runtime proactive refresh and settled(); counts DCR=1 exchange=1 refresh=2; no listener/network/disk credentials
```

What this proves: installed code accepts the HTTPS redirect at registration,
authorization and exchange; passes PKCE correctly; rejects missing/wrong issuer;
persists a state shape the existing Pi store reads; and refreshes/rotates that grant
through the existing runtime helper, reactively and proactively.

What it does **not** prove: real Linear registration policy/consent, mobile HTTPS
routing, exe.dev auth/cookie behavior, proxy query redaction, browser binding/replay
logic, multi-process lock races, disk crash durability, migration/cancellation
correctness, or a complete MCP connect/reconnect. Callback state checking in the
experiment is an explicit assertion by the caller, not a feature of `authorizeMcp`.
The fake JSON backend implements only the synchronous `withLock` actually used by
this private class, not the whole TypeScript `AuthStorageBackend` interface.

The main investigation separately reports an import/constructor smoke check using
`https://piano.example/api/settings/mcp/oauth/callback`: the public provider accepts
that exact proposed URI, puts it in `clientMetadata.redirect_uris[0]`, and exposes a
callable `authorizeMcp`. The complete appendix was also extracted from this document
and rerun successfully (exit 0); 30 link destinations were reviewed, with local targets
checked for existence and no remote fetch. No further experiment is needed to establish
this bounded feasibility result.

## 5. Piano integration scope supplied by the main investigation

These observations/recommendations are attributed, not additional Pi findings:

- [`server/Router.ts`](../../server/Router.ts) has GET/POST/PUT/DELETE
  `/api/settings/mcp/login`, but no callback route. [`server/main.ts`](../../server/main.ts)
  uses `HttpRouter.serve` with `disableLogger: true`; no trusted public-origin setting
  exists. [`web/vite.config.ts`](../../web/vite.config.ts) proxies only `/api` and `/ws`.
  Proposed fixed route: **`/api/settings/mcp/oauth/callback`**.
- `ProviderLoginDialog.tsx` already renders an authorization link without a prompt and
  polls every 750 ms. Hosted mode can omit the paste prompt; no popup `postMessage`
  mechanism is necessary.
- `SignInAttempts` owns 15-minute expiry/cancel/shutdown. Callback handling must join
  that server-owned lifecycle with an atomic one-use claim, independent of browser
  connection lifetime. Validate state and binding **before** consuming the attempt;
  reject duplicate/missing parameters, cancelled/stale callbacks and replay.
- Proposed opt-in `PIANO_PUBLIC_ORIGIN=https://…` must be explicit trusted configuration,
  not inferred from `Host` or `X-Forwarded-*`. Keep loopback-bound backend listeners and
  private authenticated exe.dev access. No application auth exists; this is **not**
  multi-user isolation.
- Bind start/callback to a short-lived, host-only, HttpOnly, Secure, SameSite=Lax cookie;
  retain its hash in server memory, not shared login wire state. This is proposed
  browser binding, not implemented/verified cookie behavior. Deliberately handle
  overlapping tabs/attempts without silently overwriting another attempt's binding.
- Return `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and a fixed clean
  redirect/status page, without third-party assets or query echo. Do not signal
  connected before exchange/persistence and MCP reconnect succeed. External proxy
  query logging and expired-edge-auth behavior remain **unverified deployment gates**.
- Preserve the current local-loopback/paste fallback when public origin is absent.

## 6. Bounded recommendation and acceptance gates

Proceed only as an **opt-in, known-server hosted sign-in adapter**, not generic OAuth
infrastructure. Keep a deep module with a small interface for start/status/cancel and
callback completion; hide Pi imports, attempt state, issuer/redirect checks and store
promotion inside it. Browser/router callers should never manipulate verifier/client
information/tokens. Do not add a parallel settings loader or replace `PiSessions`.

Use public `McpOAuthProvider` + `authorizeMcp`; retain the private
`McpOAuthCredentialStore` only behind the existing Pi integration seam and pin/test
that private dependency. Keep normal Pi refresh, credential identity and session
ownership unchanged. If private imports are unacceptable, this version does **not**
provide a fully public compatible file-store solution: retain the current flow or
revisit upstream support, rather than quietly invent a second credential format.

Before calling the feature complete, add narrowly scoped synthetic checks for:

1. Fresh state each time, valid browser binding, wrong/missing/duplicate state/issuer,
   cookie mismatch, callback replay, answer/cancel/timeout races, and shutdown.
2. HTTPS registration migration from an existing loopback client, preserved old
   credentials on cancelled migration, exact redirect consistency, and no cross-server
   credential leaks or stale cleanup erasing a newer grant.
3. Shared-store refresh/rotation across the actual pinned Pi runtime and adapter,
   failed/uncertain exchange, scope step-up, and explicit reconnect outcome.
4. Scratch browser flow with retained **secret-free** evidence; then separately
   authorized real-provider/phone verification and private-edge cookie/logging checks.

The synthetic result is sufficient to establish a usable lower-level seam, **not**
permission to skip those product/security checks or a claim of real-provider support.
No application test suite/build/deploy was run for this research-only change.

### Small possible upstream seam (not required for this recommendation)

A future upstream improvement could let `signInMcpServer` acquire an injected callback
adapter instead of unconditionally starting `OAuthCallbackServer`. The adapter would
supply the fixed redirect URI **before client registration**, wait for a full
`code/state/iss` or OAuth-error response with a cancellation signal, and release its
pending registration on cleanup. Pi should keep fresh-state generation, response
validation, issuer checks, PKCE, migration and token persistence inside the sign-in
module; the host should own HTTPS routing and browser binding. The existing loopback
adapter would remain the default. This is a suggested interface, **not an API available
in 1.1.0**; it should not globally loosen the loopback-only `mcp.json` validator.

Making that high-level function and its credential-store factory supported package
exports would additionally remove the private-import dependency. Merely adding an
`onRedirect` notification (already present lower down) or opening a different browser
URL would not solve callback injection or redirect consistency. No upstream issue,
registration, patch or request was submitted.

## Appendix: reproducible offline experiment

Run this JavaScript on stdin to `node --input-type=module` from the repository root.
The illustrative callback here differs from the main agent's proposed fixed route;
only exact consistency, not the particular path spelling, is under test.

```js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Server } from 'node:net';
import { McpOAuthProvider, MemoryOAuthStateStore, authorizeMcp, OAuthIssuerMismatchError } from '@earendil-works/pi-mcp/oauth';

globalThis.fetch = async () => { throw new Error('Unexpected real fetch'); };
Server.prototype.listen = function () { throw new Error('Unexpected listener'); };
const agentEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
const { McpOAuthCredentialStore, createMcpAuthProvider } = await import(new URL('./extensions/mcp/oauth.js', agentEntry));
await assert.rejects(import('@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
console.log('PASS public OAuth import; private package subpath rejected; absolute private import works');
const serverUrl = 'https://resource.example/mcp';
const issuer = 'https://issuer.example';
const redirectUrl = 'https://piano.example/api/mcp/oauth/callback';
const metadata = {
  issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
  registration_endpoint: `${issuer}/register`, response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
  authorization_response_iss_parameter_supported: true,
};
const store = new MemoryOAuthStateStore();
let authorizationUrl, registrations = 0, exchanges = 0, refreshes = 0;
const fakeFetch = async (input, init = {}) => {
  const url = String(input);
  if (url === 'https://resource.example/.well-known/oauth-protected-resource/mcp') {
    return Response.json({ resource: serverUrl, authorization_servers: [issuer], scopes_supported: ['read'] });
  }
  if (url === `${issuer}/.well-known/oauth-authorization-server`) return Response.json(metadata);
  if (url === `${issuer}/register`) {
    registrations++;
    const body = JSON.parse(init.body);
    assert.deepEqual(body.redirect_uris, [redirectUrl]);
    assert.equal(body.application_type, 'web');
    assert.equal(body.token_endpoint_auth_method, 'none');
    return Response.json({ ...body, client_id: 'synthetic-client' });
  }
  if (url === `${issuer}/token`) {
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('client_id'), 'synthetic-client');
    assert.equal(params.get('resource'), serverUrl);
    if (params.get('grant_type') === 'authorization_code') {
      exchanges++;
      assert.equal(params.get('redirect_uri'), redirectUrl);
      assert.equal(params.get('code'), 'synthetic-code');
      assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), authorizationUrl.searchParams.get('code_challenge'));
      return Response.json({ access_token: 'synthetic-access-1', refresh_token: 'synthetic-refresh-1', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.has('redirect_uri'), false);
    refreshes++;
    assert.equal(params.get('refresh_token'), `synthetic-refresh-${refreshes}`);
    return Response.json({ access_token: `synthetic-access-${refreshes + 1}`, refresh_token: `synthetic-refresh-${refreshes + 1}`, token_type: 'Bearer', expires_in: 3600 });
  }
  throw new Error(`Unexpected fake request: ${url}`);
};
const provider = new McpOAuthProvider({ serverUrl, redirectUrl, store, clientMetadata: { client_name: 'synthetic-piano' }, onRedirect: url => { authorizationUrl = url; } });
const flow = { serverUrl, fetch: fakeFetch };
assert.equal(await authorizeMcp(provider, flow), 'REDIRECT');
assert.equal(authorizationUrl.searchParams.get('redirect_uri'), redirectUrl);
assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorizationUrl.searchParams.get('scope'), 'read');
assert.equal(authorizationUrl.searchParams.get('state'), await provider.state());
console.log('PASS HTTPS DCR application_type=web; exact authorization redirect; PKCE S256; state; resource/scope discovery');
for (const iss of [undefined, 'https://wrong-issuer.example']) {
  await assert.rejects(authorizeMcp(provider, { ...flow, authorizationCode: 'synthetic-code', iss }), OAuthIssuerMismatchError);
}
assert.equal(exchanges, 0);
console.log('PASS missing/wrong iss rejected before token exchange');
const callback = new URL(redirectUrl);
callback.search = new URLSearchParams({ code: 'synthetic-code', state: await provider.state(), iss: issuer }).toString();
// Adapter checks, NOT performed by authorizeMcp:
assert.equal(callback.origin + callback.pathname, redirectUrl);
assert.equal(callback.searchParams.get('state'), await provider.state());
assert.equal(await authorizeMcp(provider, { ...flow, authorizationCode: callback.searchParams.get('code'), iss: callback.searchParams.get('iss') }), 'AUTHORIZED');
assert.equal(store.load().tokens.scope, 'read');
assert.ok(store.load().tokensExpireAt > Date.now());
console.log('PASS synthetic callback exchange; exact redirect; PKCE verifier; tokens/expiry/requested scope persisted');
let serialized;
const backend = { withLock(fn) { const { result, next } = fn(serialized); if (next !== undefined) serialized = next; return result; } };
const credentials = new McpOAuthCredentialStore(backend);
const piStore = credentials.forServer('synthetic', serverUrl);
await piStore.save(store.load());
assert.deepEqual(Object.keys(JSON.parse(serialized)), [`mcp__synthetic|${serverUrl}`]);
const reread = new McpOAuthCredentialStore(backend).forServer('synthetic', serverUrl);
assert.equal((await reread.load()).tokens.access_token, 'synthetic-access-1');
const runtimeAuth = createMcpAuthProvider({ serverUrl, store: reread, settings: () => ({}), onChallenge() {} });
assert.equal(await runtimeAuth.token(), 'synthetic-access-1');
await runtimeAuth.onUnauthorized({ serverUrl: new URL(serverUrl), token: 'synthetic-access-1', fetch: fakeFetch, response: new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer' } }) });
assert.equal(await runtimeAuth.token(), 'synthetic-access-2');
assert.equal((await reread.load()).tokens.scope, 'read');
assert.equal((await reread.load()).clientInformation.redirect_uris[0], redirectUrl);
console.log('PASS Pi private credential-store key/JSON reload; existing runtime 401 refresh; rotation; scope retention; HTTPS registration retained');
await reread.save({ ...await reread.load(), tokensExpireAt: Date.now() - 1 });
globalThis.fetch = fakeFetch;
assert.equal(await runtimeAuth.token(), 'synthetic-access-3');
await runtimeAuth.settled();
assert.deepEqual({ registrations, exchanges, refreshes }, { registrations: 1, exchanges: 1, refreshes: 2 });
console.log('PASS existing runtime proactive refresh and settled(); counts DCR=1 exchange=1 refresh=2; no listener/network/disk credentials');
```

## Sources

Installed links name the exact shipped executable/declaration files inspected, rather
than an unpinned upstream `main` branch. Corresponding upstream versioned source trees:
[pi-mcp v1.1.0](https://github.com/earendil-works/pi/tree/v1.1.0/packages/mcp/src/oauth)
and [coding-agent MCP v1.1.0](https://github.com/earendil-works/pi/tree/v1.1.0/packages/coding-agent/src/extensions/mcp).
Those remote links were not fetched for this offline investigation.

[exports]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/index.d.ts
[mcp-package]: ../../node_modules/@earendil-works/pi-mcp/package.json
[pi-package]: ../../node_modules/@earendil-works/pi-coding-agent/package.json
[provider]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/provider.js
[provider-types]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/provider.d.ts
[flow]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/flow.js
[flow-types]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/flow.d.ts
[oauth-types]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/types.d.ts
[auth-types]: ../../node_modules/@earendil-works/pi-mcp/dist/auth-provider.d.ts
[discovery]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/discovery.js
[callback]: ../../node_modules/@earendil-works/pi-mcp/dist/oauth/callback.js
[pi-oauth]: ../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.js
[pi-oauth-types]: ../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.d.ts
[config-validator]: ../../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js
[auth-storage]: ../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js
[pi-index]: ../../node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts
[extension-types]: ../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.d.ts
[extension-runtime]: ../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js
[connection-runtime]: ../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.js
[mcp-doc]: ../../node_modules/@earendil-works/pi-coding-agent/docs/mcp.md
[mcp-readme]: ../../node_modules/@earendil-works/pi-mcp/README.md
[sdk-example]: ../../node_modules/@earendil-works/pi-coding-agent/examples/sdk/14-codemode-mcp.ts
[linear-note]: 2026-10-11-linear-mcp-remote-oauth.md
[adr]: ../adr/0001-pi-rpc-workspace-workbench.md
[invariants]: ../development-invariants.md
