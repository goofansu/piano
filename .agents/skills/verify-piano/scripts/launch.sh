#!/usr/bin/env bash
# Start an isolated scratch Piano for verification: a new run dir with its own database, Pi agent
# and session dirs and HOME, a throwaway Git repo, fake Pi, a backend and the Vite UI on free
# loopback ports. Waits until the UI's session socket answers, then prints the run dir.
# Usage: launch.sh [--empty] [--fake-pi browser|dialogs]
#   --empty            start from an empty database: no folder, project or session
#   --fake-pi browser  test/browser/fake-pi.mjs (default): echoes, "hold" runs until Stop, audits
#   --fake-pi dialogs  test/fake-pi.mjs: "ask..." opens an input dialog, "crash..." exits Pi
# Env: VERIFY_SCRATCH (default /tmp/verify-piano), VERIFY_EVIDENCE (default
#   ${TMPDIR:-/tmp}/verify-piano-evidence), VERIFY_RUN_ID, VERIFY_PORT, VERIFY_WEB_PORT.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SEED=1
FAKE=browser
while [ $# -gt 0 ]; do
  case "$1" in
    --empty) SEED=0 ;;
    --fake-pi) FAKE=${2:?--fake-pi browser|dialogs}; shift ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
  shift
done
case "$FAKE" in
  browser) PI_CLI=$ROOT/test/browser/fake-pi.mjs ;;
  dialogs) PI_CLI=$ROOT/test/fake-pi.mjs ;;
  *) die "--fake-pi takes browser or dialogs" ;;
esac

RUN_ID=${VERIFY_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}
RUN=$SCRATCH_ROOT/$RUN_ID
EVIDENCE=${VERIFY_EVIDENCE:-${TMPDIR:-/tmp}/verify-piano-evidence}/$RUN_ID
[ -e "$RUN" ] && die "$RUN already exists"
[ -d "$ROOT/node_modules" ] || (cd "$ROOT" && npm ci --no-audit --no-fund)

free_port() {
  node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}
PORT=${VERIFY_PORT:-$(free_port)}
WEB_PORT=${VERIFY_WEB_PORT:-$(free_port)}
[ "$PORT" != "$WEB_PORT" ] || die "backend and UI need different ports"
for p in "$PORT" "$WEB_PORT"; do
  case "$p" in 7070 | 8000 | 8001 | 5173) die "port $p belongs to a real Piano or its dev server; pick another" ;; esac
  [ -z "$(ss -Hltn "sport = :$p")" ] || die "port $p is already in use"
done

mkdir -p "$RUN"/home "$RUN"/pi-agent "$RUN"/pi-sessions "$RUN"/db "$RUN"/logs "$EVIDENCE"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# The throwaway repository Piano registers; worktrees Piano creates land beside it, inside $RUN.
REPO=$RUN/repo
mkdir -p "$REPO/src"
git -C "$REPO" init -q -b main
printf '# verify repo\n' > "$REPO/README.md"
printf 'export const answer = 4;\n' > "$REPO/src/answer.ts"
printf 'ignored/\n' > "$REPO/.gitignore"
git -C "$REPO" add .
git -C "$REPO" -c user.name=Verify -c user.email=verify@example.invalid commit -q -m init

DB=$RUN/db/piano.db
if [ "$SEED" = 1 ]; then
  node "$SKILL_DIR/scripts/seed.ts" "$DB" "$REPO" "$RUN/pi-sessions" > "$RUN/logs/seed.log"
fi

API_URL=http://127.0.0.1:$PORT
WEB_URL=http://127.0.0.1:$WEB_PORT
cat > "$RUN/run.env" <<EOF
# Written by launch.sh. Source it to drive this run: . $RUN/run.env
RUN_ID=$RUN_ID
RUN=$RUN
EVIDENCE=$EVIDENCE
ROOT=$ROOT
REPO=$REPO
DB=$DB
AUDIT=$RUN/audit.jsonl
PI_CLI=$PI_CLI
SEEDED=$SEED
PORT=$PORT
WEB_PORT=$WEB_PORT
API_URL=$API_URL
WEB_URL=$WEB_URL
ORIGIN=$WEB_URL
EXPECTED_SHA=$(git -C "$ROOT" rev-parse HEAD)
AB_SESSION=verify-$RUN_ID
# For scripts/dispatch-session.ts against this instance:
export PIANO_SESSION_WS_URL=ws://127.0.0.1:$PORT/ws
export PIANO_SESSION_ORIGIN=$WEB_URL
EOF

cd "$ROOT"
env -u PIANO_API_SOCKET -u PIANO_SESSION_WS_URL -u PIANO_SESSION_ORIGIN \
  HOME="$RUN/home" HOST=127.0.0.1 PORT="$PORT" PIANO_DB_PATH="$DB" \
  PI_CODING_AGENT_DIR="$RUN/pi-agent" PI_CODING_AGENT_SESSION_DIR="$RUN/pi-sessions" PI_OFFLINE=1 \
  PIANO_ALLOWED_ORIGINS="$WEB_URL,$API_URL" PIANO_PI_CLI="$PI_CLI" PIANO_PI_ARGS= \
  PIANO_TEST_AUDIT="$RUN/audit.jsonl" \
  setsid node server/main.ts > "$RUN/logs/server.log" 2>&1 < /dev/null &
SERVER_PID=$!
cd "$ROOT/web"
PIANO_DEV_BACKEND=$API_URL setsid node "$ROOT/node_modules/vite/bin/vite.js" \
  --host 127.0.0.1 --port "$WEB_PORT" --strictPort > "$RUN/logs/web.log" 2>&1 < /dev/null &
WEB_PID=$!
cd "$ROOT"
sleep 0.2
{
  echo "server $SERVER_PID $(starttime "$SERVER_PID") $ROOT"
  echo "web $WEB_PID $(starttime "$WEB_PID") $ROOT/web"
} > "$RUN/pids"

# Ready means usable: the API answers, the UI serves its page, and the UI's /ws proxy delivers
# the registry with the UI's origin, which is what the browser waits for.
ready=0
for _ in $(seq 1 150); do
  for pid in "$SERVER_PID" "$WEB_PID"; do
    kill -0 "$pid" 2> /dev/null || {
      tail -n 20 "$RUN/logs/server.log" "$RUN/logs/web.log" >&2
      die "process $pid exited during launch; run scripts/cleanup.sh $RUN"
    }
  done
  if curl -fsS -o /dev/null "$API_URL/api/folders" 2> /dev/null && curl -fsS "$WEB_URL/" 2> /dev/null | grep -q 'id="root"' &&
    node "$SKILL_DIR/scripts/ws-check.mjs" "ws://127.0.0.1:$WEB_PORT/ws" "$WEB_URL" > "$RUN/logs/ready.log" 2>&1; then
    ready=1
    break
  fi
  sleep 0.4
done
[ "$ready" = 1 ] || die "not ready after 60s; see $RUN/logs; run scripts/cleanup.sh $RUN"

echo "READY $(cat "$RUN/logs/ready.log")"
echo "api      $API_URL  (server pid $SERVER_PID)"
echo "ui       $WEB_URL  (vite pid $WEB_PID)"
echo "database $DB  seeded=$SEED  fake-pi=$FAKE"
echo "evidence $EVIDENCE"
echo "RUN=$RUN"
