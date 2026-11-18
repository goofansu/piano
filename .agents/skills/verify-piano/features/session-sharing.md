# Share a session

## Driving it with agent-browser

Preconditions: synthetic saved sessions only; signed-out scratch Local and peers. Run
`node test/browser/remote-session.mjs <evidence-directory>` for the maintained journey, which owns
its three isolated instances and clears inherited Radius API keys.

- **Confirm:** open a saved session, then `find role button click --name "Session information and actions"`
  and `find role menuitem click --name "Share"`. The dialog is titled "Share to Radius". Cancel sends
  nothing. Mod+K → Share opens the same confirmation.
- **Local sign-in:** confirm with `find role button click --name "Share"`; wait for the "Cannot
  share" toast. **Providers** reaches Local's Providers settings, also after switching to eng-1
  with the toast still open.
- **Peer sign-in from main:** repeat on eng-1's saved session. The "Cannot share" toast names
  eng-1; its **Providers** opens the peer's own origin at `/settings/providers` in a new tab,
  never Local's Providers. The main browser issues only the peer-qualified Share request.
- **Result states:** the journey's response adapter holds a synthetic reply to observe the Sharing
  session toast while the app stays usable, then answers a confirmed private link. Copy link turns to Link copied and the clipboard
  matches; Open link opens the same URL. A synthetic not-private reply shows "Share is not
  Private" with only Open link, never "Session shared". A synthetic uncertain reply warns to check Radius and
  offers no retry. Result toasts stay until closed with "Close toast". Keep those captures with the run.

## Gotchas

The result-state adapter proves UI handling, not a Radius publication. The module test covers the
actual server upload boundary using synthetic JSONL and a fake Radius HTTP transport. Do not share
live user transcripts for verification. Real Radius publication, native rendering and authenticated
Open link access need separate permission and separate evidence.
