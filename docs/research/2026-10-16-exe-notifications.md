# exe.dev notifications in Settings

Research date: 2026-10-16. Source revision: `93ca45d80f33876493d382f99355109f03ed4dbd`.
Status: recommendation, not implemented. No notifications were sent.

## Findings

**Yes: discover exe.dev capabilities from the backend using Reflection.** The documented
`GET https://reflection.int.exe.xyz/` returns VM metadata, including a name and paths to
optional metadata. `GET /integrations` lists attached integrations by name and type.
Reflection is attached by default for new accounts, but its attachment can be changed. Therefore
success is useful positive evidence; failure is not proof that the server is outside exe.dev.
Do not use it as an authentication or authorization boundary. [1]

Read-only probes from this exe.dev VM returned HTTP 200 for both endpoints. The index contained
a string name and `/integrations`; the integration list included:

| Name | Type |
| --- | --- |
| `slack-hook` | `slack` |
| `notify` | `notify` |

This establishes discovery here, not delivery success. Owner email, comments and unrelated
integration details were not retained in this note. No dependable environment-variable marker
was established by this research. Hostnames, browser origins and the presence of `/home/exedev`
would be heuristics, not a documented capability contract.

### Slack

The official integration accepts Slack incoming-webhook JSON, including `{"text":"…"}`.
The integration must be attached to the sending VM. Each integration targets one Slack channel;
the actual Slack webhook secret is held by exe.dev, not on the VM. Integration names are
configurable, so `slack-hook` must not be hard-coded as the only allowed name. Documentation
states a limit of **five messages per minute per user** and HTTP 404 for a revoked Slack
webhook. [2]

User-provided example, corroborated by the official Slack documentation:

```sh
curl --json '{"text":"Hello from exe.dev!"}' https://slack-hook.int.exe.xyz/
```

### Mobile

exe.dev's official iOS announcement explicitly says software running on a VM can use the
`notify.int.exe.xyz` integration to notify a phone. This VM advertises an attached integration
of type `notify`. [3; local observation above]

User-provided request contract:

```sh
curl -X POST https://notify.int.exe.xyz/ \
  -H 'Content-Type: application/json' \
  -d '{"title":"Done","body":"Task finished"}'
```

The reviewed public sources establish iOS notification support, but do not specify this payload's
full schema, delivery guarantees, rate limits, Android support, or deep-link support. Treat
`title`/`body` as the user's supplied contract pending an explicit delivery test; do not invent
additional fields or equate HTTP acceptance with a phone displaying the notification.

## Recommended first slice

Add **Settings → Notifications**, with one optional destination initially:

- Enabled switch, off by default.
- Format: **Slack** or **Mobile**. A URL alone cannot determine the JSON payload for arbitrary
  integration names. Discovery may suggest a format from `slack` or `notify`, but retain the
  explicit choice.
- Webhook URL, editable, with the two supplied URLs as format-specific suggestions.
- Save and **Send test notification**. Saving never sends a message; testing is an explicit
  external action, with a clearly identified test payload and an inline result.
- Copy: notify when the agent finishes responding, not “task completed.” Settling does not
  establish that the user's goal was achieved or checks passed. [4]

Keep the page available when detection fails, with a concise explanation that delivery requires
an attached exe.dev integration. Do not hide saved configuration because Reflection is temporarily
unavailable. Discovery is a setup convenience, not a prerequisite for attempting a configured send.
Show delivery failures on demand in Settings, rather than adding persistent transcript warnings.
Configuration is backend-instance-wide in Piano's current trusted-developer model, not per browser
or per signed-in user. Notifications may go to a shared Slack channel; say where they will go.

### Detection

Proposed backend flow:

1. On Settings load (with short-lived caching), GET the fixed Reflection index with a short
   timeout, a response-size cap, TLS verification and redirects disabled. Validate the JSON shape.
2. If the index advertises `/integrations`, GET that fixed path and validate only the required
   name/type fields. Never execute integration `help` strings or follow arbitrary supplied URLs.
3. Return a minimal capability result to the browser: detected or unknown/unavailable, plus
   relevant notification integration suggestions. Do not forward email, comments or the entire
   integration inventory.
4. Bound all failures; never delay server startup or session execution on discovery. A manual
   URL remains usable when discovery is missing or permission-limited.

This is preferable to relying on an inherited shell variable: Piano can run under systemd, and
the relevant environment is the backend's VM, not the user's browser.

### Delivery and security

- Send HTTP requests from the backend, not from React or a browser subscription. This preserves
  notification behavior with zero tabs and prevents two tabs from sending duplicates (INV-02).
- Persist preferences in Piano's database, not Pi's settings or browser local storage (INV-01).
  The current registry schema has no notification setting; this requires an explicit persistence
  addition, not an assumption that a generic settings endpoint already exists. [5]
- For this exe.dev-only slice, accept only parsed HTTPS URLs of the form
  `https://<integration-name>.int.exe.xyz/`: one valid DNS label, root path, no credentials,
  query, fragment or non-default port. Reject lookalike suffixes, IP literals and localhost;
  disable redirects on every send. This narrowly permits the intended exe.dev integration proxy
  without creating a generic server-side URL fetcher. Arbitrary webhook providers or custom paths
  should be a separate, explicit security expansion (INV-11).
- Keep existing origin checks and private loopback deployment. VM detection does not authorize
  configuration changes. Anyone with current Piano access can potentially configure delivery;
  this feature must not imply per-user isolation. [4]
- Send minimal fixed content, e.g. “Piano: agent finished responding.” Do not include prompts,
  assistant output, filesystem paths or session titles by default. Defer links until a trusted
  externally reachable Piano base URL is configured; never derive it from an arbitrary Host header.
- Use a bounded queue and bounded HTTP duration outside Pi's record-processing/publication lock.
  Provider failure must not fail a session or stall stdout draining. Rate-limit/coalesce Slack
  delivery to respect the documented user-level limit; other VMs can still consume that quota. [2; 6]
- Start with best-effort delivery, no blind automatic retries after ambiguous timeouts, and no
  replay after server restart. Deduplicate each observed run completion in memory. Do not promise
  exactly-once delivery or a durable outbox in this first slice. Report test HTTP acceptance as
  “accepted,” not proof of receipt on Slack/iOS.

### When to send

Pi already projects `agent_settled` into non-streaming state. `agent_end` alone is not sufficient:
Pi may retry or continue automatically. [4; 6]

Observe a live run's transition to settled once, not an idle snapshot on opening/reconnecting.
Track the run within its session/host generation; no per-tab observer should own delivery.
Do not label a cancellation, child exit or model failure as successful completion. Initially
suppress aborted/error runs; add distinct failure or needs-input notifications only with explicit
policy. Waiting for an extension dialog is a separate possible future trigger.

Keep raw Pi protocol handling inside PiSessions/PiRecords. If a notification consumer needs a
completion fact absent from today's public events, add a semantic event behind that seam rather
than parsing raw RPC in a second module. [4; 6]

## Likely implementation touchpoints

These are source observations and proposed changes, not a committed implementation plan:

- [`web/src/lib/routes.ts`](../../web/src/lib/routes.ts): the shared Settings destination list
  drives routing, navigation and command-palette entries. Add `notifications` here.
- [`web/src/components/SettingsPage.tsx`](../../web/src/components/SettingsPage.tsx): add the page
  to the exhaustive page map, using the existing Settings frame and upstream shadcn controls.
- [`server/Registry.ts`](../../server/Registry.ts) and
  [`server/RegistryDatabase.ts`](../../server/RegistryDatabase.ts): explicitly store preferences.
- [`server/Router.ts`](../../server/Router.ts), [`shared/wire.ts`](../../shared/wire.ts) and
  [`web/src/lib/api.ts`](../../web/src/lib/api.ts): typed settings/discovery/test boundaries.
  Send the configured URL in a JSON body, not an HTTP URL/query parameter.
- [`server/PiSessions.ts`](../../server/PiSessions.ts) and
  [`server/PiRecords.ts`](../../server/PiRecords.ts): authoritative lifecycle observation.
  A small notification service should own URL validation, format selection, queueing and sending;
  provider/network policy must not leak into Pi protocol translation.

This fits the roadmap's daily-use priority without resuming durable orchestration or introducing
a new remote trust model. Affected invariants: INV-01, INV-02, INV-03, INV-05, INV-11 and INV-12. [4; 7]

## Verification for implementation

Claim: an opted-in user gets at most one best-effort send per eligible settled run while the
server remains alive, independent of browser tabs; discovery and delivery failures cannot disturb
agent execution. Smallest useful checks:

- HTTP-boundary fixtures: exact Slack/mobile payloads; malformed URLs and redirect rejection;
  timeout, 404 and 429; Reflection missing, malformed or listing a differently named integration.
- Scratch-database roundtrip: defaults disabled, save/reload, disable prevents future sends.
- Fake-Pi lifecycle check through PiSessions: retries/`agent_end` do not send prematurely;
  settled sends once; snapshots/reconnects/two tabs do not duplicate; abort/exit do not announce
  success; a hung sender cannot delay session events. Reuse existing cases where they protect this.
- Scratch browser: configure, save, reload, test explicitly, show a useful error, navigate via
  the palette. Use injected network fixtures rather than real webhook sends by default.
- Only with explicit permission, send one clearly labeled test to each real integration and have
  the user confirm receipt. No real model call is needed to test webhook delivery.

## Research evidence and limitations

Source and link review only: no code changed, so application suites and browser checks were not
run. Read-only Python `urllib.request` probes used five-second timeouts from this VM and returned
200 for Reflection index and integrations. No notification POST, deployment, restart, database
mutation or live model call was performed. Public docs were fetched successfully; an official-source
search found the iOS announcement but not a full mobile notification API reference. These findings
establish feasibility and integration discovery, not end-to-end delivery.

## Sources

1. [exe.dev Reflection integration](https://exe.dev/docs/integrations-reflection.md).
2. [exe.dev Slack integration](https://exe.dev/docs/integrations-slack.md).
3. [exe.dev iOS announcement](https://blog.exe.dev/ios).
4. [Development invariants](../development-invariants.md) and
   [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md).
5. [Registry schema](../../server/Registry.ts).
6. [Pi record projection](../../server/PiRecords.ts),
   [session host](../../server/PiSessions.ts) and
   [publication boundary](../../server/SessionPublication.ts).
7. [Implementation roadmap](../roadmap.md).

Additional background: [exe.dev HTTP proxy integration](https://exe.dev/docs/integrations-http-proxy.md)
explains proxy-held credentials; [documentation index](https://exe.dev/docs.md) identifies the
first-party integration references. User-provided curl examples above are requirements/evidence
from this conversation, not independently tested delivery contracts.
