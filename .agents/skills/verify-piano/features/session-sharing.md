# Share a session

## Driving it with agent-browser

Preconditions: a seeded, signed-out scratch launch with no inherited Radius API key; use only
its synthetic saved sessions. The maintained journey,
`node test/browser/session-sharing.mjs <evidence-directory>`, owns its scratch instance, clears
inherited Radius API keys and covers every step below, including the result states.

- **Confirm:** `ab open "$WEB_URL/s/verify-plan"; ab wait --text 'Answer 4.'`, then
  `ab find role button click --name 'Session information and actions' --exact;
  ab find role menuitem click --name Share --exact; ab wait --text 'Share to Radius'`.
  Capture the confirmation, which says the artifact is created with Private visibility.
  `ab find role button click --name Cancel --exact` closes it without sharing.
  Mod+K → Share opens the same confirmation; wait for settled palette results before choosing it.
- **Sign-in:** confirm with `ab find role button click --name Share --exact;
  ab wait --text 'Cannot share'`; capture the toast. `ab find role button click --name Providers --exact;
  ab wait --url '**/settings/providers'; ab wait '[aria-label="Sign in to Radius"]'`
  reaches the Providers settings.
- **Result states:** the journey's response adapter holds a synthetic reply to observe the Sharing
  session toast while the app stays usable, then answers a confirmed private link. Copy link turns to Link copied and the clipboard
  matches; Open link opens the same URL. A synthetic uncertain reply warns to check Radius and
  offers no retry. Result toasts stay until closed with "Close toast". Keep those captures with the run.

## Gotchas

The result-state adapter proves UI handling, not a Radius publication. The module test covers the
actual server upload boundary using synthetic JSONL and a fake Radius HTTP transport. Do not share
live user transcripts for verification. Real Radius publication, native rendering and authenticated
Open link access need separate permission and separate evidence.
