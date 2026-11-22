# Settings › Providers

## Driving it with agent-browser

Preconditions: a seeded launch. No credentials are needed.

- `providers`
  - Action: `ab open "$WEB_URL/settings/providers"; ab wait '[aria-label="Sign in to Radius"]'`.
  - Result: Radius shows Account, Radius MCP and Web search; installation buttons are disabled
    on the unsigned-in scratch instance. Capture `01-providers`. Inspect the same header on
    Webhooks at `ab set viewport 390 844`, then widen to 1280×800.
    Do not install or sign in to
    turn this read-only setup check into an authenticated claim.
- `api-key-setup` (no credentials)
  - Action: on Providers, `ab find role button click --name 'Add Fireworks API key' --exact;
    ab wait '[role=dialog]'`; capture `02-fireworks-key`.
  - Result: Add Fireworks API key explains "Saved in Pi on this machine. Start a new session
    to use it." Cancel with `ab find role button click --name Cancel --exact;
    ab wait --fn "!document.querySelector('[role=dialog]')"`; the row still offers Add key.
    Repeat with `Add OpenCode Go API key` and `Add OpenCode Zen API key`, capturing each
    dialog and cancellation. Google uses the bundled Gemini mark in the provider row.
    This proves catalog/setup availability, not saved-key validation or provider access.

## Gotchas

- Provider/Radius sign-in, installation and publication access need controlled
  credentials. The unsigned-in Providers page proves only the available setup controls.
- A saved key persists into the isolated Pi configuration. Cleanup removes it; never reuse a live
  account or key to fill a coverage gap.
