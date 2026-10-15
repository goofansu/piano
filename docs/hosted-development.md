# Hosted Piano on yejun-dev

The checkout at `/home/exedev/piano` serves the built UI at
`https://yejun-dev.exe.xyz/`:

| Unit | Loopback listener | Behavior |
| --- | --- | --- |
| `piano-web.socket` / `piano-web.service` | `127.0.0.1:8000` | systemd socket proxy forwards HTTP and WebSocket traffic to the existing backend. |
| `piano.service` | `127.0.0.1:8001` | Node runs `server/main.ts`, serving `web/dist`, API routes and sessions; backend updates need a deliberate restart. |

The frontend proxy does not start another Piano backend or own Pi children. Restarting
it may reconnect browser sockets but does not stop active Pi work (INV-02). Both
listeners remain on loopback behind private authenticated access (INV-11).

## Why the daily UI is built

Vite's development client treats a lost HMR connection as a possible server restart.
After connectivity returns it reloads the document, including when a mobile browser
was backgrounded, discarding unsent input. The built UI contains no Vite client or HMR
socket. Piano's own session connection still reconnects and re-selects the session.
This removes the development-client reload, not OS-level tab eviction under memory
pressure. It does not claim draft restoration after a genuine document reload.

## Develop and verify separately

For browser verification, start a scratch backend with a separate registry/repository
and a separate Vite development process as described in root AGENTS.md and
[the development handoff](development-on-exe-dev.md#scratch-verification):

```bash
HOST=127.0.0.1 PIANO_ALLOWED_ORIGINS=http://127.0.0.1:7172,http://localhost:7172 PIANO_DB_PATH=<scratch-path>/piano.db PORT=7171 node server/main.ts
PIANO_DEV_BACKEND=http://127.0.0.1:7171 npm run dev:web -- --host 127.0.0.1 --port 7172 --strictPort
npx agent-browser open http://127.0.0.1:7172
```

Use fake Pi for deterministic checks without credentials/model credits. Retain output
and stop only the scratch PIDs you started. Do not drive the systemd built UI or the
real registry with browser verification. Local development keeps Fast Refresh/CSS
HMR; its reconnect reload is a development-only behavior.

## Deliberate updates

**Deploy preference:** when explicitly asked to deploy, complete the build/install steps and restart
`piano.service` promptly, even if it cuts off the deploying session and other active Pi work.
Interruption is preapproved: do not wait for idle or request extra confirmation. Run the restart
and health checks outside `piano.service`'s process tree so deployment survives the cutoff. Ordinary
development or pushing a commit still does not authorize deployment. (The `sync-piano` skill
deliberately overrides this with its own idle-session gate.)

### Shortest deploy path

When the changes are already verified and dependencies installed:

```bash
cd /home/exedev/piano
npm run build && sudo install -d -m 0700 /var/log/piano-deploy && sudo systemd-run --collect /bin/bash -c '
  exec > /var/log/piano-deploy/manual.log 2>&1
  systemctl restart piano.service &&
  curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:8001/api/folders -o /dev/null &&
  curl -fsS http://127.0.0.1:8000/ -o /dev/null && echo "DEPLOY OK"
'
```

Confirm `DEPLOY OK` with `sudo cat /var/log/piano-deploy/manual.log`, then reload the browser. No proxy
restart needed. The log lives in a root-owned directory because the job runs as root and the hosts
set `fs.protected_regular`, which stops root from writing a file another user created in `/tmp`.
Keep deploy-only requests to this path; no new documents or repeat verification suite required.
The cases below cover changes that need more than this path.

- Frontend changes: verify in the separate development process, then run
  `npm run build` when deploying. Include the requested backend restart even for a frontend-only
  deployment; browsers pick up the new release on their next deliberate reload.
- Backend or server-imported shared changes: restart `piano.service` after the build/install steps.
  Use an external terminal or an independent systemd job outside its process tree, so the restart
  and health checks survive termination of live Pi children, including the deploying session.
  Execute promptly rather than waiting for idle sessions or the assistant's final reply. Retain
  check output and report deployment as verified only after the health checks actually pass.
- Dependency updates: perform installation and the service restart through the same external
  deployment process; active Pi work need not finish first.
- Unit changes: install the changed units, daemon-reload, and restart only the affected
  service. The socket owns port 8000, so a proxy-service restart retains the listener.

**Do not auto-watch the hosted backend.** `npm run dev` uses `node --watch`, which
restarts the process rather than hot-reloading it. An interrupted Pi execution does
not automatically resume just because persisted history is still available.

## Install / switch from the old Vite service

Build first. Stop only the old frontend listener before activating the new socket;
leave `piano.service` running so active Pi work survives:

```bash
npm run build
sudo install -m 644 deploy/systemd/piano-web.service deploy/systemd/piano-web.socket /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl stop piano-web.service
sudo systemctl enable --now piano-web.socket
sudo systemctl start piano-web.service
```

The existing backend unit remains enabled. On a fresh machine, install and enable
`deploy/systemd/piano.service` first. Units use this VM's paths; adapt them elsewhere.

```bash
sudo systemctl status piano piano-web.service piano-web.socket
sudo journalctl -u piano -u piano-web -n 100 --no-pager
sudo systemctl restart piano-web.service  # proxy only; no Pi child restart
sudo systemctl restart piano.service      # explicit deploy: cuts off active Pi sessions
```

## Private access

### Supported use case and review baseline

Piano is a trusted single-user developer tool, used either locally on loopback or behind
exe.dev private authenticated access. The owner confirmed this intended use on 2026-10-11.
Public unauthenticated hosting, untrusted users and multi-user authorization are out of scope.
This is the existing ADR 0001 decision 8 / INV-11 model, not a new authentication design.

For future agent reviews:

- Missing built-in application authentication is an accepted property of this deployment model,
  not by itself a new vulnerability or a reason to propose a multi-user authentication system.
- Keep the backend and TCP forwarder on loopback. Private proxy access must cover HTTP and
  WebSockets, with no unauthenticated alternate route to the backend.
- Distinguish the owner's stated use case from independently observed deployment configuration.
  An inability to inspect exe.dev sharing settings is a verification limitation, not evidence of
  exposure. Reuse PIN-5 for that outstanding verification rather than opening duplicate findings.
- Browser-origin protection is a separate defense: private authentication does not establish
  that a request originated from Piano. PIN-12 tracks that work; this accepted use case does not
  waive origin validation or establish that it is already implemented.
- Reopen the access-boundary question when there is concrete evidence of public access, changed
  sharing/listener configuration, or a requirement to support untrusted users—not merely because
  the application has no login screen. Do not suppress genuinely new exposure evidence.

The source and listener inspection for PIN-5 at `4ceeee79727768a2b511ff778aaed5168dd8b04c`
on 2026-10-11 found loopback listeners on ports 8000/8001 and a TCP forwarder to 8001.
Authoritative sharing inspection failed SSH authentication; a cookie-free HTTPS probe could not
connect. Neither result proves external access is denied. The actual external HTTP/WebSocket
access boundary remains unverified by that inspection; no exploit or exposure was demonstrated.

### Access requirements

Piano has no application authentication and can execute commands as the owner. The
TCP proxy adds no authentication or Host/origin allowlist; private authenticated
exe.dev access must protect both HTTP and WebSocket routes. Unlike the old Vite
listener, it does not enforce Vite's development Host allowlist. Keep both listeners
on loopback; do not publish this control plane or share a generated preview origin.

The owner can inspect/configure access through authenticated SSH:

```bash
ssh exe.dev share show yejun-dev --json
ssh exe.dev share set-private yejun-dev
ssh exe.dev share port yejun-dev 8000
```

This is trusted-developer hosting, not general remote-product security compliance.
The proxy port remains 8000; the public URL does not change.

## Origin configuration

`PIANO_ALLOWED_ORIGINS` names the browser-facing origins explicitly. The production unit contains
`https://<your-piano-domain>`: replace this placeholder with your actual HTTPS origin before
installing it, without a trailing slash. The placeholder intentionally fails application startup
validation until replaced. The production allowlist includes no local origins; the backend still
binds to loopback for the private proxy connection. Local development defaults and scratch origin
configuration are separate from this unit.

Origins are not inferred from Host or forwarded headers: neither Piano nor the TCP forwarder uses proxy identity headers
as authorization. exe.dev remains responsible for private HTTP/WebSocket access (PIN-5); browser
origin checks are a separate control (PIN-12, INV-11).

When deliberately deploying this change, install the configured `piano.service` unit (or configure
the equivalent environment in a drop-in), daemon-reload, and restart under the authorized deployment
workflow. Merely updating the code without the origin setting will reject the hosted browser's
mutations and WebSocket connection. Installing a unit is a deployment step, not part of development
verification. Adapt the exact HTTPS origin on other machines; do not add preview origins.

Missing and `null` origins are rejected on `/ws` and non-GET/HEAD/OPTIONS requests, even for local
scripts. Scripts can send an allowed Origin explicitly; that header is not a credential. Ordinary
read-only health checks need no Origin. Invalid/empty origin configuration fails startup.

## Built-UI switch verification — 2026-10-04

Seven module tests, typecheck, build and systemd unit validation passed. Browser
verification used `npx agent-browser` against a separate scratch Vite process on
7172, with fake Pi / scratch registry on 7171: eight viewport sizes, picker bounds,
Send/Queue/Stop, keyboard behavior, and an in-place session reconnect preserving
the mobile draft/selection without replaying a prompt. A separate socket-activation
process verified built HTML/assets, SPA routes with HTML navigation headers, and a
fake-Pi WebSocket reply. The initial SPA HTTP probe used a non-navigation Accept
header and correctly received 404; the HTML-navigation probe passed.

After switching the frontend service, port 8000 returned built HTML without the
Vite client; both listeners remained on loopback and the backend PID was unchanged.
No browser verification drove the hosted instance. Evidence is retained under
`/tmp/piano-built-ui-evidence/`; the prior Vite reload reproduction is under
`/tmp/piano-background-evidence/`. Actual phone background/foreground and the
external authenticated HTTPS path were not observed in this deployment check.

## Historical verification

The original October 4, 2026 Vite setup used Node 24.21.0, locked Pi 1.0.0, Vite
8.3.1 and Worktrunk 0.80.0. Scratch checks on ports 7171/7172 established directory
selection, prompt/reply, WebSocket routing and CSS HMR. That evidence describes the
old development listener, not the built-UI deployment. The subsequent Pi upgrade
is documented in [the Pi 1.0.2 investigation](research/2026-10-04-pi-update-effort.md).

## Sources

- [systemd socket proxy and dependency examples](https://freedesktop.org/software/systemd/man/systemd-socket-proxyd.html)
- Installed Vite `dist/client/client.mjs`: `vite:ws:disconnect` polls for connectivity,
  then calls `location.reload()`; the production build omits this client.
- [exe.dev HTTPS proxy and private access](https://exe.dev/docs/proxy.md)
