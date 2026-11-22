#!/usr/bin/env bash
set -uo pipefail
usage() {
  cat <<'USAGE'
Usage: check.sh <full-target-SHA>
Read-only completion check for deploy-exe-dev, run on the VM (as root inside the restart job, or
with sudo). Each line starts with ok or FAIL. Exit 0 when every check passes.
USAGE
}
case "${1:-}" in -h | --help) usage; exit 0 ;; esac

target=${1:-}
if [[ ! "$target" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: check.sh <full-target-SHA>" >&2
  exit 2
fi
dir=/home/exedev/piano
failed=0
ok() { echo "ok   $*"; }
bad() {
  echo "FAIL $*"
  failed=1
}
code() {
  local c
  for _ in $(seq 1 30); do
    c=$(curl -s -o /dev/null -w '%{http_code}' "$1")
    [ "$c" = 200 ] && break
    sleep 1
  done
  echo "$c"
}

echo "check $(date -u +%FT%TZ) target $target"
head=$(git -c safe.directory="$dir" -C "$dir" rev-parse HEAD 2>&1)
[ "$head" = "$target" ] && ok "checkout $dir at $head" || bad "checkout $dir at $head, expected $target"

c=$(code http://127.0.0.1:8001/api/folders)
[ "$c" = 200 ] && ok "GET 127.0.0.1:8001/api/folders 200" || bad "GET 127.0.0.1:8001/api/folders answered $c"
c=$(code http://127.0.0.1:8000/)
[ "$c" = 200 ] && ok "GET 127.0.0.1:8000/ 200 (built UI through the socket proxy)" || bad "GET 127.0.0.1:8000/ answered $c"

for unit in piano.service piano-web.socket piano-web.service; do
  s=$(systemctl is-active "$unit")
  [ "$s" = active ] && ok "$unit active" || bad "$unit is $s"
done
for unit in piano.service piano-web.socket; do
  s=$(systemctl is-enabled "$unit")
  [ "$s" = enabled ] && ok "$unit enabled" || bad "$unit is $s"
done

for port in 8000 8001; do
  addrs=$(ss -ltnH "sport = :$port" | awk '{print $4}' | sort -u | tr '\n' ' ')
  if [ -z "$addrs" ]; then
    bad "nothing listens on port $port"
  elif [ "$addrs" = "127.0.0.1:$port " ]; then
    ok "port $port listens on 127.0.0.1 only"
  else
    bad "port $port listens on $addrs"
  fi
done

[ "$failed" = 0 ] && echo "DEPLOY OK $target" || echo "DEPLOY FAILED $target"
exit "$failed"
