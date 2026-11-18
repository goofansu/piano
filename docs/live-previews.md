# Managed live previews (macOS and Linux / private exe.dev)

[ADR 0003](adr/0003-pi-owned-preview-lifetime.md) records why the live Pi process owns the app.

## External app access

The normal user-activated link uses `target="_blank"` and `noopener noreferrer`. Piano does not
frame or proxy the app, forward credentials, or relax `PIANO_ALLOWED_ORIGINS`. Sign-in, popups,
downloads and app navigation follow ordinary browser-tab rules, without an additional Piano iframe
sandbox. Private exe.dev authentication and browser cookie rules still apply. If opening fails,
check **Preview details** for the app's output or ask the agent; neither path restarts the app.
Preview logs retain the last 6,000 characters without redacting environment values printed by the
app. Review them before sharing ([ADR 0005](adr/0005-faithful-display-content.md)).

Local HTTP readiness, actual browser access and HMR are separate checks. The native browser journey
uses an explicitly loopback-configured scratch origin to observe new-tab interaction without
bypassing exe.dev authentication. Authenticated HTTPS access, native macOS and real-device behavior
must be recorded separately. No production route, sharing or access configuration changes are
needed. Apps remain trusted same-account developer processes, not hostile-code sandboxes.

## Hosts and configuration

| | macOS | Linux (exe.dev) |
| --- | --- | --- |
| Executor | launchd job in `gui/<uid>` | transient unit of the lingering systemd user manager |
| Link | `http://localhost:<port>/` | `https://<vm>.exe.xyz:<port>/` |
| Prerequisites | Node 24, logged-in GUI user session, `launchctl`, `lsof`, `ps` | Node 24, unified cgroups, systemd 255+, `systemctl`, `journalctl`, `loginctl`, existing lingering user manager |
| Configuration | optional | `PIANO_PREVIEW_CONFIG` with the VM's origin |

The executor is not an independent lifetime owner. There is no fallback to shell backgrounding or
`nohup`. Unsupported supervision fails without affecting the rest of Piano. The tool is offered
only to live Piano session generations on macOS, or on Linux with `PIANO_PREVIEW_CONFIG` set.

`PIANO_PREVIEW_CONFIG` names an absolute private JSON file shaped like
`deploy/preview.example.json`.

The [systemd template](../deploy/systemd/piano.service) sets
`PIANO_PREVIEW_CONFIG=/home/exedev/.config/piano/preview.json`. For first-time setup only:

```bash
install -d -m 700 /home/exedev/.config/piano
install -m 600 deploy/preview.example.json /home/exedev/.config/piano/preview.json
```

Replace `<vm>` with the hostname and adapt `path`; do not overwrite existing configuration on upgrade.
The default app PATH is `/usr/local/bin:/usr/bin:/bin`; a Mac using Homebrew might need
`/opt/homebrew/bin` added. The macOS default origin is `http://localhost`. An explicit loopback
origin is also supported for isolated Linux verification. Never infer origins from request headers.

Installing configuration, enabling lingering and restarting Piano require explicit administrator /
[deployment authorization](hosted-development.md#deliberate-updates). Do not change exe.dev routes,
sharing or production `PIANO_ALLOWED_ORIGINS`. The additional-port proxy preserves private access;
local HTTP readiness does not prove authenticated external access.

## Ports and state

Port pools and reservations are in `scripts/PreviewAdapter.ts`. All production Piano instances
for the account share `~/.local/state/piano/previews/` (0700); `PIANO_PREVIEW_STATE` is an
isolated-scratch override. Preserve the directory across upgrades; never place it in a worktree
or Pi history, or delete intents to force a retry.

## Ownership and death cleanup

The mechanism is in `scripts/PreviewOwner.ts`, `scripts/preview-runner.ts` and
`scripts/PreviewAdapter.ts`. Simulated adapter contracts do not prove launchd kernel behavior:
[PR #228](https://github.com/goofansu/piano/pull/228) records the native macOS verification gap.
Stop previews before intentional checkout removal.

## Upgrading from PIN-94

Legacy independently managed apps lack an owner generation. **Stop them before upgrading or
restarting the old deployment.** Upgrading does not automatically attribute, adopt or terminate them.
Do not run mixed helper versions against one state root.

1. With the old deployment/helper and unchanged config/state, ask each owning conversation to stop
   its preview, or inspect each saved workspace using the helper's `status` action.
2. Explicitly stop each exact returned `instanceId`, using JSON stdin with `action`, `workspace`
   and `instanceId`. Confirm `stopped`/`cleared`; failures must be resolved before upgrade.
3. Preserve configuration/state, then perform a separately authorized deployment. New explicit
   tool starts bind to new live Pi generations. No app is automatically relaunched.

If already upgraded, the new standalone helper still supports legacy status/exact stop without
`PIANO_PREVIEW_OWNER`. New session starts encountering a legacy record return an explanatory error,
even when its unit looks exited. Use that explicit recovery path; do not delete state or manually
replace units. Existing legacy apps retain their old independent lifetime until you stop them.
Legacy detection and recovery are covered by both supervisor-adapter contracts.

## Limits

Trusted same-account developer processes, not a sandbox. On macOS a child deliberately calling
`setsid` escapes the process group; commands must stay foreground/non-daemonizing. Linux cgroups
include ordinary detached descendants, but privileged/same-account hostile interference is outside
the contract. Unprivileged `lsof` cannot inspect other users' listeners. Minimal environment does
not prevent filesystem access. Arbitrary multi-service orchestration, public routing, non-HTTP or
IPv6-only apps, logout/reboot persistence and automatic restart are out of scope. New previews do
not need orphan-management UI. No Pi history, Git policy, skill requirement or route sharing changes.
