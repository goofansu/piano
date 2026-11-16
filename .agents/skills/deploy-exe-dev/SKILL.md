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

Keep health output and deployed SHA in a temporary directory on the VM, created with `mktemp -d /tmp/piano-deploy-evidence.XXXXXX`. Retain it for inspection and report its path; it may disappear on reboot or temporary-file cleanup.

After startup, run the existing read-only checks from a Piano checkout, retaining stdout/stderr and exit status:

- **On the new VM:** `.agents/skills/verify-piano/scripts/doctor.sh --deployed` checks active units, listener ownership, backend API, built UI through port 8000, and coarse checkout/build/start ordering.
- **On the deploying machine, outside the new VM:** `.agents/skills/verify-piano/scripts/doctor.sh --deployed-auth <vm>` checks cookie-free HTTPS requests to `/` and `/api/folders` redirect to exe.dev login. Copy its output into the VM's evidence directory and record where it ran. A VM-local probe or unreachable external URL does not prove privacy.

Require both checks to exit 0; a failed or unavailable check is not completion. Also establish what these scripts do not assert:

- The installed checkout SHA matches the requested revision. The doctor's timestamps do not prove the build's exact contents.
- Backend and proxy listen only on loopback; PID ownership alone does not establish the bind address.
- The backend and socket are enabled for reboot. The proxy service may report `disabled`: establish that `piano-web.socket` triggers it rather than enabling the service separately.
- `ssh exe.dev share show <vm> --json` reports private access and port 8000, with no unintended shares.

Report the URL, VM, tag, SHA, evidence location and any limitations. Direct the user to **Settings → Providers** for sign-in and to add folders. Health checks establish deployment, not session behavior; use the checkout's scratch-browser policy only when that behavior needs testing. Leave model calls and credential transfer out of deploy-only work.
