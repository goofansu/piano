# Managed live previews (Linux / private exe.dev)

Ask a Piano session **“Run this app so I can try it.”** Its bundled `piano_preview` tool starts
one app in that session's exact canonical directory. The agent chooses the command from the
repository's scripts/instructions, reports local readiness, and returns an ordinary preview link.
The app stays running until an explicit stop; closing the tab or stopping the agent does not stop it.
No service manifest, skill collection, framework or header control is required.

## Host configuration

Prerequisites: Linux unified cgroups, Python 3 standard library, systemd 255+ (`systemd-run`,
`systemctl`, `journalctl`), `loginctl`, and an already running **lingering user manager** for the
unprivileged Piano account. The helper refuses unsupported supervision rather than falling back to
`nohup`, shell backgrounding, or a process whose lifetime belongs to Pi.

Set `PIANO_PREVIEW_CONFIG` for Piano to an absolute path to a private JSON file, for example:

```json
{
  "origin": "https://yejun-dev.exe.xyz",
  "reservedPorts": [7171, 7172],
  "path": "/home/exedev/node/bin:/usr/local/bin:/usr/bin:/bin"
}
```

This is deployment configuration, **not request headers**. An optional `ports` array narrows the
allocation pool; otherwise it is 3000–9999. Ports 7070, 8000 and 8001 are always reserved. Add other
Piano/scratch listeners and any host-specific reservations. Do not change exe.dev's primary route
or sharing: its additional-port proxy uses `https://<vm>.exe.xyz:<port>/` and private authentication.
Local HTTP readiness does not establish authenticated external access.

By default all sessions of the account share `~/.local/state/piano/previews/` (private mode 0700).
`PIANO_PREVIEW_STATE` overrides it **only for isolated scratch verification**. Every production
Piano process for this account must use the same directory: changing/deleting it while services
exist discards the durable launch intents and defeats deduplication. Preserve it across upgrades.
Do not store it in a worktree or Pi's session directory. Stop previews before removing a worktree.
Installing configuration or enabling lingering is an administrator/deployment action, not something
the agent silently does. Source changes alone do not configure or restart a deployed Piano.

## Agent recipe and CLI

1. Inspect the repository instructions and scripts. Choose a foreground command with strict
   `127.0.0.1` binding and no silent port fallback. Use an absolute executable; arguments are an
   array, not a shell command. `{port}` in each argument is replaced with the selected port; `PORT`
   is also injected. A Vite example (substitute the installation's absolute paths):

   ```json
   {
     "action": "start",
     "command": ["/home/exedev/node/bin/node", "/path/to/node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "{port}", "--strictPort"],
     "env": {"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS": "yejun-dev.exe.xyz"},
     "readyPath": "/",
     "timeoutSeconds": 15
   }
   ```

   The tool supplies `workspace` from `ctx.cwd`; the model cannot substitute another workspace.
   CLI users pass the same JSON plus `workspace` on stdin to `python3 /path/to/piano/scripts/preview.py`.
   The CLI is also a recovery path when the conversation is gone. The executable gets only `PATH`,
   `PORT` and explicitly requested `env`. Add `HOME` only if the application needs it. Never forward
   Piano's environment or credentials. Explicit app environment values are stored privately, but
   omitted from observations; commands and app logs are not a secret-storage interface.
2. Check `ready`, `detail`, `state`, and bounded `logs`, not merely helper exit status. Startup waits
   1–30 seconds for an owned listener and a 2xx/3xx GET at `readyPath`, without following redirects.
   Missing executables, bind failures, wrong ports and readiness failures retain their exact identity
   and logs. A listener not owned by this unit never establishes readiness. No automatic retry on a
   different port: fix the command and deliberately replace the instance.
3. Report the canonical workspace, port, local observation and Markdown `url` when ready. Say that
   authenticated browser load is unverified until actually observed. Check dev-server hot reload
   independently: edit a page and watch it update **without manual reload**. Framework host checking,
   WebSocket proxying, authentication and application-specific HMR may require configuration.
4. After lost/aborted tool output, call `{"action":"status"}`. Repeated matching starts return the
   original instance, even if unhealthy; they never silently replace it. Changed argv, environment,
   readiness path, origin or PATH refuses reuse. Source edits intentionally do not replace a dev
   server; it owns watching them. A changed build/config file which needs restart requires explicit
   stop/start even if argv is unchanged.
5. On user-authorized cleanup call `{"action":"stop","instanceId":"<exact returned ID>"}`.
   CLI requests also include the workspace. A stale ID returns `not-current` and cannot stop a
   replacement. Never kill by PID or port. `stop` kills only the unit's cgroup (TERM then KILL after
   five seconds); it does not stop other previews or Piano.

A deadline/abort can interrupt observation or submission. Intent is written before submission, so
another start reconciles it instead of replaying it. If the unit never appeared, status remains
unready and stop may report “unit not loaded”; retain this evidence and ask the host operator to
reconcile the missing unit before removing that intent. Do not delete state to force a retry.

## Ownership decision (PIN-94)

The helper is a short-lived Python adapter because Linux `flock`, `/proc` socket ownership and
bounded subprocess calls are available in its standard library. It has no process daemon, database,
package dependency, model call, or competing transcript store. The TypeScript Pi extension supplies
session cwd and calls that adapter; the existing PiSessions protocol seam is unchanged.

On yejun-dev, the live `piano.service` runs as uid 1000 in `/system.slice/piano.service` with
`KillMode=control-group`. Its actual environment has no XDG runtime or D-Bus address. A read-only
inspection followed by a uniquely named scratch transient probe, using that environment, established
that `/run/user/1000/bus` reaches the existing lingering user manager. The probe ran as uid 1000 in
`/user.slice/user-1000.slice/user@1000.service/app.slice/piano-preview-pin94-probe.service`, outside
Piano's termination scope. No deployed process or route was changed. The helper explicitly supplies
that account's runtime bus; it does not require an interactive shell's environment.

- `serviceId`: stable hash of the canonical directory, reusable by slice 2.
- `instanceId`: random UUID for one launch intent; part of its unique systemd unit name, never reused.
- `invocation`: systemd's observed invocation ID. An unexpected replacement refuses adoption/stop.
- `workspace`, `spec`, `port`, `createdAt`: retained before submission, with an account-wide flock
  for allocation/start/reuse/stop. State replacement is atomic and fsynced. Abandoned intent holds its
  port until explicit reconciliation; it is safer to refuse than duplicate an uncertain launch.
- systemd owns execution: `Restart=no`, `KillMode=control-group`, no idle expiry or browser lifetime.
  `RemainAfterExit` retains normally exited units until explicit stop. Logs go to journald with rate
  limiting; observations return only the last 30 entries / 6000 characters.
- Allocation tests IPv4 and IPv6 before launch and excludes retained intent. The probe cannot reserve
  a port across exec for arbitrary frameworks. A concurrent external binder wins or loses normally;
  the loser is exposed as a failure. Readiness rechecks actual listener cgroup ownership around HTTP.
  Apps must obey the strict-port recipe; an app ignoring it can run elsewhere but is never reported
  ready at an unrelated responder.

These are trusted same-account processes, not a sandbox. Same-UID hostile code, deliberate manual
unit replacement, privileged interference, host reboot persistence, IPv6-only apps, non-HTTP
protocols and arbitrary multi-service stacks are outside this slice. Previews may read files allowed
by the account; a minimal environment is credential hygiene, not filesystem isolation. Account-wide
serialization favors safety over throughput (another operation can wait up to 65 seconds). The
helper itself has a 120-second client deadline. This preserves INV-01/02/07/11/12/13 without changing
Pi history, Git ownership, route sharing or skill discovery.
