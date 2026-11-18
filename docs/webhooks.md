# Webhooks

Open **Settings → Webhooks** (or **Webhooks** in the Mod+K command palette), then **New webhook**.
Enter a public HTTPS receiver URL, optionally a Bearer token of at least 8 visible ASCII characters
(shorter ones would redact ordinary words from payloads), and select at least one event. HTTP,
loopback, private and special-use IP addresses are not allowed. URLs cannot contain credentials
or fragments. Only configure receivers you trust with conversation text.

At delivery time, every DNS answer must be public; the connection uses those checked addresses
without resolving again. DNS failures or non-public answers fail delivery. This also applies to
previously saved hooks: local/private receivers must be replaced with public HTTPS receivers.
There is no private-network exception. TLS verifies the receiver's original hostname.

Rows show the receiver's host, its events, the Active switch and the last delivery as a status dot
with the outcome, the HTTP status (or the transport failure) and when. The row menu provides
**Edit**, **Test** and **Delete**; Delete asks first. A saved token is never returned: the
editor shows it masked, so leaving the field blank keeps it, typing replaces it, and **Remove** on
the field clears it when saved.
Tokens are stored as written, not encrypted, in Piano's private SQLite database; protect its backups
too.

**Test** posts `ping` even for an inactive webhook. It carries `ignore: true`, so a receiver
should acknowledge it without acting. A Test waits only for a request already in flight to its
receiver, ahead of that receiver's pending deliveries. The result shows as a toast and on the row: the HTTP status,
or a generic transport/timeout failure. Responses are never displayed, since they might echo
credentials.

## Developer navigation

- **Owners:** `server/Webhooks.ts` (what is sent and when), `server/WebhookReceiver.ts` (URL and
  DNS checks, transport), `shared/webhooks.ts` and `web/src/components/WebhookSettings.tsx`.
- **Smallest check:** `node --test --import ./test/setup.ts test/Webhooks.test.ts` (or
  `test/WebhookReceiver.test.ts`); then the
  [Settings recipe](../.agents/skills/verify-piano/features/settings-other.md) on scratch Piano.
- **Not proved:** the recipe covers inactive webhook editing and URL refusal only; neither check
  delivers to a public receiver.
