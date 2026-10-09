---
name: sync-piano
description: Sync Piano to latest main locally and on exe.dev VMs tagged goofansu-piano, then restart remote services. Use when asked to update or sync all Piano machines.
---

# Sync Piano

This invocation authorizes dependency installation, builds, and remote service restarts. Local services stay running. Follow the repository's [hosted workflow](../../../docs/hosted-development.md) for deployment policy and health checks; load the available `using-exe-dev` skill for SSH guidance.

## 1. Freeze the target and discover machines

From the local Piano repository, fetch `origin main` and resolve `origin/main` to a full commit SHA. Use that same SHA for every checkout in this run.

Run `ssh exe.dev ls --json`. Select every VM whose `tags` array contains exactly `goofansu-piano`; use its returned `ssh_dest`. Report the selected machines. An empty selection means local-only work, and must be reported.

## 2. Sync and build each checkout

Use the local repository root and `/home/exedev/piano` on each selected VM. Independent machines may run in parallel.

Before updating each checkout, require a clean `git status --porcelain` and branch `main`. Fetch `origin main`, then `git merge --ff-only <target-SHA>`. Require `git rev-parse HEAD` to equal the frozen target. If the checkout is dirty, on another branch, ahead, divergent, missing, or unreachable, report it as blocked and continue the other machines. Preserve local changes and history.

Run `npm ci` and `npm run build`, retaining their output. On remote machines, prepend `/home/exedev/.local/bin:/home/exedev/node/bin:/usr/local/bin:/usr/bin:/bin` to `PATH`. A checkout is ready only when its revision matches and both commands succeed. This is deployment, not implementation: use the existing verification evidence rather than repeating the development suite.

## 3. Restart ready remote services

Immediately after each remote build succeeds, restart through a uniquely named transient systemd unit outside `piano.service`'s process tree. Active-session interruption is preapproved. For example, over SSH:

```bash
sudo systemd-run --collect --unit="piano-deploy-$(date +%s)-$$" /bin/bash -c '
  exec > /tmp/piano-deploy.log 2>&1
  systemctl restart piano.service &&
  curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:8001/api/projects -o /dev/null &&
  curl -fsS http://127.0.0.1:8000/ -o /dev/null &&
  echo "DEPLOY OK"
'
```

Read `/tmp/piano-deploy.log` over SSH after the job finishes. Require this run's `DEPLOY OK` and active `piano.service`, `piano-web.socket`, and `piano-web.service`. If still pending, inspect the transient unit; if failed, retain its log and report the failure. Submission of a restart job alone is not completion.

Keep registry data, credentials, access policy, and proxy units unchanged.

## 4. Report

List the target revision and each machine's outcome: updated/built locally, restarted/healthy remotely, or blocked with its reason. Include actionable installation warnings. Ask the user to reload remote browsers. HTTP health checks establish serving health only; browser/session behavior remains unverified unless separately observed.
