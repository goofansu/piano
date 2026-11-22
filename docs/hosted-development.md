# Hosted deployment

Shared policy for Piano on private exe.dev VMs. This describes the repository's deployment layout,
not the observed state of any particular VM.

## Deployment route

Deploy with the user-invoked [deploy-exe-dev](../.agents/skills/deploy-exe-dev/SKILL.md) skill, run
on the VM being deployed. It covers both a fresh install and an update of an existing checkout to
latest `main`. Deployment never goes through `ssh` or `ssh exe.dev`: there is no remote
provisioning, fleet sync or remote health check. To verify application behavior, use
[scratch verification](../AGENTS.md#scratch-instance), not the user's live database or sessions.

## Supported layout

The templates under [`deploy/systemd/`](../deploy/systemd/) use `/home/exedev/piano`. Inspect
installed units before adapting paths. Enable the backend and proxy socket for reboot; the
socket activates the proxy service, so a disabled proxy service is not itself a failure.

The daily UI is built, not Vite: losing Vite's HMR connection can reload the page and discard
unsent input. Do not auto-watch the hosted backend; restarting it interrupts Pi children, and
persisted history does not automatically resume interrupted work. Use a separate scratch instance
for development. A proxy-only restart does not restart the backend or its Pi children.

## Deliberate updates

Coding, committing and pushing do not authorize deployment. An explicit deploy request authorizes
the build/install and prompt backend restart, even if it interrupts active Pi work, including the
deploying session. Do not wait for idle or ask again for that interruption. Preserve unrelated
local changes, the database, Pi history, credentials and access configuration: an update only
fast-forwards a clean checkout. Restart `piano.service` from an independent systemd job, outside
its control group, and run the completion check in that same job, logging to a root-owned file
under `/var/log/piano-deploy/`, so the restart and its health check survive the deploying session's
termination. Do not restart the proxy unless its configuration changed.

## Private access

Piano is a trusted single-user developer tool with no application authentication (INV-11).
Both listeners must stay on loopback, with exe.dev private authenticated access covering HTTP
and WebSockets. Missing built-in login is not alone evidence of a vulnerability; public exposure
or a requirement for untrusted users would change the accepted deployment model.

Private access is an exe.dev setting that the VM cannot read; an HTTPS probe answers from exe.dev's
proxy whether or not Piano is running, and its reply format has changed before. The user confirms
in exe.dev that the VM is private, shares port 8000, and has no user, link or team shares. Keep
generated previews on separate origins and do not change the primary proxy route for them.

## Origin configuration

Before installing `piano.service`, replace its `PIANO_ALLOWED_ORIGINS` placeholder with the actual
browser-facing HTTPS origin, without a trailing slash, or override it in a systemd drop-in. The
placeholder intentionally fails application startup validation. Keep production origins separate
from local development and generated preview origins.

An Origin header is not a credential and does not replace exe.dev private access. Changing a
unit or origin and restarting is a deployment action, not development verification.
