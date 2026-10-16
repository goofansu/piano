# Integrations and Slack notifications

Open **Settings → Integrations**. The page links to exe.dev's integration dashboard and shows one
**Slack** card. Its radio buttons list the Slack webhooks attached to the current VM, named as
exe.dev names them, with **Off** first. Choosing a webhook saves immediately and enables
notifications; it does not send a test message. Choosing **Off** disables future notifications. This
preference applies to all sessions on this Piano backend, not just your tab.

The radios hold integrations with type `slack` from exe.dev Reflection, attached to the current
VM. It excludes Slack bots, mobile notifications and other integration types. It does not list every
integration in your exe.dev account. No webhook is chosen automatically, even when there is only one.
Creation, channel choice and VM attachment remain
[exe.dev's integration dashboard](https://exe.dev/integrations)'s responsibility. See [exe.dev's Slack guide](https://exe.dev/docs/integrations-slack.md).

**Test** sends an explicit message to the saved integration. “Accepted” means the integration accepted
the HTTP request; check Slack to confirm it appeared. The page shows one sentence about integrations,
the Slack card and actionable errors: no raw webhook input or routine saved-state notices.

## Completion messages and links

Piano sends one line, “Agent finished responding.” followed by the session's URL, when a live
agent run settles with a successful final response. This does not mean a task is accepted or verified.
Aborted/failed runs, intermediate `agent_end` events and opening saved history do not send completion
notifications. No prompt, response content, session title or filesystem path is included. The link
contains only the session ID, and Slack link/media previews are disabled. Delivery is server-owned,
continues with the browser closed, and does not use a Pi extension.

The first HTTPS origin in `PIANO_ALLOWED_ORIGINS` is used for links, for example
`https://your-vm.exe.xyz/s/<sessionId>`. Put your preferred public Piano origin first if you configure
multiple HTTPS aliases. No URL is inferred from request headers or the VM name. If no HTTPS origin
is configured, Settings explains what to configure and disables selection/Test rather than sending
a broken or localhost link. Off remains available. Tests link to Piano's home page because they do
not belong to a session. Links still require normal private exe.dev access; posting them does not
grant Slack channel members access to Piano.

## Detection and discovery

The Settings entry and command-palette row appear after the backend successfully reads VM metadata
from `https://reflection.int.exe.xyz/`. Detection has a **one-second timeout**, checks TLS, and never
follows redirects. Success is remembered in backend memory until restart, not in Piano's database.
Failures are unknown, retried on later checks with a 30-second backoff. The UI retries while visible
until detection succeeds, and on focus. A detached Reflection integration can therefore hide exe.dev
Settings on an actual exe.dev VM. Detection is not authorization; Piano still needs private access.

Integration discovery is separate: the backend reads the fixed `/integrations` path when advertised
by Reflection, with its own one-second deadline and bounded response body. Inventory is cached for
30 seconds, independently of positive detection. Opening the Integrations page, focusing its window or
using Retry/Refresh bypasses the inventory cache. Discovery errors are not empty results and do not
hide the page after detection succeeds. Integration comments/help text are never displayed or executed.

Selection and Test validate against freshly discovered Slack names. Automatic delivery uses the
bounded-age catalog and rechecks the saved destination before sending. A removed or changed-type
integration is not used. If discovery is unavailable after the cache expires, automatic delivery is
skipped rather than guessed. The saved selection remains visible and clearable; it is never replaced
by another integration automatically. After a successful refresh, a missing name shows as a
checked but disabled radio marked “(not attached)”; **Off** and the attached webhooks stay
selectable and **Test** is hidden.

## Storage and delivery limits

Piano stores only the selected integration name in `notification_settings.integration_name`
(schema 6), with at most one row. No row means the preference is cleared (`null`). The browser and
notification queue also use names; the HTTPS URL is constructed only when sending, after validating
the name against discovered Slack integrations. Pi's settings and history are unchanged.

On opening a schema-5 database, Piano atomically converts the saved exe.dev URL to its name and
removes the old `notification_webhooks` table. An older multiple-webhook list keeps its first active
selection; an empty list stays disabled. Migration needs no network access, and a currently unattached
name remains saved and clearable. If the active legacy URL is malformed or is not an exe.dev integration
URL, startup refuses the migration and leaves the old table/version intact rather than silently
clearing or changing the destination. Repair that preference before restarting; the error does not
print the potentially secret URL. Databases older than schema 5 start with no notification selection.

Delivery is best-effort: each POST has a five-second timeout and is not automatically retried.
The backend admits at most five sends per minute, including tests, in line with exe.dev's documented
Slack limit. Automatic sends wait in a bounded queue (32 pending notifications); overflow is dropped.
Other VMs may consume the user's quota. Replacing or clearing the selection skips old queued sends,
but cannot recall an in-flight request. Failures are logged without URLs or payloads; test failures
appear in Settings. A restart retains the selection but loses pending deliveries. If a run finishes
before anyone opens the UI after a restart, the worker discovers exe.dev and the catalog itself.
There is no durable delivery ledger or exactly-once promise across restarts.

The [research note](research/2026-10-16-exe-dev-settings.md) records the design and verification.
