#!/usr/bin/env bash
# Read-only check: is this Piano worth driving? Starts, stops and writes nothing.
# Usage: doctor.sh <run-dir>   an isolated instance from launch.sh
# Exit 0 when every check passes; each line starts with ok, FAIL or note.
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

failed=0
ok() { echo "ok   $*"; }
bad() {
  echo "FAIL $*"
  failed=1
}
note() { echo "note $*"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
owner() { listeners "$1" | head -n 1; }

isolated() {
  load_run "$1"
  while read -r role pid start cwd; do
    if [ "$(starttime "$pid")" != "$start" ]; then
      bad "$role pid $pid is not running (or the PID was reused)"
      continue
    fi
    ok "$role pid $pid alive since $start"
    [ "$(process_cwd "$pid")" = "$cwd" ] && ok "$role runs from $cwd" || bad "$role cwd is $(process_cwd "$pid"), expected $cwd"
  done < "$RUN/pids"
  server_pid=$(awk '$1=="server"{print $2}' "$RUN/pids")
  web_pid=$(awk '$1=="web"{print $2}' "$RUN/pids")
  [ "$(owner "$PORT")" = "$server_pid" ] && ok "port $PORT is owned by our server" || bad "port $PORT owner is '$(owner "$PORT")', not $server_pid"
  [ "$(owner "$WEB_PORT")" = "$web_pid" ] && ok "port $WEB_PORT is owned by our Vite" || bad "port $WEB_PORT owner is '$(owner "$WEB_PORT")', not $web_pid"
  case "$PORT $WEB_PORT" in *7070* | *8000* | *8001*) bad "a real Piano port is in use by this run" ;; esac

  head=$(git -C "$ROOT" rev-parse HEAD)
  [ "$head" = "$EXPECTED_SHA" ] && ok "checkout at $head (launched at that SHA)" || bad "checkout moved to $head since launch at $EXPECTED_SHA: relaunch"
  dirty=$(git -C "$ROOT" status --porcelain | wc -l)
  [ "$dirty" = 0 ] || note "$dirty uncommitted path(s) in $ROOT are part of what runs"
  grep -qF "[piano] database $DB;" "$RUN/logs/server.log" && ok "server uses database $DB" || bad "server log does not name database $DB"

  folders=$(curl -fsS "$API_URL/api/folders" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).folders.map(f=>f.path).join(" ")))')
  if [ "$SEEDED" = 1 ]; then
    [ "$folders" = "$REPO" ] && ok "GET /api/folders lists only the throwaway repo" || bad "GET /api/folders lists '$folders', expected $REPO"
  else
    [ -z "$folders" ] && ok "GET /api/folders: empty database" || note "GET /api/folders lists '$folders'"
  fi
  # No login exists (docs/configuration.md): the Origin check is what guards state changes.
  c=$(code -X POST -H 'Content-Type: application/json' -d '{}' "$API_URL/api/ls")
  [ "$c" = 403 ] && ok "POST without Origin is refused (403)" || bad "POST without Origin answered $c, expected 403"
  c=$(code -X POST -H 'Content-Type: application/json' -H "Origin: $ORIGIN" -d '{}' "$API_URL/api/ls")
  [ "$c" = 200 ] && ok "POST with Origin $ORIGIN is allowed (200)" || bad "POST with Origin $ORIGIN answered $c"
  if out=$(node "$SKILL_DIR/scripts/ws-check.mjs" "ws://127.0.0.1:$WEB_PORT/ws" "$ORIGIN" 2>&1); then ok "$out"; else bad "$out"; fi
  note "fake Pi commands so far: $(cat "$AUDIT" 2> /dev/null | wc -l) (audit $AUDIT)"
}

case "${1:-}" in
  "" | -h | --help) sed -n '2,4p' "$0"; exit 2 ;;
  *) isolated "$1" ;;
esac
exit "$failed"
