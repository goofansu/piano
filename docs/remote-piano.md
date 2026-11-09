# One remote Piano

The machine picker connects this browser to **Local** or one existing Piano owned by the same
user. It is a conversation surface, not machine management. The remote's registered sessions
appear even when another browser or an agent started them. Terminal Pi history that the remote
Piano has not registered is not discovered.

## Setup

The main Piano can run on your laptop or on an exe.dev VM. Both backends stay bound to loopback;
the remote stays behind exe.dev private access. Choose one of the two authentication modes below.
Neither changes the remote session protocol or requires a target upgrade.

### From an exe.dev VM: peer integration

Configure the peer integration
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

### From your laptop: VM-scoped HTTPS token

Use an [exe.dev VM token](https://exe.dev/docs/https-tokens-for-vms), **not** a management API token.
It authorizes access to eng-1's private HTTPS services, not only Piano or a single port. Do not paste
it into chat, commit it, or put it in browser storage. The token is the laptop's access credential;
remote Pi/provider credentials remain on eng-1.

Generate and store the token on your laptop (with your existing exe.dev SSH identity):

```sh
umask 077
mkdir -p "$HOME/.config/piano"
ssh exe.dev ssh-key generate-api-key --vm=eng-1 --label=piano-laptop > "$HOME/.config/piano/eng-1.token"
chmod 600 "$HOME/.config/piano/eng-1.token"
```

The file must contain only the token (a final newline is fine). It must be an absolute-path,
regular, non-symlink file, at most 16 KiB. On macOS/Linux it must belong to the backend's user and
have no group/other permissions (`0600` or `0400`). Keep its directory private too.

Write a separate configuration file such as `$HOME/.config/piano/peer.json`, substituting your
actual **absolute** home path in `vmTokenFile` (JSON does not expand `$HOME` or `~`):

```json
{
  "id": "eng-1",
  "name": "eng-1",
  "endpoint": "https://eng-1.exe.xyz:3000",
  "origin": "https://eng-1.exe.xyz:3000",
  "vmTokenFile": "/Users/you/.config/piano/eng-1.token"
}
```

Use the remote Piano's actual private port and configured allowed Origin; `3000` above is the
scratch target, not production. Token authentication only accepts direct HTTPS VM hosts such as
`eng-1.exe.xyz`, not integration hosts, arbitrary domains or cleartext destinations. No integration
attachment or SSH tunnel is needed for this mode. The local backend supplies
`X-Exedev-Authorization: Bearer …` on HTTP requests and WebSocket upgrades; exe.dev consumes it
before forwarding to the remote. Browser-supplied authorization is never forwarded.

For a local PR checkout with dependencies installed:

```sh
PIANO_PEER_CONFIG="$HOME/.config/piano/peer.json" npm run dev
```

Open `http://localhost:5173` and choose **eng-1**. Both the UI and main backend run on your laptop;
only the selected session executes on eng-1. The same configuration works with the built UI and
`npm start`, at `http://127.0.0.1:7070` by default.

The token is read at startup and retained as a redacted server-only value. After replacing it,
restart your local backend explicitly. Expired/revoked credentials or authentication redirects
make the remote unavailable; Piano never retries without authentication or executes locally.
Revoke a generated token by removing its associated SSH key in exe.dev (keep the `piano-laptop`
label for identification). Stop the local backend when revoking so already-open sockets close.
Piano does not mint, refresh or revoke tokens, and the token does not sandbox local Pi processes
running as the same trusted user.

### Shared startup configuration

Start the main backend with `PIANO_PEER_CONFIG=/absolute/path/to/peer.json`, keeping its normal
`HOST=127.0.0.1` and `PIANO_ALLOWED_ORIGINS` configuration. This is startup configuration: changing
it requires an explicit restart. No remote is configured by default, and Local retains its
existing behavior. Do not point this scratch example at a production service for verification.

`id` is a stable lowercase slug, not `local`; it identifies routes and browser state. Keep it bound
to the same backend identity; use a different ID for another Piano rather than repointing it.
`name` is the picker label. `endpoint` is the integration's or target VM's HTTPS origin, without
path, credentials, query or fragment. HTTP loopback endpoints require `NODE_ENV=test` and exist
only for isolated tests with dummy credentials, never real tokens.
`origin` is the **target Piano's allowed Origin**, not the integration hostname or laptop origin.
Omit `vmTokenFile` for an exe.dev peer integration; the edge supplies authentication. Set it only
for direct VM access. A configured but unreadable/invalid token fails startup rather than silently
switching to tokenless access. Piano never changes integrations.

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
