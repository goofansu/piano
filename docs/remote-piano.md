# Remote Pianos

The machine picker connects this browser to **Local** or one of the configured Pianos owned by the
same user. It is a conversation surface, not machine management. The remote's registered sessions
appear even when another browser or an agent started them. Terminal Pi history that the remote
Piano has not registered is not discovered.

## Setup

The main Piano can run on your laptop or on an exe.dev VM. All backends stay bound to loopback;
remotes stay behind exe.dev private access. Choose either authentication mode below for each peer.
Every remote must run the same Piano version as the main one: the main Piano attaches at the
remote's `/ws/peer`, where the remote itself decides what another machine may ask. Deploy main and
remotes together.

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

For a local PR checkout with dependencies installed, use your normal built-UI workflow:

```sh
npm run build && PIANO_PEER_CONFIG="$HOME/.config/piano/peer.json" npm start
```

Open `http://127.0.0.1:7070` and choose **eng-1**. Both the UI and main backend run on your laptop;
only the selected session executes on eng-1. Set the environment variable on `npm start`, not just
the build. For hot-reload development, the same variable with `npm run dev` serves the UI on
`http://localhost:5173`. Do not run two local backends against the same database.

The token is read at startup and retained as a redacted server-only value. After replacing it,
restart your local backend explicitly. Expired/revoked credentials or authentication redirects
make the remote unavailable; Piano never retries without authentication or executes locally.
Revoke a generated token by removing its associated SSH key in exe.dev (keep the `piano-laptop`
label for identification). Stop the local backend when revoking so already-open sockets close.
Piano does not mint, refresh or revoke tokens, and the token does not sandbox local Pi processes
running as the same trusted user.

### Multiple VMs: `peers.json`

Use the same `PIANO_PEER_CONFIG` variable with a file containing a `peers` list. The existing
single-object `peer.json` format above remains supported. The filename itself has no special meaning.

```json
{
  "peers": [
    {
      "id": "eng-1",
      "name": "eng-1",
      "endpoint": "https://eng-1.exe.xyz",
      "origin": "https://eng-1.exe.xyz",
      "vmTokenFile": "/Users/you/.config/piano/eng-1.token"
    },
    {
      "id": "eng-2",
      "name": "eng-2",
      "endpoint": "https://eng-2.exe.xyz",
      "origin": "https://eng-2.exe.xyz",
      "vmTokenFile": "/Users/you/.config/piano/eng-2.token"
    }
  ]
}
```

Create a **separate VM-scoped token for each VM** using the preceding laptop steps, with distinct
key labels and private files. For example, use `--vm=eng-2 --label=piano-laptop-eng-2 --exp=30d`
for the second token. An eng-1 token does not authorize eng-2. MCP OAuth credentials are not a
substitute for VM-scoped HTTPS tokens.

```sh
npm run build && PIANO_PEER_CONFIG="$HOME/.config/piano/peers.json" npm start
```

The switcher shows **Local**, then the peers in file order. IDs must be unique; display names must
also be unique, ignoring case. `local`/`Local` are reserved. The file is bounded to 16 KiB and at
most 32 peers. `{ "peers": [] }` or an unset variable means Local only. Unknown fields, duplicates
or any invalid entry/token file refuse the entire startup, never a partial or tokenless configuration.
An offline remote does not prevent startup or use of another peer.

A request or socket stays bound to its chosen peer's endpoint, Origin and credential. A slow reply
or unavailable peer cannot redirect input to another peer or Local. Drafts/catalogs and session
addresses remain machine-owned even when different backends use identical paths and session IDs.
You may mix token-backed direct VM entries and tokenless peer-integration entries in one list;
only use integrations attached to the VM running the main backend.

### Shared startup configuration

Start the main backend with `PIANO_PEER_CONFIG=/absolute/path/to/peers.json`, keeping its normal
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
model/effort, context, queue, dialog and Stop controls apply to that remote session. In the model
picker, **Use default** and **Make default** read and save the remote's own defaults for new
sessions there; Local's defaults are unchanged. Cmd+K searches
only the selected machine and offers a **Switch to …** command for each configured machine. A remote session's
address is `/m/eng-1/s/<sessionId>`; reload and back/forward retain that machine.

**New session** (or **New session here** in Cmd+K) starts a session on the selected machine. Its
directory picker lists only the folders that machine has registered, and the first message is text.
The session runs and stays on the remote. A worktree for parallel work comes from the remote
session's own dispatch, which runs on the remote, not from this picker.

A switch disconnects this browser's attachment, not the run. Returning or reconnecting reads a
fresh authoritative snapshot; it never resends input. Check the conversation before retrying any
input whose delivery is uncertain. Disconnection makes the remote unavailable, never Local.

Unsent drafts and question replies are isolated by machine and retained only for this page load.
Reload discards drafts as in Local. Remote model catalogs are memory-only and cannot populate
Local's persisted catalog. Remote files, credentials, history and database remain remote.

## Deliberate limits

- A new remote session starts only in a folder or worktree the remote has registered, with a text
  first message: no Browse, worktree creation, project, name or attachment. No archive/delete/
  rename/pin, projects management, worktree or machine management. Add folders and manage those on
  the owning Piano.
- No remote file/Changes/attachment/preview or account/settings controls beyond the model picker's
  defaults, folder trust included:
  trusting a folder would run its project extensions on the remote. These requests are not
  forwarded to Local. Remote transcript attachments/local-file actions are unavailable.
- The remote enforces these limits on its `/ws/peer` connection and answers a refused request the
  way it answers any failed one (for example "Unable to open session"); the connection stays open.
- Only configured peers, the remote's `/ws/peer`, its slash-command reads and its defaults save are
  routed. There is
  no arbitrary URL proxy, redirect following, mutation retry or cross-machine search. The browser never contacts the
  integration hostname.
- The configured destination is trusted, not an authenticated instance-ID handshake. A remote
  without `/ws/peer` fails closed as unavailable; there is no version negotiation. Deploy main and
  remotes from the same revision and verify the actual pair. Fake-Pi evidence does not certify a real
  Pi runtime or authenticated external-browser access.

See [ADR 0004](adr/0004-same-owner-piano-peer.md) for ownership and trust decisions.
