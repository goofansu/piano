# Share a session

## Driving it with agent-browser

Preconditions: synthetic saved sessions only; signed-out scratch Local and peers. Run
`node test/browser/remote-session.mjs <evidence-directory>` for the maintained journey, which owns
its three isolated instances and clears inherited Radius API keys.

- **Confirm:** open a saved session, then `find role button click --name "Session information and actions"`
  and `find role menuitem click --name "Share"`. The dialog names its session and machine,
  everything saved without redaction, and an organization default that may be public. Cancel sends
  nothing. Mod+K → Share opens the same confirmation.
- **Local sign-in:** confirm with `find role button click --name "Share"`; wait for
  `Nothing was uploaded.`. **Open Providers** reaches Local's Providers settings.
- **Peer sign-in from main:** repeat on eng-1's saved session. The notice names eng-1, directs
  sign-in in that machine's own Piano, and says main's sign-in is not used. No Local Providers
  shortcut appears. The main browser issues only the peer-qualified Share request.
- **Result states:** the journey's response adapter holds a synthetic reply to observe the locked
  pending dialog, then answers a confirmed public link. Copy link turns to Link copied and the clipboard
  matches; Open link targets the same URL. A synthetic uncertain reply warns to check Radius and
  offers Done, not retry. Keep those captures with the run.

## Gotchas

The result-state adapter proves UI handling, not a Radius publication. The module test covers the
actual server upload boundary using synthetic JSONL and a fake Radius HTTP transport. Do not share
live user transcripts for verification. Real Radius publication, native rendering and authenticated
Open link access need separate permission and separate evidence.
