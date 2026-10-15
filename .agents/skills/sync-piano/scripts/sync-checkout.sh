#!/usr/bin/env bash
# Requires an explicitly authorized sync-piano invocation. Does not discover VMs or monitor jobs.
set -euo pipefail

usage() {
  printf '%s\n' \
    'Usage: bash sync-checkout.sh local|remote <full-target-SHA> [local-repository-root]' \
    'Local: sync/install/build only. Remote: also schedule an RPC-gated restart.' \
    'Remote mode supports bash -s over SSH and uses /home/exedev/piano.' \
    'Retain stdout/stderr; monitor the emitted UNIT and LOG (root-owned, read with sudo) until completion.'
}

if [ "${1:-}" = --help ]; then
  usage
  exit 0
fi
mode=${1:-}
target=${2:-}
if [[ ! "$target" =~ ^[0-9a-f]{40}$ ]] || [[ "$mode" != local && "$mode" != remote ]] || [ "$#" -gt 3 ]; then
  usage >&2
  exit 2
fi
if [ "$mode" = remote ]; then
  [ "$#" -eq 2 ] || { usage >&2; exit 2; }
  export PATH=/home/exedev/.local/bin:/home/exedev/node/bin:/usr/local/bin:/usr/bin:/bin
  root=/home/exedev/piano
else
  root=${3:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)}
fi
cd -- "$root" || { echo 'BLOCKED: checkout missing or inaccessible' >&2; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo 'BLOCKED: not on main' >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'BLOCKED: dirty checkout' >&2; git status --porcelain; exit 1; }
if [ "$mode" = remote ]; then
  # Use exe.dev's authenticated HTTPS integration without changing origin.
  GH_HOST=github.int.exe.xyz gh auth setup-git --hostname github.int.exe.xyz
  git fetch https://github.int.exe.xyz/goofansu/piano.git main:refs/remotes/origin/main
else
  git fetch origin main
fi
git merge-base --is-ancestor HEAD "$target" || { echo 'BLOCKED: ahead, divergent, or target unavailable' >&2; exit 1; }
git merge --ff-only "$target"
[ "$(git rev-parse HEAD)" = "$target" ] || { echo 'BLOCKED: revision mismatch' >&2; exit 1; }
npm ci
npm run build
echo "READY $target"
[ "$mode" = remote ] || exit 0

restart_when_idle() {
  exec > "$1" 2>&1
  echo "RUN $2 TARGET $3"
  while true; do
    date -Is
    # Print PIDs only: command lines and environment may contain secrets.
    pgrep -f -- '(^|[[:space:]])--mode(=|[[:space:]]+)rpc([[:space:]]|$)'
    status=$?
    case "$status" in
      0) echo 'RPC sessions present; checking again in 10 minutes'; sleep 600 ;;
      1) echo 'No RPC sessions; restarting'; break ;;
      *) echo 'RPC process check failed; restart blocked'; return 1 ;;
    esac
  done
  systemctl restart piano.service &&
    curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:8001/api/folders -o /dev/null &&
    curl -fsS http://127.0.0.1:8000/ -o /dev/null &&
    systemctl is-active piano.service piano-web.socket piano-web.service &&
    echo 'DEPLOY OK'
}

# A private, unique log prevents stale success and shared /tmp symlink collisions. It is root-owned
# in a root-owned directory: the job runs as root, and fs.protected_regular stops root from writing a
# file another user created in /tmp. Read it with sudo.
sudo install -d -m 0700 /var/log/piano-deploy
log=$(sudo mktemp "/var/log/piano-deploy/$(date +%Y%m%dT%H%M%S)-XXXXXX.log")
unit="piano-deploy-$(date +%s)-$$"
printf 'UNIT=%s.service\nLOG=%s\n' "$unit" "$log"
# No inherited errexit: pgrep exit 1 means idle, not a failed deployment.
# systemd owns the waiting loop, independently of SSH and Piano's process tree.
sudo systemd-run --collect --unit="$unit" /bin/bash -c \
  "$(declare -f restart_when_idle); restart_when_idle \"\$@\"" \
  piano-deploy "$log" "$unit" "$target"
echo "SCHEDULED $unit"
