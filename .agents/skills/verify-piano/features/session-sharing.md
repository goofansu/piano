# Share a session

## Driving it with agent-browser

Preconditions for Local: a seeded, signed-out scratch launch with no inherited Radius API key;
use only its synthetic saved sessions. A peer is not needed for confirmation or Local sign-in.
For the maintained peer/result-state journey, run
`node test/browser/remote-session.mjs <evidence-directory>` under the skill's run-limit exception;
it owns three isolated instances and clears inherited Radius API keys. When that exception is
unavailable, drive Local below and report peer/result-state coverage separately.

- **Confirm:** `ab open "$WEB_URL/s/verify-plan"; ab wait --text 'Answer 4.'`, then
  `ab find role button click --name 'Session information and actions' --exact;
  ab find role menuitem click --name Share --exact; ab wait --text 'Share to Radius'`.
  Capture the confirmation, which says the artifact is created with Private visibility.
  `ab find role button click --name Cancel --exact` closes it without sharing.
  Mod+K → Share opens the same confirmation; wait for settled palette results before choosing it.
- **Local sign-in:** confirm with `ab find role button click --name Share --exact;
  ab wait --text 'Cannot share'`; capture the toast. `ab find role button click --name Providers --exact;
  ab wait --url '**/settings/providers'; ab wait '[aria-label="Sign in to Radius"]'`
  reaches Local's Providers settings. The peer journey separately checks this destination after
  switching to eng-1 while the Local toast is still open.
- **Peer sign-in from main:** repeat on eng-1's saved session. The "Cannot share" toast names
  eng-1; its **Providers** opens the peer's own origin at `/settings/providers` in a new tab,
  never Local's Providers. The main browser issues only the peer-qualified Share request.
- **Result states:** the journey's response adapter holds a synthetic reply to observe the Sharing
  session toast while the app stays usable, then answers a confirmed private link. Copy link turns to Link copied and the clipboard
  matches; Open link opens the same URL. A synthetic uncertain reply warns to check Radius and
  offers no retry. Result toasts stay until closed with "Close toast". Keep those captures with the run.

## Gotchas

The result-state adapter proves UI handling, not a Radius publication. The module test covers the
actual server upload boundary using synthetic JSONL and a fake Radius HTTP transport. Do not share
live user transcripts for verification. Real Radius publication, native rendering and authenticated
Open link access need separate permission and separate evidence.
