# Slack notifications on exe.dev

In **Settings → Notifications**, enter the URL of a Slack integration attached to the VM,
for example `https://slack-hook.int.exe.xyz/`, then click **Add**. Add up to ten destinations;
adding a URL enables notifications for that channel. **Remove** stops future notifications
for that URL. These preferences apply to all sessions on this Piano backend, not just your tab.

**Test** sends an explicit test message. Adding a URL never sends one. “Accepted” means the
integration accepted the HTTP request; check Slack to confirm it appeared. Setup and channel
selection happen in [exe.dev's Slack integration](https://exe.dev/docs/integrations-slack.md).
Only root HTTPS URLs under `<integration-name>.int.exe.xyz` are accepted, not direct Slack secret
webhooks or mobile notification integrations. The URL must point to a Slack integration.

Piano sends “Piano: agent finished responding.” plus a clickable **Open session** link to every
saved destination when a live agent run settles with a successful final response. This does not mean a task is accepted or
verified. Aborted/failed runs, intermediate `agent_end` events, and opening saved history do not
send completion notifications. No prompt, response content, session title or filesystem path is
included. The link contains only the session ID, and Slack link/media previews are disabled.
Delivery is server-owned and continues with the browser closed.

### Session link origin

The first HTTPS origin in `PIANO_ALLOWED_ORIGINS` is used for links, for example
`https://your-vm.exe.xyz/s/<sessionId>`. Put your preferred public Piano origin first if you
configure multiple HTTPS aliases. Existing hosted installations already configure this origin;
no URL is inferred from request headers or the VM name. If no HTTPS origin is configured,
Settings explains what to configure and disables Add/Test rather than sending a broken or
localhost link. Removing saved webhooks remains available. Test messages link to Piano's home
page because they do not belong to a session. Session links still require normal private exe.dev
access; posting them does not grant Slack channel members access to Piano.

## Availability

The Settings entry and command-palette row appear only after the backend successfully reads VM
metadata from `https://reflection.int.exe.xyz/`. Detection has a **one-second timeout**, checks TLS,
and does not follow redirects. Success is remembered in backend memory until restart, not in
Piano's database. Failed detection is unknown, retried on later checks with a 30-second backoff.
The UI checks again every 30 seconds while visible until detection succeeds, and on window focus.
A detached Reflection integration can therefore hide Notifications on an actual exe.dev VM.

Saved URLs survive a restart; pending deliveries do not. If a run finishes before anyone opens
the UI after a restart, the delivery worker detects the environment itself. A moved database does
not carry exe.dev detection with it. Detection is not an authentication or authorization boundary;
Piano must still remain on loopback behind private access.

## Delivery limits

Delivery is best-effort: each HTTP send has a five-second timeout and is not automatically retried.
One failed destination does not prevent the remaining destinations from being attempted. The
backend admits at most five sends per minute, including tests, in line with exe.dev's documented
Slack limit. Automatic sends wait for capacity in a bounded queue (32 pending destinations);
overflow is dropped. Other VMs may also consume the user's Slack quota. A test at the limit asks
you to try again later. Removing a URL also skips its queued sends, but cannot recall an in-flight
request. Failures are logged without URLs or payloads; test failures are shown in Settings.

Webhooks live in Piano's database (`notification_webhooks`, schema version 5); Pi's settings and
history are unchanged. This is not a durable delivery ledger, and there is no exactly-once promise
across backend restarts. See the [research note](research/2026-10-16-exe-notifications.md) for the
initial alternatives; this implemented slice is Slack-only.
