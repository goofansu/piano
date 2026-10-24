#!/usr/bin/env bash
# Read-only check: is this Piano worth driving? Starts, stops and writes nothing.
# Usage: doctor.sh <run-dir>            an isolated instance from launch.sh
#        doctor.sh --deployed           ON an exe.dev VM: piano.service (8001) behind piano-web (8000)
#        doctor.sh --deployed-auth <vm> from OUTSIDE the VM: https://<vm>.exe.xyz requires exe.dev login
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
moved() { git -C "$1" reflog -1 --date=unix --format=%gd 2> /dev/null | tr -dc 0-9; }

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

deployed() {
  for unit in piano.service piano-web.socket piano-web.service; do
    s=$(systemctl is-active "$unit")
    [ "$s" = active ] && ok "$unit active" || bad "$unit is $s"
  done
  main=$(systemctl show -p MainPID --value piano.service)
  [ "$(owner 8001)" = "$main" ] && ok "127.0.0.1:8001 is owned by piano.service (pid $main)" || bad "8001 owner '$(owner 8001)' is not piano.service pid $main"
  proxy=$(systemctl show -p MainPID --value piano-web.service)
  holders=$(listeners 8000 | tr '\n' ' ')
  case " $holders" in
    *" 1 "* | *" $proxy "*) ok "127.0.0.1:8000 is held by piano-web (systemd socket / proxy pid $proxy)" ;;
    *) bad "8000 is held by pid(s) $holders, not piano-web" ;;
  esac
  dir=$(systemctl show -p WorkingDirectory --value piano.service)
  head=$(git -C "$dir" rev-parse HEAD)
  ok "checkout $dir at $head ($(git -C "$dir" log -1 --format=%s | cut -c1-70))"
  fetched=$(git -C "$dir" rev-parse origin/main 2> /dev/null)
  [ "$head" = "$fetched" ] && ok "HEAD equals origin/main as last fetched (no fetch done here)" || note "HEAD differs from origin/main as last fetched ($fetched)"
  started=$(date -d "$(systemctl show -p ActiveEnterTimestamp --value piano.service)" +%s)
  head_moved=$(moved "$dir")
  if [ -n "$head_moved" ] && [ "$head_moved" -gt "$started" ]; then
    bad "HEAD moved after piano.service started: the running backend predates $head (restart is the owner's call, not this skill's)"
  else
    ok "piano.service started after HEAD last moved"
  fi
  built=$(stat -c %Y "$dir/web/dist/index.html" 2> /dev/null || echo 0)
  if [ -n "$head_moved" ] && [ "$built" -lt "$head_moved" ]; then bad "web/dist is older than HEAD: the UI served on 8000 predates $head"; else ok "web/dist built after HEAD last moved"; fi
  c=$(code http://127.0.0.1:8001/api/folders)
  [ "$c" = 200 ] && ok "GET 127.0.0.1:8001/api/folders 200" || bad "GET 8001/api/folders answered $c"
  c=$(code http://127.0.0.1:8000/)
  [ "$c" = 200 ] && ok "GET 127.0.0.1:8000/ 200 (built UI through the socket proxy)" || bad "GET 8000/ answered $c"
  origins=$(systemctl show -p Environment --value piano.service | tr ' ' '\n' | sed -n 's/^PIANO_ALLOWED_ORIGINS=//p')
  note "allowed origins: $origins (a browser on any other origin, including http://127.0.0.1:8000, cannot open the session socket)"
  note "auth is exe.dev private access: run 'doctor.sh --deployed-auth <vm>' from outside the VM"
}

deployed_auth() {
  vm=${1:?usage: doctor.sh --deployed-auth <vm>}
  for path in / /api/folders; do
    out=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "https://$vm.exe.xyz$path")
    case "$out" in
      "307 https://$vm.exe.xyz/__exe.dev/login"*) ok "https://$vm.exe.xyz$path without a login redirects to exe.dev login" ;;
      *) bad "https://$vm.exe.xyz$path answered '$out'; expected 307 to /__exe.dev/login (is the VM still private?)" ;;
    esac
  done
}

case "${1:-}" in
  --deployed) deployed ;;
  --deployed-auth) deployed_auth "${2:-}" ;;
  "" | -h | --help) sed -n '2,6p' "$0"; exit 2 ;;
  *) isolated "$1" ;;
esac
exit "$failed"
