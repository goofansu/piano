---
name: deploy-exe-dev
description: Provision a new private exe.dev VM with Piano installed and running on port 8000.
disable-model-invocation: true
---

# Deploy on exe.dev

Provision a new private exe.dev VM, install Piano, and leave it running. This invocation authorizes VM creation and starting Piano on that VM; it does not authorize changes to existing machines or copying credentials.

## Provision and run

1. Resolve the Piano checkout and read its `AGENTS.md` and `docs/hosted-development.md`. The checkout owns deployment policy and unit templates.
2. Follow [Fresh VM](references/fresh-vm.md): create a new VM tagged `goofansu-piano`, transfer the requested revision (current remote `main` by default), install dependencies, configure the browser origin, build, and start the systemd units.
3. Use the VM returned by creation throughout. Existing VMs with the same tag are not candidates: this skill provisions a new VM, rather than asking which existing VM to update.
4. Complete the live checks below. A created VM, successful build, or queued startup alone is not completion.

## Completion

Keep health output and deployed SHA in a temporary directory on the VM, created with `mktemp -d /tmp/piano-deploy-evidence.XXXXXX`. Retain it for inspection and report its path; it may disappear on reboot or temporary-file cleanup. Establish all of these:

- Backend API and built UI respond through the configured listeners, including port 8000.
- Backend and proxy listen only on loopback. `piano.service`, `piano-web.socket`, and `piano-web.service` are active; the backend and socket are enabled for reboot. The proxy service may report `disabled`: establish that `piano-web.socket` triggers it rather than enabling the service separately.
- `ssh exe.dev share show <vm> --json` reports private access and port 8000, with no unintended shares.
- Run a cookie-free `curl` of the HTTPS URL from the deploying machine, outside the VM, without following redirects. Keep the response headers and establish a redirect to exe.dev login rather than Piano. A VM-local probe may fail to reach its own public URL; the external probe is the access-boundary check. Copy its output into the VM's evidence directory and record where it ran. Treat an unreachable external URL as unverified, not as proof of privacy.

Report the URL, VM, tag, SHA, evidence location and any limitations. Direct the user to **Settings → Providers** for sign-in and to add folders. Health checks establish deployment, not session behavior; use the checkout's scratch-browser policy only when that behavior needs testing. Leave model calls and credential transfer out of deploy-only work.
