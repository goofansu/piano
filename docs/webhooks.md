# Webhooks

Open **Settings → Webhooks** (or **Webhooks** in the Mod+K command palette), then **Add webhook**.
Enter an HTTPS receiver URL, optionally a Bearer token, and select at least one event. HTTP is
allowed only for loopback hosts (`localhost`, `127.0.0.1`, `[::1]`). URLs cannot contain credentials
or fragments. Only configure receivers you trust with conversation text.

Rows show the receiver's host, its events, the Active switch and the last delivery as a status dot
with the outcome, the HTTP status (or the transport failure) and when. The row menu provides
**Edit**, **Test** and **Delete**; Delete asks first. A saved token is never returned: the
editor shows it masked, so leaving the field blank keeps it, typing replaces it, and **Remove** on
the field clears it when saved.
Tokens are stored as written, not encrypted, in Piano's private SQLite database; protect its backups
too.

**Test** posts `ping` even for an inactive webhook. It carries `ignore: true`, so a receiver
should acknowledge it without acting. The result shows as a toast and on the row: the HTTP status,
or a generic transport/timeout failure. Responses are never displayed, since they might echo
credentials.

## Events

| Event | Live source | Action |
| --- | --- | --- |
| `session.completed` | Successful final response (`response_completed`), including a token-limit ending | `null` |
| `session.needs_input` | A dialog becomes the session's `needs_input` disposition | `Answer in Piano: <url>` |
| `session.failed` | Pi closes with `failed`, a non-zero `exited` or `released_during_work`; a clean exit (code 0) is not a failure | `Open session in Piano: <url>` |
| `ping` | Test only; not subscribable | `null` |

Only active, subscribed hooks receive live events. Delivery is immediate: no grace delay, no
cancellation when someone opens the session, and no saved-history replay. Completion is an agent
response, not proof that its task succeeded or its work was verified.

## Payload and headers

Every request has these fields, with explicit `null` for unavailable common values:

```json
{
  "source": "piano",
  "version": 1,
  "event": "session.completed",
  "deliveryId": "30ca6194-e054-4d5c-bf92-dac518a74292",
  "occurredAt": "2026-10-23T00:00:00.000Z",
  "action": null,
  "workspace": { "id": "workspace-id", "folder": "my-repo" },
  "session": {
    "id": "session-id",
    "title": "Implement the change",
    "url": "https://piano.example/s/session-id",
    "model": "provider/model"
  },
  "pullRequest": null,
  "answer": "Done.",
  "answerTruncated": false
}
```

- Completed: `answer` (at most 2,000 characters, or null) and `answerTruncated`.
- Needs input: `question: {kind, title, message, options}`; missing values are null.
- Failed: `failure: {reason, detail, exitCode}` and `answer` (possibly null).
- Ping: `ignore: true`; workspace, session and pullRequest are null.

`workspace.folder` is a folder name, never cwd or an absolute path. Free-form text uses Piano's
display redaction, removes configured webhook tokens and strips filesystem paths best-effort.
This is not a security boundary: an answer or dialog can still disclose sensitive conversation
content. No prose summary or hook ID is included in the body.

A pull request is included only when that session has a link in Piano's database:
`{number, url, state: null}`. Delivery never reads Git or asks GitHub for current state. Session
links use the configured [browser origin](configuration.md#browser-origins), preferring HTTPS,
never request headers. When no origin is configured, the URL is null and the action names Piano
without a link.

Headers:

- `Content-Type: application/json`
- `User-Agent: Piano-Webhook/1` (payload protocol version)
- `Authorization: Bearer <token>` only when set
- `X-Piano-Event: <event>`
- `X-Piano-Delivery: <deliveryId>` — a new UUID for each request, also in the body
- `X-Piano-Hook-ID: <database id>`

There is no HMAC signature. Use HTTPS and verify the Bearer token at the receiver.

## Delivery and storage

Delivery is best-effort, with no automatic retry, log of past deliveries or redelivery action.
Only 2xx counts as delivered. Redirects are refused and each request has a 10-second timeout.
A failure can be ambiguous: the receiver may have acted before Piano lost the response.

One background owner admits at most 32 pending deliveries and schedules separate per-hook lanes;
a slow receiver does not stall the session observer or another receiver. At most 32 hooks can be
configured, with one in-flight request per hook. Overflow is dropped and logged without URLs,
tokens or payloads. Pending live events are rechecked for active/subscribed status before sending.
Disabling or deleting a hook does not recall an already-sent request. Shutdown drops pending work.

SQLite schema 8 adds `webhooks (id, url, token, events, active, created_at)`. Preferences survive a
restart; the last-delivery result lives only in memory and resets on restart. Tokens are excluded
from general database projections and all HTTP responses. Settings endpoints are:

- `GET /api/settings/webhooks` → `[{id, url, hasToken, events, active, lastDelivery}]`
- `PUT /api/settings/webhooks` with `{id?, url, token?, events, active}` → saved public row;
  omitted token preserves it, null clears it
- `POST /api/settings/webhooks/remove` with `{id}`
- `POST /api/settings/webhooks/test` with `{id}` → delivery result

Mutations require an allowed Origin, like other Settings endpoints. Piano remains a
[private trusted-developer tool](configuration.md), not a public webhook relay.
