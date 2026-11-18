# What an app must provide for a Piano preview

Source inspection: 2026-10-22, revision `2b0ab6e1abc2bc9be499e85449e36235d807aff2`,
Linux/exe.dev checkout. This note distinguishes the implemented contract from app-side
recommendations; no app was launched and no external access was verified.

PIN-99 update: the app-facing foreground/port/environment contract below remains valid. Reuse is
now restricted to the same live Pi generation; competing sessions get an ownership conflict.
[ADR 0003](../adr/0003-pi-owned-preview-lifetime.md) supersedes independent supervisor lifetime.

## Answer

**Provide one foreground launch command and one browser-facing HTTP endpoint, not necessarily
one OS process.** Piano currently manages one app launch per canonical workspace directory.
The launch has one allocated port, one readiness path, and one preview URL. A second `start`
reuses the current instance rather than adding another service. Different workspaces can have
separate previews. [S1, S2, S3]

A service can contain child processes: Linux listener ownership checks processes throughout the
unit's cgroup; macOS checks the launchd job's process group. Linux stop uses
`KillMode=control-group`; macOS waits for the process group to disappear. Thus the implementation
does not require the HTTP server to be the launcher's own PID. This is not general stack
orchestration: the documentation explicitly excludes arbitrary multi-service stacks. [S2, S3]

## App-facing contract

| Provide | Why / current behavior |
| --- | --- |
| A documented foreground command, runnable from the workspace root | The agent chooses argv from repository instructions/scripts. No Piano-specific manifest or SDK is required. Arguments are not interpreted by a shell. [S1, S2] |
| Configurable port | Piano injects `PORT` and substitutes `{port}` in command arguments. Do not override `PORT` in the tool's `env`. Bind exactly that port; fail rather than silently choosing another. [S2, S3] |
| HTTP on `127.0.0.1` | The helper probes IPv4 loopback and requires an owned listener. Wildcard binding does not satisfy ownership checks; HTTPS termination on exe.dev is outside the app. [S2, S3] |
| A readiness GET path | `readyPath` defaults to `/`; an owned listener returning 200–399 passes. Redirects are not followed. Start observes for 1–30 seconds (15 by default); timeout does not itself stop the app. [S2, S3] |
| Acceptance of the preview hostname | Readiness uses the browser-facing Host, including port. On exe.dev, configure framework host checks for the VM hostname, not only localhost. [S1, S2, S3, S4] |
| Explicit environment requirements | The app receives only `PATH`, `PORT`, and requested environment values. Shell profile variables and `HOME` are not automatically inherited. Avoid forwarding Piano credentials. [S2, S3] |
| A lifecycle that stays in the supervisor's ownership | Keep the launcher alive, do not daemonize or escape into independent services. In particular, macOS `setsid` can escape the process group and its cleanup. [S2, S3] |

For a useful development preview, also document dependency installation, any build/setup step,
and HMR configuration. HMR and authenticated external browser access require separate checks;
a successful readiness GET proves neither. These setup instructions are app documentation, not
an additional Piano manifest. [S2; recommendation]

## Frontend + backend: recommended shape

```text
Piano-managed service/job
└── foreground dev launcher
    ├── frontend/gateway: 127.0.0.1:$PORT
    │   ├── UI and assets
    │   └── /api (and application WebSockets) → backend
    └── backend: private loopback port or Unix socket
```

This is an app-side composition recommendation, not a separately implemented Piano stack feature:

- Expose one browser origin. Use relative `/api` URLs; a remote user's browser cannot reach the
  VM's backend through a hard-coded `http://localhost:<backend-port>` URL.
- Have the launcher manage startup order, child failures, signal handling and cleanup. A dead
  backend should not leave a healthy-looking frontend forever; use an aggregate readiness path
  if the preview requires both.
- Keep the launcher alive until its children finish. Do not start two detached commands and exit.
- Allocate internal ports without collisions across workspaces. Piano allocates/reserves only
  the single preview port; it does not allocate a backend port or manage dependency graphs. [S3]
- Install dependencies/build before launch where practical, so the short readiness window tests
  serving rather than installation. A slow start can be re-observed with `status`. [S2, S3]

A genuinely single-server app is simpler, but rewriting a frontend/backend app into one process
is unnecessary. Conversely, wrapping Docker Compose or separately managed databases in one command
does not establish that their listeners or lifetimes belong to Piano's service. Such stacks need
separate ownership and cleanup design; they are outside the documented support scope. [S2, S3]

## Suggested repository instruction

> Install dependencies with the documented setup command. Start the preview with our foreground
> dev command. It reads `PORT`, binds to `127.0.0.1`, and fails on port conflicts. It exposes the UI
> and API through that port, with readiness at `/healthz`. Required environment variables and
> preview-host/HMR settings are listed below. The launcher owns and cleans up all child processes.

This is a suggested contract to implement and document, not a claim that every existing app
already provides it. `/healthz` is optional; `/` is sufficient if it reflects the required readiness.

## Sources and verification limits

- **S1:** [Bundled preview tool](../../extensions/piano-sessions/Preview.ts): parameters,
  workspace binding, prompt guidance and one-app description.
- **S2:** [Managed live previews](../live-previews.md): agent recipe, supervisor ownership,
  platform differences, lifecycle and explicit scope exclusions.
- **S3:** [Preview adapter](../../scripts/PreviewAdapter.ts): `launchSpec`, `appArgv`, supervisor
  `ownsListener`/`stop`, `observe`, `handle`, and `choosePort`.
- **S4:** [Preview contract tests](../../test/Preview.test.ts): reuse/replacement, host-header
  readiness and rejection of unrelated listeners. Tests were inspected, not executed for this note.

Document/source review only. No source/dependency change, runtime test, deployment, service change,
or browser observation was performed. No web search was needed: current local implementation and
its first-party contract documentation directly answer the question.
