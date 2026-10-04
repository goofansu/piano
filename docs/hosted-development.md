# Hosted development on yejun-dev

The checkout at `/home/exedev/piano` serves the development UI at
`https://yejun-dev.exe.xyz/`:

| Service | Loopback listener | Behavior |
| --- | --- | --- |
| `piano-web.service` | `127.0.0.1:8000` | Vite watches frontend source and provides React Fast Refresh / CSS HMR. |
| `piano.service` | `127.0.0.1:8001` | Node runs `server/main.ts`; backend updates need a deliberate restart. |

Both services start on boot and recover from crashes. Vite proxies `/api` and
`/ws` to the backend. The normal local Vite workflow still defaults to port 7070;
`PIANO_DEV_BACKEND` overrides its proxy target. The hosted unit allows only this
VM hostname in addition to Vite's default localhost/IP hosts, not arbitrary hosts.
Vite's HMR WebSocket uses the browser's origin through the HTTPS proxy.

## Updates

- Edit `web/src` (including CSS): updates appear without a build or server restart.
  React Fast Refresh preserves compatible component state; some module changes
  require a full page reload.
- Edit backend code under `server`, or server-imported `shared` code: finish the
  active Pi turn, then run `sudo systemctl restart piano`.
- Shared code used by the frontend is also watched by Vite, but its backend half
  still needs the restart above.
- Dependency/lockfile updates: finish active work, stop both services, run
  `npm ci`, then start them again.
- Vite config edits normally restart Vite automatically. Changing the unit's
  environment or command requires reinstalling it, daemon-reload and restart.
- Changes to Vite `.env` files require a frontend restart.

**Do not auto-watch the backend while developing Piano inside Piano.** The
existing `npm run dev` uses `node --watch`: this restarts the server process, not
in-process hot reload. A backend restart terminates its live Pi children and
interrupts in-progress turns/tool commands. Persisted history remains available;
an interrupted execution does not automatically resume. Keep `npm start` for the
self-hosted backend and request restarts from a separate terminal or Shelley
after work has settled.

## Operations

```bash
sudo systemctl status piano piano-web
sudo journalctl -u piano -u piano-web -n 100 --no-pager
sudo systemctl restart piano          # backend updates, only after active work finishes
sudo systemctl restart piano-web      # frontend service configuration updates
```

Install or update the checked-in units:

```bash
sudo install -m 644 deploy/systemd/piano*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now piano piano-web
```

An already-running service needs an explicit restart to pick up unit changes.
The units intentionally use this VM's absolute checkout and Node paths; adapt
them for another machine.

## Private access (INV-11)

Piano has no application authentication and can execute commands as the owner.
Both listeners stay on loopback. The exe.dev proxy must remain **private** and
authenticate access to HTTP and WebSocket routes. Do not publish this control
plane or add public generated previews to its origin. Loopback alone does not
stop the exe.dev proxy from routing to a port.

The VM owner can inspect/fix proxy settings from their authenticated local SSH
setup:

```bash
ssh exe.dev share show yejun-dev --json
ssh exe.dev share set-private yejun-dev
ssh exe.dev share port yejun-dev 8000
```

This is private trusted-developer hosting, not a new authentication/isolation
implementation. It does not establish general remote-product compliance with
INV-11.

## Setup verification

On October 4, 2026: Node 24.21.0, locked Pi 1.0.0, Vite 8.3.1 and Worktrunk
0.80.0. The dependency lockfiles were preserved; this setup does not perform the
planned Pi runtime upgrade.

For the subsequent Pi 1.0.2 upgrade and reasoning-effort fix, see the
[same-day investigation](research/2026-10-04-pi-update-effort.md).

`npm test` (5 tests), `npm run typecheck`, `npm run build` and systemd unit
validation passed. An isolated registry and fake-Pi instance on ports 7171/7172
were observed through `agent-browser`: directory selection, prompt/reply,
WebSocket routing and CSS HMR passed; the same browser page survived CSS
addition/removal. On port 8000, the VM hostname was accepted and an unrelated
hostname returned 403. The real Pi catalog returned 47 models without a paid
prompt. Reflection confirmed that the default proxy port is 8000.

The external authenticated HTTPS journey could not be tested from this VM.
Existing baseline warnings remain: one high-severity transitive
`brace-expansion` audit finding, the production chunk-size warning, and a React
development-console warning about a rendered script tag. No dependency updates
or unrelated UI fixes were made to hide these. This is not a full Pi
compatibility or production-security test.

## Sources

- [Vite React plugin and Fast Refresh](https://vite.dev/plugins/)
- [Vite server options: host allowlist, proxies and HMR WebSockets](https://vite.dev/config/server-options)
- [Node 24 CLI: `--watch` restarts on changes](https://nodejs.org/docs/latest-v24.x/api/cli.html#--watch)
- [exe.dev HTTPS proxy and private access](https://exe.dev/docs/proxy.md)
