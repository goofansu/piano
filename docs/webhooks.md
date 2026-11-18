# Webhooks

Receivers must be public HTTPS: every DNS answer is checked at delivery time and there is no
private-network exception, also for previously saved hooks. Responses are never displayed, since
they might echo credentials.

## Verification

`test/Webhooks.test.ts`, `test/WebhookReceiver.test.ts` and the
[Settings recipe](../.agents/skills/verify-piano/features/settings-other.md) (inactive webhook
editing and URL refusal only) never deliver to a public receiver.
