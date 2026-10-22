#!/usr/bin/env bash
# Tear down one launch.sh run: close its browser session, stop only the PIDs launch.sh recorded
# (each checked against its kernel start time, never looked up by name), keep the logs, fake-Pi
# audit and run.env with the evidence, then delete the scratch run dir. Evidence is never deleted.
# Usage: cleanup.sh <run-dir>
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_run "${1:-}"
case "$RUN" in "$SCRATCH_ROOT"/?*) ;; *) die "refusing to clean $RUN: not under $SCRATCH_ROOT" ;; esac

timeout 30 npx -y agent-browser --session "$AB_SESSION" close > /dev/null 2>&1 && echo "closed browser session $AB_SESSION"

while read -r role pid start _; do
  if [ "$(starttime "$pid")" != "$start" ]; then
    echo "$role pid $pid already gone"
    continue
  fi
  kill -TERM "$pid"
  for _ in $(seq 1 50); do
    [ "$(starttime "$pid")" = "$start" ] || break
    sleep 0.2
  done
  if [ "$(starttime "$pid")" = "$start" ]; then
    kill -KILL "$pid"
    echo "$role pid $pid killed after 10s"
  else
    echo "$role pid $pid stopped"
  fi
done < "$RUN/pids"

for p in "$PORT" "$WEB_PORT"; do
  [ -z "$(ss -Hltn "sport = :$p")" ] && echo "port $p free" || echo "WARNING port $p still listening"
done

mkdir -p "$EVIDENCE/_run"
cp -r "$RUN/logs" "$RUN/run.env" "$RUN/pids" "$EVIDENCE/_run/"
[ -f "$AUDIT" ] && cp "$AUDIT" "$EVIDENCE/_run/fake-pi-audit.jsonl"
rm -rf "$RUN"
echo "removed $RUN"
echo "evidence kept in $EVIDENCE:"
find "$EVIDENCE" -type f | sort
