# Settings › Webhooks

## Driving it with agent-browser

Preconditions: a seeded launch. No webhook receiver is needed.

- `webhook-empty` and `webhook-create`
  - Action: `ab open "$WEB_URL/settings/webhooks"; ab wait --text "No webhooks yet"`;
    capture `01-webhooks`, then `ab find role button click --name "New webhook" --exact;
    ab find role textbox fill --name "URL" --exact "http://127.0.0.1:9/verify";
    ab find role switch click --name "Active" --exact`.
    Capture `02-draft`, then `ab find role button click --name "Create webhook" --exact;
    ab wait --text "Use a public HTTPS URL without credentials or a fragment."`.
  - Result: refusal under URL; the dialog remains. Capture `03-refused`.
  - Action: `ab find role textbox fill --name "URL" --exact "https://example.com/verify";
    ab wait --fn "document.querySelector('#webhook-active').getAttribute('aria-checked') === 'false'";
    ab find role button click --name "Create webhook" --exact; ab wait --text "Webhook created"`.
  - Result: inactive example.com row, session.completed and No deliveries yet.
    Capture `04-created`. Keep it inactive and do not choose Test: example.com is not a test receiver.
- `webhook-delete`
  - Action: `ab wait --fn "!document.querySelector('[data-sonner-toast]')";
    ab find role button click --name "Webhook actions example.com" --exact;
    ab find role menuitem click --name "Delete" --exact; ab wait --text "Delete webhook?"`;
    capture `05-confirm`, then `ab find role button click --name "Delete" --exact;
    ab wait --text "No webhooks yet"`.
  - Result: the row disappears. Capture `06-deleted`.

## Gotchas

- Webhook delivery, event catch-up, Test and delivery-failure recovery need a controlled public HTTPS
  receiver. Loopback/private receivers are refused by design. Inactive CRUD does not prove delivery.
- Webhooks persist into the scratch database. Cleanup removes them; never reuse a live webhook
  configuration to fill a coverage gap.
