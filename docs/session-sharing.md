# Session sharing

**Share** is in the session menu, sidebar row menu and command palette on Local and peers.
It is visible regardless of main's Radius sign-in. Confirmation is a "Share to Radius" dialog with
Cancel, Share and one line: the artifact is created with Private visibility. It does not restate
that the whole saved file goes up unredacted, and it makes no claim about who can view a private
artifact. Only saved data is included; in-flight unsaved messages are not. Confirming closes the dialog and the upload runs behind other work, answered by
one toast: Sharing session, then Session shared with Open link and Copy link, Copy link primary. A
result toast stays until dismissed.

Missing or rejected Radius authentication offers **Open Providers** on Local. For a peer it directs
the user to that machine's own Piano → Settings → Providers, then back to main to share again.
Main's sign-in is never used as a fallback. Provider authentication resolves and refreshes through
Pi's `ModelRuntime`, independent of the selected model, a model turn or configured MCP servers.

Each explicit confirmation creates a new artifact through the fixed Radius MCP endpoint. Visibility
is always `private`. No stable link, database association, version update, automatic retry or background sync
exists. A failed or interrupted upload may have committed; its toast provides no retry button and
asks the user to check Radius before starting another share. Dismissing the toast or reloading loses
the displayed link;
Radius remains its owner. See [the decision](adr/0005-confirmed-raw-session-sharing.md).

## Owners and checks

- `shared/share.ts` and `shared/http.ts`: result and confirmed POST contract, ID-only routing,
  peer request bound. The browser captures machine/workspace/session when opening the dialog.
- `server/SessionSharing.ts`: one in-flight upload per machine, resolution through
  `SessionReferences`, Pi-owned auth, bounded upload lifecycle, safe result/error projection.
- `server/PiHistory.ts`, exposed through `PiSessions.history.savedJsonl`: unchanged UTF-8 bytes
  from the registered file, at most 10 MiB; regular-file and before/after identity/version checks,
  JSONL parsing and matching session header. Missing, incomplete or changing files are refused,
  never repaired, truncated or retried. This does not lock Pi's writer or flush unsaved state.
- `extensions/radius-artifacts/RadiusClient.ts`: existing direct authenticated MCP adapter,
  redirects refused, no auth-provider/reconnection retry, 1 MiB response bound and deadlines.
  Session Share does not invoke the standalone artifact extension or its private-default policy.
- `server/Router.ts`, `PeerGateway` and `RemoteRequests`: owning-machine admission and relay,
  no transcript or Radius token sent through main/browser. Raw content itself can contain paths
  or secrets; the exact-file export is intentional, not a containment boundary.
- `web/src/components/ShareSessionDialog.tsx`, `CommandHost` and `sessionCommands`: explicit
  confirmation, background upload, sign-in guidance, uncertainty and the confirmed link.
- `test/SessionSharing.test.ts`: synthetic JSONL through the real HTTP handler and fake Radius
  transport, exact bytes/private visibility/one mutation, auth, invalid files, unsafe replies and
  overlapping submissions. `test/PeerGateway.test.ts` protects machine routing and no replay;
  `test/SessionCommands.test.ts` covers action availability and menu/palette placement.
- `test/browser/remote-session.mjs` imports `session-sharing.mjs`: Local and peer confirmation,
  actual signed-out owner responses, Local Providers shortcut, main-to-peer guidance. Browser
  response interception covers the background upload, Copy/Open controls and uncertain results
  without uploading.
  It does not prove live Radius rendering or authenticated viewing access.

[Verification recipe](../.agents/skills/verify-piano/features/session-sharing.md).
