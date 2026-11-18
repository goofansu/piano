# Remote Pianos

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

`id` is a stable lowercase slug, not `local`; it identifies routes and browser state. Keep it bound
to the same backend identity; use a different ID for another Piano rather than repointing it.
The browser remembers each machine's model list, last directory and open sidebar groups, and each
tab its open file tabs and the page it was on, under the machine's ID:
renaming an ID starts that machine fresh, and what was remembered for an ID removed from the
file is deleted the next time the page loads.
`name` is the picker label. `endpoint` is the integration's or target VM's HTTPS origin, without
path, credentials, query or fragment. HTTP loopback endpoints require `PIANO_TEST_HTTP_LOOPBACK_PEERS=1` and exist
only for isolated tests with dummy credentials, never real tokens.
`origin` is the **target Piano's allowed Origin**, not the integration hostname or laptop origin.
Omit `vmTokenFile` for an exe.dev peer integration; the edge supplies authentication. Set it only
for direct VM access. A configured but unreadable/invalid token fails startup rather than silently
switching to tokenless access. Piano never changes integrations.

## Deliberate limits

See [ADR 0004](adr/0004-same-owner-piano-peer.md) for ownership and trust decisions.

## Developer navigation

This is the starting place for peers / Remote Pianos. The feature spans the modules below, not a
single feature module. Preserve `web → shared ← server`: the browser captures a machine owner,
main relays to that configured peer, and the peer owns its sessions and decides which operations
it admits. Unavailability never substitutes Local. [ADR 0004](adr/0004-same-owner-piano-peer.md)
owns the trust and scope decisions; [browser storage](browser-storage.md) and
[runtime input limits](runtime-input-limits.md) own persistence policy and resource budgets.

Start at `server/PeerScope.ts` (admission), `server/PeerGateway.ts` (relay), `shared/machine.ts`
and `web/src/lib/machine.ts`.

Use the existing `verify-piano` entries for [Start a session](../.agents/skills/verify-piano/features/start-session.md),
[Open and continue](../.agents/skills/verify-piano/features/open-session.md),
[Projects index](../.agents/skills/verify-piano/features/projects-index.md),
[Project home](../.agents/skills/verify-piano/features/project-home.md) and
[Changes and files](../.agents/skills/verify-piano/features/changes-and-files.md).
Their configured-peer prerequisites are not coverage from a default scratch launch, which has no
peers; see the map's [coverage boundaries](../.agents/skills/verify-piano/features/README.md#coverage-boundaries).

The committed remote coverage is split between
[`remote-session.mjs`](../test/browser/remote-session.mjs) (machine navigation, sessions, projects,
trust, memory, Changes/files/rail, images and reviewed dictation with an image) and
[`remote-inputs.mjs`](../test/browser/remote-inputs.mjs) (settings routes and main-origin voice
preferences, cancellation and draft ownership). Each owns main plus two isolated peers with
colliding paths/session IDs. Run `node test/browser/<name>.mjs <evidence-directory>` separately
for explicit evidence paths, or `npm run test:browser:remote` to run both serially.
Follow [browser-test scope](testing.md#browser-tests) and the
[three-instance run-limit exception](../.agents/skills/verify-piano/SKILL.md#run-limits).
Fake Pi and fake voice devices/providers establish Piano's boundaries, not authenticated exe.dev
access, real Pi/provider behavior or real-device recording; those require separate evidence.
