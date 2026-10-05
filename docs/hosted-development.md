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
HOST=127.0.0.1 PIANO_CONFIG=<scratch-path>/piano-config.json PORT=7171 node server/main.ts
PIANO_DEV_BACKEND=http://127.0.0.1:7171 npm run dev:web -- --host 127.0.0.1 --port 7172 --strictPort
npx agent-browser open http://127.0.0.1:7172
```

Use fake Pi for deterministic checks without credentials/model credits. Retain output
and stop only the scratch PIDs you started. Do not drive the systemd built UI or the
real registry with browser verification. Local development keeps Fast Refresh/CSS
HMR; its reconnect reload is a development-only behavior.

## Deliberate updates

Follow the user's [deploy preference](../AGENTS.md#running-against-the-users-instance): an explicit
deploy includes a prompt backend restart, with active-session interruption preapproved. Ordinary
development or pushing a commit still does not authorize deployment.

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
