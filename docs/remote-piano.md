# One remote Piano

The machine picker connects this browser to **Local** or one existing Piano owned by the same
user. It is a conversation surface, not machine management. The remote's registered sessions
appear even when another browser or an agent started them. Terminal Pi history that the remote
Piano has not registered is not discovered.

## Setup

Both Pianos must remain on loopback behind exe.dev private access. Configure the peer integration
outside Piano, attached to the VM running the main backend. The authorized scratch example is:

```sh
ssh exe.dev integrations add http-proxy --name piano-scratch-test \
  --target https://eng-1.exe.xyz:3000/ --peer --attach vm:eng-2
```

On the **main** Piano's VM, write a private JSON configuration file outside the checkout:

```json
{
  "id": "eng-1",
  "name": "eng-1",
  "endpoint": "https://piano-scratch-test.int.exe.xyz",
  "origin": "https://eng-1.exe.xyz:3000"
}
```

Start the main backend with `PIANO_PEER_CONFIG=/absolute/path/to/peer.json`, keeping its normal
`HOST=127.0.0.1` and `PIANO_ALLOWED_ORIGINS` configuration. This is startup configuration: changing
it requires an explicit restart. No remote is configured by default, and Local retains its
existing behavior. Do not point this scratch example at a production service for verification.

`id` is a stable lowercase slug, not `local`; it identifies routes and browser state. Keep it bound
to the same backend identity; use a different ID for another Piano rather than repointing it.
`name` is the picker label. `endpoint` is the integration's HTTPS origin, without path, credentials,
query or fragment. HTTP loopback endpoints require `NODE_ENV=test` and exist only for isolated development tests.
`origin` is the **target Piano's allowed Origin**, not the integration hostname. No client token
is needed for this exe.dev peer integration; the edge supplies scoped authentication. Piano does
not change integrations or copy credentials.

## Use

Choose **eng-1** from **Machine**, open a listed session and send a text follow-up. The existing
model/effort, context, queue, dialog and Stop controls apply to that remote session. Cmd+K searches
only the selected machine and offers **Switch to Local** / **Switch to eng-1**. A remote session's
address is `/m/eng-1/s/<sessionId>`; reload and back/forward retain that machine.

A switch disconnects this browser's attachment, not the run. Returning or reconnecting reads a
fresh authoritative snapshot; it never resends input. Check the conversation before retrying any
input whose delivery is uncertain. Disconnection makes the remote unavailable, never Local.

Unsent drafts and question replies are isolated by machine and retained only for this page load.
Reload discards drafts as in Local. Remote model catalogs are memory-only and cannot populate
Local's persisted catalog. Remote files, credentials, history and database remain remote.

## Deliberate limits

- No remote session creation, archive/delete/rename/pin, projects management, worktree or machine
  management. Create/manage those on the owning Piano.
- No remote file/Changes/attachment/preview or account/settings controls. These requests are not
  forwarded to Local. Remote transcript attachments/local-file actions are unavailable.
- Only the configured peer and supported operations are routed. There is no arbitrary URL proxy,
  redirect following, mutation retry or cross-machine search. The browser never contacts the
  integration hostname.
- The configured destination is trusted, not an authenticated instance-ID handshake. Existing
  registry/session schemas are the compatibility check, not universal version negotiation. Keep
  peer versions compatible and verify the actual pair. Fake-Pi evidence does not certify a real
  Pi runtime or authenticated external-browser access.

See [ADR 0004](adr/0004-same-owner-piano-peer.md) for ownership and trust decisions.
