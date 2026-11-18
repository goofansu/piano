# Settings › Providers, Webhooks and Preferences

## Driving it with agent-browser

Preconditions: a seeded launch. No credentials or receiver are needed.

- `providers`
  - Action: `ab open "$WEB_URL/settings/providers"; ab wait '[aria-label="Sign in to Radius"]'`.
  - Result: Radius shows Account, Radius MCP and Web search; installation buttons are disabled
    on the unsigned-in scratch instance. Capture `01-providers`; its header has no Machine
    picker. Inspect the same header boundary on Webhooks at `ab set viewport 390 844`, then
    widen to 1280×800. Without configured peers this proves the local header only; the remote
    journey separately checks suppression when a peer picker would otherwise be available.
    Do not install or sign in to
    turn this read-only setup check into an authenticated claim.
- `api-key-setup` (no credentials)
  - Action: on Providers, `ab find role button click --name 'Add Fireworks API key' --exact;
    ab wait '[role=dialog]'`; capture `11-fireworks-key`.
  - Result: Add Fireworks API key explains "Saved in Pi on this machine. Start a new session
    to use it." Cancel with `ab find role button click --name Cancel --exact;
    ab wait --fn "!document.querySelector('[role=dialog]')"`; the row still offers Add key.
    Repeat with `Add OpenCode Go API key` and `Add OpenCode Zen API key`, capturing each
    dialog and cancellation. Google uses the bundled Gemini mark in the provider row.
    This proves catalog/setup availability, not saved-key validation or provider access.
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
- Provider/Radius sign-in, installation and publication access need controlled
  credentials. The unsigned-in Providers page proves only the available setup controls.
- Webhook delivery, event catch-up, Test and delivery-failure recovery need a controlled public HTTPS
  receiver. Loopback/private receivers are refused by design. Inactive CRUD does not prove delivery.
- These controls persist into the scratch database or isolated configuration. Cleanup removes them;
  never reuse a live account, key or webhook configuration to fill a coverage gap.
