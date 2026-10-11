# Linear MCP OAuth from a phone to a remote client

Checked 2026-10-11 against official Linear documentation, public discovery metadata,
the current MCP specification (**2026-07-28**, resolved from `/specification/latest`),
and IETF security guidance. This is research, not an implementation or deployment.
Current Piano reproduction evidence below was supplied by the main investigation;
this research did not independently rerun it.

## Conclusions

- **The immediate rejection is a missing `http://` scheme**: the user confirmed
  omitting it, matching the supplied controlled reproduction. This is separate from
  the expected inability of a phone
  to reach a callback listener on the remote server's loopback interface.
- A loopback callback targets the **browser's device**, not the machine that generated
  the authorization link. Manual paste can bridge that gap when the client supports
  it, but is a client-specific recovery mechanism, not a Linear or MCP requirement.
  [RFC 8252 §7.3, §8.3][native] [MCP authorization][auth]
- Prefer an **exactly registered HTTPS callback to the server-owned OAuth operation**
  for a polished phone journey, if Pi exposes the necessary callback integration.
  Keep PKCE, state, issuer validation, token exchange and credential ownership with
  Pi; do not introduce a competing OAuth/token store just to avoid paste.
  This is a recommendation, not a claim that Piano or Pi supports it today.
  [MCP security][security] [Piano architecture][architecture] [INV-01/04/11/12][invariants]
- Do not alter an in-flight `redirect_uri`, expose the remote loopback listener, or
  send a callback through a model prompt, search service, issue, screenshot or log.
  Callback codes and state are sensitive even when PKCE limits code redemption.
  [Linear OAuth][linear-oauth] [RFC 9700 §4.2–4.3][bcp]

## Current Piano: bounded evidence from the main investigation

Environment: **HEAD `4ceeee7`, Node v24.21.0**. The user supplied a schemeless
address; its actual code, state and address are intentionally not retained here.

| Check reported by the main investigation | Result |
| --- | --- |
| Temporary copy of `test/McpSetup.test.ts`, removing `/^http:\/\//` from `redirect.href` passed to `setup.answerLogin`; `node --test --import ./test/setup.ts test/McpOAuthResearch.tmp.test.ts` | 0 passed, 1 failed, approximately 954 ms. `SignInError`: “Paste the full address of the page your browser opened after approving.” Temporary file removed. |
| Original full-scheme test: `node --test --import ./test/setup.ts test/McpSetup.test.ts` | 1 passed, approximately 924 ms. |

The main investigation reports that `server/McpSetup.ts` lines 91–98 uses
`new URL(value.trim())` and checks callback origin/path/state and code or error.
It also reports that Pi's `oauth.js` requires an absolute URL and forwards `iss`.
These are attributed source observations, not findings from this research's own
Pi runtime audit. [Piano source][setup-source] [Existing test][setup-test]

**Interpretation:** the user subsequently confirmed omitting `http://`, confirming
missing scheme as the immediate cause of this rejection. A callback from an
older/mismatched attempt can also produce the same generic rejection, but is not
needed to explain this incident. The controlled test establishes parser behavior,
not that Safari stripped the scheme during copying. No real Linear consent, mobile
clipboard behavior, successful live token exchange, or complete hosted sign-in
journey was exercised. The passing original test is not proof of those journeys.

The older [MCP management note][older-note] describes an earlier setup surface;
it must not be treated as an up-to-date implementation audit. Further current
Piano behavior remains the main investigation's responsibility.

## What official Linear sources establish

1. **Endpoint and grants.** Linear recommends Streamable HTTP at
   `https://mcp.linear.app/mcp`; `/sse` is a deprecated fallback. Its interactive
   setup is documented as OAuth 2.1 with dynamic client registration (DCR).
   [Linear MCP — General and FAQ][linear-mcp]
2. **Least privilege.** Linear documents `/mcp/readonly` (only read tools), or
   requesting only `read` on `/mcp` (the underlying token cannot reach write APIs).
   A read-restricted API key is another documented alternative.
   [Linear MCP — General and FAQ][linear-mcp]
3. **Explicit noninteractive alternative.** Linear expressly accepts its OAuth
   tokens and API keys in `Authorization: Bearer …`, including tokens from an
   existing Linear OAuth application. This is Linear-specific documented support,
   not permission to forward arbitrary other-service tokens to arbitrary MCP
   servers. MCP's general audience-validation and no-token-passthrough rules still
   matter. [Linear MCP — FAQ][linear-mcp] [MCP security][security]
4. **Own OAuth application.** Linear's developer guide permits registering callback
   URLs, requires the same `redirect_uri` at code exchange, describes PKCE, and
   requires a returned state to match the originally supplied value. Its generic
   OAuth page lists both `plain` and `S256`; MCP clients should follow MCP's stronger
   `S256` requirement rather than copy the weaker option. Registering a separate
   Linear API app is a different integration path from using MCP discovery/DCR.
   [Linear OAuth][linear-oauth] [MCP security][security]
5. **No documented phone-paste contract.** The reviewed Linear pages do not promise
   manual callback paste, a special out-of-band redirect, or a device-code login.
   Absence from these pages is not proof that no other integration could support
   such a flow. Do not invent a device-code flow as a workaround.
   [Linear MCP][linear-mcp] [Linear OAuth][linear-oauth]

### Public metadata observed (unauthenticated GETs only)

[Protected-resource metadata][resource-metadata] advertises resource
`https://mcp.linear.app/mcp`, authorization server `https://mcp.linear.app`,
scopes `read` and `write`, and bearer authentication via header.

[Authorization-server metadata][as-metadata] advertises:

- Authorization `/authorize`, token `/token`, and registration `/register` on
  `https://mcp.linear.app` — **not** the generic API app endpoints in Linear's
  developer OAuth guide.
- PKCE `S256`, authorization-code and refresh-token grants, and query response mode.
- `authorization_response_iss_parameter_supported: true`.
- `client_id_metadata_document_supported: true`, alongside DCR support.
- No advertised device-authorization endpoint or device-code grant.

These are capability advertisements at research time, not a tested registration,
consent or token exchange. Do not assume arbitrary HTTPS callback acceptance from
metadata alone. Do not assume `form_post` support: the observed response mode is
`query`. No client was registered and no authorization was started for this research.

## Why remote loopback and manual paste differ

RFC 8252's loopback flow is designed for a native client listening on the same
device as the browser. HTTP is acceptable there because the request stays on that
device; the listener should bind only to loopback and exist only for the flow.
An HTTP callback to `127.0.0.1` on a phone therefore cannot automatically reach a
listener on the Piano VM. A failed local page load does not by itself establish
that Linear denied consent or that code exchange failed. [RFC 8252 §7.3, §8.3][native]

**Manual paste recommendation:** if the pending client operation supports it, copy
its complete final redirect address, including `http://`, path and all query
parameters, into that operation's dedicated sign-in input. Preserve `iss` as well
as code/state. Do not paste the initial authorization link or a previous attempt's
callback. The page itself need not load for a client to parse its address, but
whether a particular phone browser exposes the full failed-navigation URL needs
an actual browser check. This is a client-specific bridge, not a standards-defined
out-of-band grant. [Reported reproduction above](#current-piano-bounded-evidence-from-the-main-investigation)
[RFC 8252][native] [MCP authorization response validation][auth]

A future scheme-recovery UX could recognize only the **pending operation's exact
expected loopback callback**, supply its known scheme, then run the unchanged
origin/path/state/issuer checks. That is a proposal requiring security review and
regression evidence, not permission to accept arbitrary schemeless URLs, bare codes,
or mismatched state. Never fetch a pasted URL as a generic server-side URL: parsing
and forwarding to the owned OAuth operation avoids turning paste into SSRF.
[MCP security guidance — SSRF][ssrf]

## Secure web callback alternatives (recommendations, not current behavior)

### A. Preferred: Pi-owned OAuth with a registered HTTPS callback

A stable, illustrative callback such as
`https://piano.example/oauth/mcp/callback` is reachable by the phone. The phone
navigates to it; the OAuth server need not connect directly to the private backend.
The HTTPS edge can route to the existing loopback-bound service without making
Piano's raw control port public. Preserve the private authenticated access boundary.
[RFC 8252][native] [MCP security][security] [INV-11][invariants]

Prerequisites and design obligations:

- Pi must support specifying the callback **before registration/authorization** and
  delivering the result into its pending OAuth operation. Register the exact HTTPS
  URI using supported client metadata, preregistration or DCR; use the same URI in
  authorization and token exchange. Editing the URL after consent is not a migration
  strategy. Latest MCP marks DCR deprecated/backwards-compatible and favors client
  metadata documents where supported; Linear currently advertises both.
  [MCP authorization][auth] [Linear OAuth][linear-oauth] [Public metadata][as-metadata]
- Maintain a short-lived server-owned attempt bound to the initiating authorized
  browser/user, client, MCP resource, expected issuer, redirect URI, state and PKCE
  verifier. Resolve callback/cancel/timeout once; reject replay and stale attempts.
  Browser refresh should observe, not recreate, the operation. Keep the verifier
  and tokens off the browser and out of Registry/history. [RFC 9700 §2.1, §4.2][bcp]
  [MCP authorization][auth] [INV-01/02/04/11/12][invariants]
- Validate `iss` against the saved, validated issuer **before any code exchange**.
  Current MCP requires rejection when metadata advertises issuer responses but
  `iss` is missing, or when a present issuer mismatches. Compare the decoded issuer
  string exactly; do not normalize it. Linear advertises issuer responses today.
  Forwarding `iss` alone does not prove the installed Pi performs this validation.
  [MCP authorization response validation][auth] [Public metadata][as-metadata]
- Prevent callback query logging at **every layer**, including proxy, application,
  analytics, error monitoring and browser evidence. Render no third-party resources;
  use `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and transition to a
  clean result URL without echoing callback parameters. This reduces leakage; it
  does not promise erasure from browser history. Proxy authentication must not
  forward the callback query to an unrelated login service as a return URL. Test
  expired-auth and phone cookie behavior, not only an already-authenticated desktop.
  [RFC 9700 §4.2–4.3][bcp] [INV-11][invariants]
- Keep the callback narrowly scoped; never add an arbitrary return-URL redirect or
  arbitrary port/host forwarding. Restrict OAuth discovery egress and validate
  redirects against SSRF. Report success only after Pi confirms credential exchange/
  persistence, not merely after a callback page loads. [MCP security][security]
  [MCP SSRF guidance][ssrf] [INV-09/12][invariants]

A same-origin callback adapter that delivers validated parameters to Pi may be
sufficient if Pi exposes the needed seam. A public third-party relay adds another
credential-sensitive trust boundary and is not the default recommendation. A
reverse proxy alone cannot change Pi's registered redirect or token-exchange URI.
The main investigation also read the installed Pi 1.1.0
[`docs/mcp.md`](../../node_modules/@earendil-works/pi-coding-agent/docs/mcp.md):
`oauth.callbackUrl` must use HTTP on `localhost`, `127.0.0.1`, or `[::1]`.
An HTTPS callback is therefore **not a supported configuration-only change** in
this version; it needs an upstream integration seam or an explicitly designed
adapter. No Pi callback-injection capability is asserted by this research.

### B. Separate Linear OAuth app, then Linear-supported bearer authentication

A server-side Linear OAuth app with a registered HTTPS callback is an officially
documented alternative, and Linear says its OAuth access token can authenticate
MCP. It entails application registration, scope decisions, secure refresh/revocation
and credential integration. For Piano, adopt it only through an agreed Pi credential
integration; otherwise it creates a second auth owner and violates the intended
architecture. Never persist a bearer token in browser storage or tracked MCP JSON.
[Linear OAuth][linear-oauth] [Linear MCP FAQ][linear-mcp] [INV-01/11/12][invariants]

### C. Operational fallbacks

- A narrowly scoped Linear API key avoids interactive redirects, but introduces a
  separately managed secret with its own rotation/revocation obligations. It is a
  deliberate alternative, not an automatic response to a paste error. [Linear MCP][linear-mcp]
- A secure local port-forward on the **browser's device** could carry its loopback
  request to the owned remote listener without rewriting the registered callback.
  This is a topology inference, not a tested Linear/Piano feature. A laptop tunnel
  does not fix a phone browser's loopback; mobile tunneling is poor default UX.
  Keep both ends restricted, never bind the callback to all interfaces.
  [RFC 8252 §8.3][native]

## Verification and limitations

- Directly retrieved and read official Linear docs, public metadata, current MCP
  authorization/security material and relevant IETF sections. Reviewed source links
  and repository conventions. No user callback, code, state, verifier or token was
  read, retained, or sent anywhere by this research.
- **Requested `radius_web_search` was unavailable in this agent's exposed tool set.**
  Used direct HTTPS retrieval instead; no search-tool execution is claimed.
- Reproduction outcomes are supplied evidence from the main investigation, not
  independently executed here. No real Linear login, mobile browser journey,
  registration, token exchange, credential-file access or application test occurred.
- Only this research document was added. No application changes, commit or deployment.
  Implementation would need synthetic callback/issuer/state/replay tests and a
  separately authorized phone journey with secret-safe evidence collection.

[linear-mcp]: https://linear.app/docs/mcp
[linear-oauth]: https://linear.app/developers/oauth-2-0-authentication
[resource-metadata]: https://mcp.linear.app/.well-known/oauth-protected-resource/mcp
[as-metadata]: https://mcp.linear.app/.well-known/oauth-authorization-server
[auth]: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
[security]: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
[ssrf]: https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices#server-side-request-forgery-ssrf
[native]: https://www.rfc-editor.org/rfc/rfc8252.html
[bcp]: https://www.rfc-editor.org/rfc/rfc9700.html
[architecture]: ../adr/0001-pi-rpc-workspace-workbench.md
[invariants]: ../development-invariants.md
[older-note]: 2026-10-09-mcp-management.md
[setup-source]: ../../server/McpSetup.ts
[setup-test]: ../../test/McpSetup.test.ts
