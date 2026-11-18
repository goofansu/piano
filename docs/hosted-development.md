# Hosted deployment

Shared policy for Piano on private exe.dev VMs. This describes the repository's deployment layout,
not the observed state of any particular VM. Resolve the requested machine, installed checkout and
revision before acting; an old hostname or a development worktree is not a deployment target.

## Deployment routes

| Request | Procedure |
| --- | --- |
| Provision a new VM | User-invoked [deploy-exe-dev](../.agents/skills/deploy-exe-dev/SKILL.md), including its fresh-VM reference and completion checks. It does not update existing machines. |
| Update all tagged Piano VMs | User-invoked [sync-exe-dev](../.agents/skills/sync-exe-dev/SKILL.md). It freezes one SHA, builds locally without restarting local services, and gates remote restarts on idle RPC processes. |
| Update one existing VM | The authorized [existing-machine update](#deliberate-updates) below. Do not substitute fresh-VM provisioning or all-machine sync. |
| Check deployment health without changing it | The read-only [verify-piano doctor](../.agents/skills/verify-piano/SKILL.md#a-deployed-instance). |
| Verify application behavior | [Scratch verification](../AGENTS.md#scratch-instance), not the user's live database or sessions. |

## Supported layout

The templates under [`deploy/systemd/`](../deploy/systemd/) use `/home/exedev/piano`. Inspect
installed units before adapting paths. Enable the backend and proxy socket for reboot; the
socket activates the proxy service, so a disabled proxy service is not itself a failure.

The daily UI is built, not Vite: losing Vite's HMR connection can reload the page and discard
unsent input. Do not auto-watch the hosted backend; restarting it interrupts Pi children, and
persisted history does not automatically resume interrupted work. Use a separate scratch instance
for development. A proxy-only restart does not restart the backend or its Pi children.

## Deliberate updates

Coding, committing and pushing do not authorize deployment. An explicit single-machine deploy
request authorizes the build/install and prompt backend restart, even if it interrupts active Pi
work, including the deploying session. Do not wait for idle or ask again for that interruption.
The `sync-exe-dev` skill has a different, explicit idle-session gate; do not bypass it.

For an authorized update to an existing machine:

1. Confirm the requested target revision and installed checkout. Preserve unrelated changes,
   database, Pi history, credentials and access configuration. Use existing verification evidence;
   deploy-only work does not require rerunning the development suite.
2. Install changed dependencies and run `npm run build` in that checkout. If unit files changed,
   install only the intended templates with the configured origin, then daemon-reload.
3. Restart `piano.service` from an external terminal or independent systemd job, outside its
   process tree, so the restart and health checks survive the deploying session's termination.
   A frontend-only deployment still includes the requested backend restart. Do not restart the
   proxy unless its configuration changed.
4. Retain this run's deployed SHA and health output. Use a unique root-owned log under
   `/var/log/piano-deploy/` for root-owned jobs; root may be unable to write another user's `/tmp`
   file under `fs.protected_regular`. A queued restart or an old `DEPLOY OK` is not completion.
5. After startup, run `.agents/skills/verify-piano/scripts/doctor.sh --deployed` from the checkout
   on the target VM. Require exit 0 and confirm the checkout SHA equals the requested SHA. The
   doctor checks active units, listener ownership, serving health and coarse checkout/build/start
   ordering; it does not prove the build's exact contents or application/session behavior.

Report the target, SHA, actual outcome and evidence location, and ask the user to reload the
browser. A failed or unreachable check is a limitation or blocker, not a pass.

## Private access

Piano is a trusted single-user developer tool with no application authentication (INV-11).
Both listeners must stay on loopback, with exe.dev private authenticated access covering HTTP
and WebSockets. Missing built-in login is not alone evidence of a vulnerability; public exposure
or a requirement for untrusted users would change the accepted deployment model.

For provisioning or access-configuration changes, inspect `ssh exe.dev share show <vm> --json`:
require private access, port 8000 and no unintended shares. Inspect the actual listening addresses;
listener ownership alone does not establish loopback-only binding. Keep generated previews on
separate origins and do not change the primary proxy route for them.

From the deploying machine, outside the target VM, run
`.agents/skills/verify-piano/scripts/doctor.sh --deployed-auth <vm>` and retain its output. It
requires cookie-free HTTPS requests to `/` and `/api/folders` to redirect to exe.dev login. A
VM-local probe, an unreachable URL or HTTPS alone does not establish private external access.
This HTTP probe does not independently exercise authenticated browser or WebSocket access.

## Origin configuration

Before installing `piano.service`, replace its `PIANO_ALLOWED_ORIGINS` placeholder with the actual
browser-facing HTTPS origin, without a trailing slash, or override it in a systemd drop-in. The
placeholder intentionally fails application startup validation. Keep production origins separate
from local development and generated preview origins.

An Origin header is not a credential and does not replace exe.dev private access. Changing a
unit or origin and restarting is a deployment action, not development verification.

## Managed app previews

For session-launched apps, follow [managed previews](live-previews.md#hosts-and-configuration), including
`PIANO_PREVIEW_CONFIG` and the existing lingering systemd user manager. Preview setup and service
restarts require user authorization; local readiness does not prove authenticated browser access.
