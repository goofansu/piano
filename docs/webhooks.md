# Webhooks

Receivers must be public HTTPS: every DNS answer is checked at delivery time and there is no
private-network exception, also for previously saved hooks. Responses are never displayed, since
they might echo credentials.

## Failure reasons

`session.failed` carries `failure.reason`. `turn_failed` means a model turn ended with an error
once Pi settled, after any automatic retries, while Pi kept running. `failure.detail` is Pi's
error message. Retried attempts send nothing. Any other reason names how Pi's process closed
(for example `exited`, with `failure.exitCode`). A user's stop sends no failure.

## Verification

`test/features/webhooks/Webhooks.test.ts`, `test/features/webhooks/WebhookReceiver.test.ts` and the
[Settings recipe](../.agents/skills/verify-piano/features/settings-other.md) (inactive webhook
editing and URL refusal only) never deliver to a public receiver.
