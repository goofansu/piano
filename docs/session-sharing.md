# Session sharing

**Share** is in the session menu, sidebar row menu and command palette on Local and peers.
It is visible regardless of main's Radius sign-in. Confirmation states the Private visibility. Only
saved data is included; in-flight unsaved messages are not. The upload runs in the background and a
toast carries the result and its link.

Missing or rejected Radius authentication shows a "Cannot share" toast with **Providers**. On
Local it opens Local's Settings → Providers, even after switching machines while the toast stays
open; for a peer it opens that peer's own Piano at `/settings/providers` in a new tab, using the
peer's configured `origin`, which the machine list sends as `url`. The user signs in there and
shares again from main. Main's sign-in is never used as a fallback. Provider authentication
resolves and refreshes through Pi's `ModelRuntime`, independent of the selected model, a model
turn or configured MCP servers.

Each explicit confirmation creates a new artifact through the fixed Radius MCP endpoint. Visibility
is always `private`. No stable link, database association, version update, automatic retry or background sync
exists. A failure before the create request is sent (Radius unreachable while connecting, or not
offering artifact creation) says nothing was uploaded. A failed or interrupted upload after it is
sent may have committed; its toast provides no retry button and asks the user to check Radius
before starting another share. Dismissing the toast or reloading
loses the link;
Radius remains its owner. See [the decision](adr/0006-confirmed-raw-session-sharing.md).

## Owners and checks

- `shared/share.ts` and `shared/http.ts`: result and confirmed POST contract, ID-only routing,
  peer request bound. The browser captures machine/workspace/session when opening the dialog.
- `server/SessionSharing.ts`: one in-flight upload per machine, resolution through
  `SessionReferences`, Pi-owned auth, bounded upload lifecycle, safe result/error projection.
- `server/PiHistory.ts`, exposed through `PiSessions.history.savedJsonl`: unchanged UTF-8 bytes
  from the registered file, at most 25 MiB (the shared
  [Radius file bound](radius-artifacts.md#file-size), from
  <https://radius.pi.dev/v1/openapi.json>); read through `server/LocalFile.ts` (regular files
  only, refused if the length changes during the read), path identity/version checks before and
  after, JSONL parsing and matching session header. Missing, incomplete or changing files are refused,
  never repaired, truncated or retried. This does not lock Pi's writer or flush unsaved state.
- `extensions/radius-artifacts/RadiusClient.ts`: existing direct authenticated MCP adapter,
  redirects refused, no auth-provider/reconnection retry, 4 MiB response bound and deadlines.
  Session Share does not invoke the standalone artifact extension or its private-default policy.
- `server/Router.ts`, `PeerGateway` and `RemoteRequests`: owning-machine admission and relay,
  no transcript or Radius token sent through main/browser. Raw content itself can contain paths
  or secrets; the exact-file export is intentional, not a containment boundary.
- `web/src/components/ShareSessionDialog.tsx`, `CommandHost` and `sessionCommands`: explicit
  confirmation, background upload, sign-in guidance, uncertainty and the confirmed link.
- `test/SessionSharing.test.ts`: synthetic JSONL through the real HTTP handler and fake Radius
  transport, exact bytes/private visibility/one mutation, auth, invalid files, failures before the
  create request, unsafe replies and overlapping submissions. `test/PeerGateway.test.ts` protects
  machine routing and no replay;
  `test/SessionCommands.test.ts` covers action availability and menu/palette placement.
- `test/browser/remote-session.mjs` imports `session-sharing.mjs`: Local and peer confirmation,
  actual signed-out owner responses, Local Providers shortcut (also from a peer), the peer's
  Providers link. Browser response interception covers the background upload, Copy/Open controls
  and uncertain results without uploading.
  It does not prove live Radius rendering or authenticated viewing access.

[Verification recipe](../.agents/skills/verify-piano/features/session-sharing.md).
