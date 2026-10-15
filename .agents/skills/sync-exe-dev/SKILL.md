---
name: sync-exe-dev
description: Sync Piano to latest main locally and on every exe.dev VM tagged goofansu-piano, then restart the remote services. exe.dev only. Use when asked to update, sync or deploy all Piano machines.
disable-model-invocation: true
---

# Sync exe.dev

This invocation authorizes dependency installation, builds, and remote service restarts. Local services stay running. Follow the repository's [hosted workflow](../../../docs/hosted-development.md) for deployment policy and health checks; load the available `using-exe-dev` skill for SSH guidance.

## 1. Freeze the target and discover machines

From the local Piano repository, fetch `origin main` and resolve `origin/main` to a full commit SHA. Use that same SHA for every checkout in this run.

Run `ssh exe.dev ls --json`. Select every VM whose `tags` array contains exactly `goofansu-piano`; use its returned `ssh_dest`. Report the selected machines. An empty selection means local-only work, and must be reported.

## 2. Sync and build each checkout

Run [scripts/deploy.sh](scripts/deploy.sh) with the frozen SHA. From the local repository root:

```bash
script=.agents/skills/sync-exe-dev/scripts/deploy.sh
bash "$script" local "$target"
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$ssh_dest" \
  "bash -s -- remote '$target'" < "$script"
```

Retain each command's stdout/stderr in a separate local log. Independent machines may run in parallel. The script requires a clean checkout on `main`, fast-forwards to the target, checks the resulting revision, and runs `npm ci` and `npm run build`. Remote mode uses `/home/exedev/piano`, the hosted PATH and exe.dev's HTTPS GitHub integration, leaving `origin` unchanged. Local mode derives the repository root from the script location; `--help` documents an optional local root override.

A failed command is blocked, not ready. Continue the other machines and preserve blocked checkouts' local changes and history. This is deployment, not implementation: use the existing verification evidence rather than repeating the development suite.

## 3. Restart ready remote services

After a successful remote build, the script schedules a uniquely named transient systemd unit outside `piano.service`'s process tree and prints `UNIT` and `LOG`. Record both. The job checks for RPC processes immediately, then waits 600 seconds and checks again whenever any are present, without a timeout. An idle RPC process still counts as a running session. Each machine's loop survives a dropped SSH connection.

Retain RPC PIDs and check timestamps in the remote log. The check covers remote processes using the RPC mode flag, including sessions outside Piano. There is a small check/restart race: a session starting after the final check can still be interrupted.

While the job waits, report it as pending, not deployed. Continue monitoring until it restarts or fails; a dropped SSH connection does not authorize skipping the gate. Read the emitted `LOG` path over SSH with `sudo cat` after the job finishes; it is root-owned under `/var/log/piano-deploy/`, and `journalctl -u <UNIT>` holds the same record. Require this run's `DEPLOY OK` and active `piano.service`, `piano-web.socket`, and `piano-web.service`. If still pending, inspect the transient unit; if failed, retain its log and report the failure. Submission of a restart job alone is not completion.

Keep registry data, credentials, access policy, and proxy units unchanged.

## 4. Report

List the target revision and each machine's outcome: updated/built locally, restarted/healthy remotely, or blocked with its reason. Include actionable installation warnings. Ask the user to reload remote browsers. HTTP health checks establish serving health only; browser/session behavior remains unverified unless separately observed.
