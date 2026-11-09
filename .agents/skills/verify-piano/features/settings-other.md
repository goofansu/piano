# Settings › Providers, Webhooks and Preferences

Providers holds accounts, API keys and Radius setup. Webhooks configures session-event receivers.
Preferences controls voice input. These pages share Settings navigation and the palette; a
credential-free scratch run can inspect setup, cancel the voice-key prompt and manage an inactive
webhook without contacting its receiver. These observations do not prove sign-in or delivery.

## Sub-features

- `providers`: Providers has Radius, Accounts and API keys groups. Unsigned-in Radius offers
  Sign in to Radius; Install Radius MCP and Install web search are disabled until setup permits them.
- `preferences`: Voice input is off without a key. Turning it on opens OpenAI API key, explaining
  that recordings and session context go to OpenAI; Cancel leaves it off.
- `webhook-empty`: Webhooks shows No webhooks yet and New webhook.
- `webhook-create`: New webhook has URL, Bearer token Optional, Events and Active. A private HTTP
  URL is refused inline. Creating an inactive public HTTPS entry saves it without a delivery.
- `webhook-delete`: Webhook actions <host> → Delete asks Delete webhook?, then removes the row.

## How to get to it (user POV)

- Sidebar Settings → Providers, Webhooks or Preferences.
- Mod+K → Providers, Webhooks or Preferences; on Webhooks, New webhook opens its editor.
- Address bar: `/settings/providers`, `/settings/webhooks`, `/settings/preferences`.
  Radius is within Providers, not a separate Settings section or palette destination.

## Driving it with agent-browser

Preconditions: seeded launch, `. "$RUN/run.env"`, doctor passed;
`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`. No credentials or receiver are needed.

- `providers`
  - Action: `ab open "$WEB_URL/settings/providers"; ab wait '[aria-label="Sign in to Radius"]'`.
  - Result: Radius shows Account, Radius MCP and Web search; installation buttons are disabled
    on the unsigned-in scratch instance. Capture `01-providers`. Do not install or sign in to
    turn this read-only setup check into an authenticated claim.
- `preferences`
  - Action: `ab open "$WEB_URL/settings/preferences"; ab wait --text "Voice input"`;
    capture `02-preferences`, then `ab find role switch click --name "Voice input" --exact;
    ab wait --text "OpenAI API key"`.
  - Result: the key dialog explains the data sent to OpenAI. Capture `03-key-prerequisite`, then
    `ab find role button click --name "Cancel" --exact;
    ab wait --fn "!document.querySelector('[role=dialog]')"`.
    Voice input remains off. Capture `04-cancelled`; no key was saved or recording sent.
- `webhook-empty` and `webhook-create`
  - Action: `ab open "$WEB_URL/settings/webhooks"; ab wait --text "No webhooks yet"`;
    capture `05-webhooks`, then `ab find role button click --name "New webhook" --exact;
    ab find role textbox fill --name "URL" --exact "http://127.0.0.1:9/verify";
    ab find role switch click --name "Active" --exact`.
    Capture `06-draft`, then `ab find role button click --name "Create webhook" --exact;
    ab wait --text "Use a public HTTPS URL without credentials or a fragment."`.
  - Result: refusal under URL; the dialog remains. Capture `07-refused`.
  - Action: `ab find role textbox fill --name "URL" --exact "https://example.com/verify";
    ab wait --fn "document.querySelector('#webhook-active').getAttribute('aria-checked') === 'false'";
    ab find role button click --name "Create webhook" --exact; ab wait --text "Webhook created"`.
  - Result: inactive example.com row, session.completed and No deliveries yet.
    Capture `08-created`. Keep it inactive and do not choose Test: example.com is not a test receiver.
- `webhook-delete`
  - Action: `ab wait --fn "!document.querySelector('[data-sonner-toast]')";
    ab find role button click --name "Webhook actions example.com" --exact;
    ab find role menuitem click --name "Delete" --exact; ab wait --text "Delete webhook?"`;
    capture `09-confirm`, then `ab find role button click --name "Delete" --exact;
    ab wait --text "No webhooks yet"`.
  - Result: the row disappears. Capture `10-deleted`.

## Gotchas

- Voice transcription requires an approved OpenAI key, browser microphone permission and a
  recording-capable browser. The Preferences → Voice input → key-dialog route proves the
  missing-key prerequisite, not recording, context transmission or transcription into the draft.
- Provider/Radius sign-in, installation, authenticated Share and publication access need controlled
  credentials. The unsigned-in Providers page proves only the available setup controls.
- Webhook delivery, event catch-up, Test and delivery-failure recovery need a controlled public HTTPS
  receiver. Loopback/private receivers are refused by design. Inactive CRUD does not prove delivery.
- These controls persist into the scratch database or isolated configuration. Cleanup removes them;
  never reuse a live account, key or webhook configuration to fill a coverage gap.
