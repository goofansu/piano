# Webhooks

Receivers must be public HTTPS: every DNS answer is checked at delivery time and there is no
private-network exception, also for previously saved hooks. Responses are never displayed, since
they might echo credentials. Payload text (answers, questions, titles and failure details) is not
redacted: it can include credentials and filesystem paths. Answers retain the existing 2,000-character
limit and truncation flag. Configure only receivers trusted with this content; see
[ADR 0005](adr/0005-faithful-display-content.md).

## Verification

`test/Webhooks.test.ts`, `test/WebhookReceiver.test.ts` and the
[Settings recipe](../.agents/skills/verify-piano/features/settings-other.md) (inactive webhook
editing and URL refusal only) never deliver to a public receiver.
