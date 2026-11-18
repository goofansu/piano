# Remote Pianos

## Setup

Keep every backend on loopback and remotes behind exe.dev private access. Main and remotes must
run the same Piano version: deploy them together.

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

Set the variable on `npm start` (or `npm run dev`), not just the build:

```sh
npm run build && PIANO_PEER_CONFIG="$HOME/.config/piano/peer.json" npm start
```

The token is read at startup: restart the local backend after replacing it. Revoke a token by
removing its SSH key in exe.dev, and stop the local backend so already-open sockets close.

### Multiple VMs

List them as `{ "peers": [...] }` in the same file. Create a separate VM-scoped token for each
VM, with a distinct key label and private file: an eng-1 token does not authorize eng-2.

`id` identifies routes and browser state: keep it bound to one backend, and use a different ID
for another Piano rather than repointing it. `endpoint` is the integration's or target VM's
HTTPS origin. `origin` is the target Piano's allowed Origin, not the integration hostname or
laptop origin; the machine list sends it to the browser, which links there for the peer's own
settings. Omit `vmTokenFile` for a peer integration; set it only for direct VM access.

## Machine shortcuts

In the installed macOS PWA (standalone display mode), Cmd+1 through Cmd+9 select machines in
picker order: Local first, then peers. Cmd+9 means the ninth item, not the last; Cmd+0 selects
the last item, even beyond nine or when it is offline. With only Local, Cmd+0 selects Local.
Missing items do nothing. Ordinary browser tabs retain their native number shortcuts, including
Cmd+0 zoom reset; Ctrl is not an alternative.

Switching uses the picker's remembered route and machine-specific drafts, including from either
composer. Dialogs, menus and other text-editing controls keep their keys. Extra modifiers, held-key
repeats and IME input do not switch machines. An unavailable peer never falls back to Local.

## Deliberate limits

See [ADR 0004](adr/0004-same-owner-piano-peer.md) for ownership and trust decisions.

## Developer navigation

Preserve `web → shared ← server`: the browser captures a machine owner, main relays to that
configured peer, and the peer owns its sessions and decides which operations it admits.
Unavailability never substitutes Local. [Session sharing](session-sharing.md) uploads on the
owning peer with its Radius provider credential; missing sign-in directs the user to that peer's
own Providers settings, never Local's.

Start at `server/PeerScope.ts` (admission), `server/PeerGateway.ts` (relay), `shared/machine.ts`
and `web/src/lib/machine.ts`. `web/src/components/MachineHost.tsx` owns picker and shortcut
navigation through `switchMachine`; `web/src/lib/keys.ts` recognizes eligible numeric chords
(`test/Keys.test.ts`).

### Verification

A default scratch launch has no peers, so the `verify-piano` recipes do not cover remotes; see
the map's
[coverage boundaries](../.agents/skills/verify-piano/features/README.md#coverage-boundaries).
Run `npm run test:browser:remote`, or `node test/browser/remote-session.mjs <evidence-directory>`
and `node test/browser/remote-inputs.mjs <evidence-directory>` separately; each owns main plus
two isolated peers. Follow [browser-test scope](testing.md#browser-tests) and the
[three-instance run-limit exception](../.agents/skills/verify-piano/SKILL.md#run-limits).
Fake Pi and fake voice devices do not establish authenticated exe.dev access, real Pi/provider
behavior or real-device recording. `remote-session.mjs` also checks numeric switching, history,
draft restoration (including Cmd+0 for the last machine) and shortcut guards with macOS platform
and standalone display mode emulated. Native macOS Chrome PWA shortcut delivery still needs a
manual check: Cmd+1 selects Local, Cmd+2 selects the first peer, Cmd+0 selects the last machine,
and normal Chrome tabs keep their tab-switching and Cmd+0 zoom-reset shortcuts.
