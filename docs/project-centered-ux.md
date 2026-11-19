# Project-centered UX

The index and a project's home draw only from what the browser holds (`projects`, the session
catalog): no request, no Git, no Pi (PIN-83).

A home's session row leads its second line with the catalog's activity as a `StatusDot` beside its
word: Working, Idle or Finished, and nothing when Pi is off. Finished is the catalog's `done`: Pi's
turn ended while the session was not open. It says nothing about whether the work passed
verification, so the row does not say "Done" (PIN-164). A starting session's row says Starting
alone.

The catalog decides activity once, and the sidebar rows and the sidebar button's working indicator
read the same answer: a starting session has none. While the connection is lost, and until the
reconnected server sends its host snapshot, no session is Working or Idle, since the cached snapshot
may be stale; Finished stays, because that turn was seen to end.
