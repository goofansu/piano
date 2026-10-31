# Managed live previews (macOS and Linux / private exe.dev)

Ask a Piano session **“Run this app so I can try it.”** Its bundled `piano_preview` tool starts
one app in that session's canonical workspace. The agent reads repository scripts/instructions,
reports local readiness and returns an ordinary preview link. **That live Pi process owns the app.**
No service manifest, skill collection or Stop session control is required.

While the selected live session owns an app, its **session rail** has an **App** section. The
**Preview** row shows a StatusDot and ready hostname, or its non-ready state. The row opens one
**Preview** Surface tab beside Changes and files; its separate external-link action opens only a
new browser tab. On narrow screens the same rail opens in a sheet, and selecting Preview dismisses
it. The header has no separate app control. A newly appearing app never opens anything or steals focus.

Preview is an app inspector, not an embedded browser. Its toolbar offers **Open in new tab** and
**More preview actions**: **Copy link**, **Details**, then destructive **Stop preview**. Details holds
the command, URL/access, observation time and bounded output; **Refresh** reads it again. Non-ready
states offer **Check status**. The palette distinguishes **Show preview**, **Open preview in new tab**,
**Preview details** and **Stop preview**. Embedding and Reload are separate work (PIN-96).

Piano reads status from the session's owner without starting Pi or an app: on attachment/reconnect,
return to the page, opening Preview/Details and explicit checks. Concurrent reads coalesce, focus
reads retain their ten-second throttle, and there is no polling. Requests carry echoed observation
IDs, and details are fenced to attachment, owner generation and instance. Disconnection or a failed
read is unknown, not stopped; no external action remains usable from an uncertain observation.
After a failed start the owner reads the workspace again, so the rail drops an app already stopped
and keeps one launched but not observable as unknown.

Stop asks for confirmation of the observed exact instance. A changed attachment, owner or instance
invalidates that confirmation; server-side exact-instance reconciliation remains authoritative.
Cancellation has no effect. Success removes the App row and answers once with a toast; an already-open
Preview tab shows **Preview stopped**, without the old link. Failed stop keeps inspection available
and reports the error. Closing a tab chooses its neighbour or returns to Agent and the enabled rail;
showing the rail preserves covered tabs. Browser memory deliberately does not restore Preview tabs
or disposable stopped state. A saved, closed or restarted session has no live row even if its
transcript links an old app. Archive and Delete ask before stopping a session that owns an app.

| Event | Outcome |
| --- | --- |
| Turn completes; composer Stop/abort | Preview continues; Stop interrupts generation only. |
| Browser disconnect, tab close, session switching | Preview continues. |
| Automatic idle retirement | Owning Pi is pinned while its preview is active or uncertain. |
| Explicit preview stop | App stops; Pi remains available and normal idle retirement resumes. |
| Archive/delete or explicit Pi release | Owned app stops before successful retention changes. Cleanup failure is an error, not success. |
| Pi exit/crash; Piano shutdown/crash | App and its supported child-process scope are cleaned up. |
| Reopen/restart | No automatic relaunch or adoption. A new explicit start has a new owner generation. |

This reverses PIN-94's independent lifetime; see [ADR 0003](adr/0003-pi-owned-preview-lifetime.md)
and the mandatory [legacy upgrade procedure](#upgrading-from-pin-94).

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

Set `PIANO_PREVIEW_CONFIG` for Piano to an absolute private JSON file, for example:

```json
{
  "origin": "https://<vm>.exe.xyz",
  "reservedPorts": [],
  "path": "/home/exedev/node/bin:/usr/local/bin:/usr/bin:/bin"
}
```

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

An optional `ports` array narrows the pool; otherwise it is 3000–9999. An explicit loopback origin
accepts configured ports 1024–65535. Ports 5173, 7070, 8000 and 8001 are always reserved;
`reservedPorts` excludes additional listeners. Allocation probes `127.0.0.1` and the IPv4/IPv6
wildcards separately (important on macOS). An external process can still win a bind race; the app
must use a strict port, and readiness checks actual owned listeners around HTTP.

All production Piano instances for the account share `~/.local/state/piano/previews/` (0700).
`PIANO_PREVIEW_STATE` is an isolated-scratch override. Preserve the directory across upgrades; never
place it in a worktree or Pi history, or delete intents to force a retry. The exclusive SQLite
transaction in `lock.sqlite` serializes allocation, launch, replacement and exact cleanup across
processes, and is released by the kernel on SIGKILL. Records are atomically replaced and fsynced.
This is execution intent, not another conversation store.

Records retain `serviceId` (canonical-workspace hash), random `instanceId` (unique unit/label),
`invocation` (systemd invocation ID or launchd run count), workspace, launch spec, port and timestamp.
New records also retain `owner`: session ID, random Pi generation, canonical workspace and that
process generation's private socket endpoint. Neither a saved session ID nor a reusable PID is an
owner. An unexpected supervisor invocation refuses adoption/stop. Retained identity permits cleanup
after checkout deletion, without `realpath` of the missing directory.

## Agent recipe and helper

1. Inspect the selected checkout's instructions, scripts and configuration, and identify its actual
   application development/start entry point before launching. An app package within this checkout's
   monorepo is supported; sibling checkouts, unrelated directories and temporary document directories
   are not. Fixed cwd alone does not establish that a command runs the checkout's application.
   This is not artifact publication or generic file hosting: never manufacture a listener for
   standalone generated HTML, reports or other files, including an inline custom server or a package
   script wrapping one. Use [file previews](file-previews.md) or artifact delivery instead; never
   fall back to a shell server. Python applications and repository-native frontend dev servers are
   supported—service purpose, not language, determines suitability.
   Choose a foreground command with strict `127.0.0.1`
   binding, not a daemon or detached process. `command` is argv, not shell syntax; the executable
   may be absolute or a bare name resolved on the app PATH. `{port}` is substituted and `PORT`
   injected. For example:

   ```json
   {
     "action": "start",
     "command": ["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "{port}", "--strictPort"],
     "env": {"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS": "<vm>.exe.xyz"},
     "readyPath": "/",
     "timeoutSeconds": 15
   }
   ```

   Omit the Vite host override on a Mac: localhost is already allowed. The session broker fixes
   workspace and generation from trusted PiSessions context, ignoring caller workspace/owner fields.
   The application gets only PATH, PORT and explicit `env`; add HOME only when required. Never pass
   Piano credentials. Environment values are saved privately and omitted/redacted in observations;
   commands and logs are not secret storage.
2. Check `ready`, `detail`, `state` and bounded `logs`, not just tool success. Startup waits 1–30s
   for an owned loopback listener and a 2xx/3xx GET at `readyPath`, with the preview hostname as Host
   and without redirects. Host rejection (often 403), bind/exec failure and wrong ports remain
   unready with identity/logs. States: starting, running, exited, failed, stopping, not-loaded.
   Supervisor details are diagnostic, not a second status model.
3. Report observed local readiness and Markdown `url`. On exe.dev, external authenticated access
   stays `unverified` until actually observed; on macOS the URL opens on the observed host
   (`same-host`). Test HMR separately by editing a page and watching without manual reload.
4. Lost/aborted output: read `status`, never blindly repeat a launch. `start` without command returns
   **this generation's** existing app, even if unhealthy. A changed request returns `specChanged`
   without restarting. Use `replace: "<exact instanceId>"` only for a user-requested change/restart
   or a failed/never-ready app. It stops that instance then launches the supplied command, or the
   same command if omitted. A stale ID returns `not-current`. Another live owner's app is an
   ownership conflict, not reuse or a transfer. Different workspaces remain independent.
5. User-authorized stop: `{"action":"stop","instanceId":"<exact returned ID>"}`. Never kill by
   PID or port. It confirms cleanup of the app's supported process scope and leaves Pi available.
   Source changes normally use HMR, not replacement. Completing a reply never stops a preview.

`node /path/to/piano/scripts/preview.ts` accepts the same JSON on stdin inside a hosted Pi
(`PIANO_PREVIEW_OWNER` is supplied only to that generation). Without that endpoint it can inspect
saved status or explicitly stop **legacy** instances, but cannot launch, adopt or stop another live
owner's app. Recovery status/legacy stop also take `workspace`: use the saved canonical path if the
checkout has disappeared. Do not copy an old endpoint into a new session.

Intent precedes supervisor submission. An interrupted observation never cancels admitted work.
Absent never-observed submissions retain a 120-second reconciliation grace, because submission may
still land; this is not an app expiry. Account-wide lock waits are bounded at 65s and the client
observation at 120s. A disconnected client leaves work owned by its Pi generation.

### Launch admission and trust limits

The existing adapter's launch-validation seam rejects identifiable unsupported launches before
supervisor submission and, for replacement, before stopping the current instance:

- Direct `http-server`, `serve`, `static-server`, `live-server` invocations, including recognized
  npx/npm-exec/pnpm-dlx/yarn-exec/bun-x and Node node_modules entry forms; Python's
  `http.server`, `SimpleHTTPServer` and `CGIHTTPServer` module forms.
- Explicit root arguments `--cwd`, `--prefix`, `--dir`, `--directory`, `--root`, `--app-dir`,
  `--app`, `--chdir`, `-C`, recognized Vite/Next/Astro positional roots, and direct Node/Python
  application-file arguments resolving outside the canonical checkout. Existing ancestors are
  resolved too, so outward symlinks and missing paths beneath them cannot bypass these checks.

An unsupported replacement leaves the existing instance running. Status, commandless reuse and
exact-instance stop remain available for already-owned apps, including launches that no longer pass
admission; restarting such a launch must pass today's checks.

These are bounded recognition rules, not semantic proof of arbitrary argv or an execution sandbox.
They do not inspect script bodies, certify entry-point provenance, or detect every wrapper/inline
server. Agent instructions govern application selection, including wrapped generic hosting. Fixture
tests prove enforced rules and lifecycle behavior, not arbitrary model compliance. No caller-selected
cwd/owner, language allowlist or generic manifest framework is introduced.

## Ownership and death cleanup

`PiSessions` creates the private generation socket and injects only its endpoint into its Pi child;
probes cannot inherit a parent's endpoint. `PreviewOwner` runs inside Piano, not a daemon. Requests
serialize against release; pending/start/stop/unknown observations guard idle retirement. Idle
retirement never waits on the account-wide lock: a busy lock or unusable state root answers not
idle, and the next sweep asks again. Idle reservation closes admission atomically when absence is
confirmed. Explicit release closes admission and live runner connections immediately, then cleans
the retained exact intent under the adapter lock. Failed cleanup retains the host/identity for
retry and refuses archive/delete. Piano shutdown still closes Pi's scope on cleanup failure and
logs the failure.

The supervisor runs `preview-runner.ts` as its main process. Before spawning the app it must obtain
and keep a connection to that generation's socket. No reconnect, PID polling, renewable lease or
expiry timer exists. Transport exit closes all these connections before waiting for any cleanup
lock; a Piano crash closes them in the kernel. A late submission against a dead endpoint cannot
spawn. A five-second **admission-only** timeout also refuses a stalled handshake, not a running app.

The runner preserves application exit codes (signals become nonzero exits on Linux) and atomically
records the first terminal cause before cleanup: app exit with code/signal, spawn error, explicit
stop or owner disconnect. This private outcome is fenced by instance and generation and removed
with the saved launch. Observations use it only after native termination: exit 0 is `exited`;
nonzero exit, signal or spawn error is `failed`. Stop/owner cleanup is not an application crash.
Linux supervisor cleanup failures remain failed. On macOS the outcome distinguishes the app's
result from the runner's deliberate group SIGKILL; without an outcome, native failure is retained.
The outcome also preserves a clean exit after systemd unloads its transient unit; it is not a
liveness signal or authority to stop another generation.

- **Linux:** runner exit triggers systemd's `KillMode=control-group`, TERM then KILL after
  `TimeoutStopSec=5s`. `Restart=no`; new jobs do **not** use `RemainAfterExit`. Listener ownership
  compares `/proc/net/tcp{,6}` socket inodes with processes in the exact unit cgroup. The helper
  supplies the user's runtime bus explicitly, independent of shell environment. Journald logs
  are rate-limited; observations return at most 30 lines / 6000 characters.
- **macOS:** the runner validates that launchd made it its own process-group leader. On owner loss,
  app exit or TERM it KILLs that group, including itself, without stale-PID signalling. Explicit
  `bootout` also has launchd's `ExitTimeOut=5`; cleanup waits up to 10s to confirm the group is gone.
  Retained group identity is only used for observation, never signalling, if bootout's reply is
  lost. `RunAtLoad`, `KeepAlive=false`; plists are outside `~/Library/LaunchAgents`, so login cannot
  reload them. `lsof`/`ps` establish listener ownership. Per-job logs read only their last 64 KiB.

With functioning kernel/supervisor scheduling, the death path is EOF/transport exit notification
plus at most the supervisor's five-second kill grace (macOS owner-loss group kill is immediate).
This is not a hard real-time guarantee against a frozen OS/supervisor or uninterruptible kernel I/O.
The native journey requires all app/child processes gone within 15s, before any reopen or restart.
[PR #228](https://github.com/goofansu/piano/pull/228) records measured Linux times and the native
macOS verification gap; simulated adapter contracts do not prove launchd kernel behavior.

No automatic relaunch occurs after restart/reopen. A subsequent **explicit** start may confirm a terminal old intent **and an absent/refused old owner endpoint** before clearing it and
launching anew; it never inherits that generation. A failed app still belongs to its live owner.
Unknown observation blocks this. Stale instance stops cannot stop replacements; old-generation
cleanup cannot stop a later generation.
Stop previews before intentional checkout removal; external removal does not prevent cleanup.
Piano currently has no physical worktree-removal action. Hiding a folder only hides registration;
it is not filesystem removal or owner termination. Future removal must coordinate/refuse live owners.

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
