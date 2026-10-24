# Shared by the verify-piano scripts; sourced, never run on its own.
# Puts exe.dev's Node and Worktrunk on PATH when present, and locates the skill and the repo.
for d in "$HOME/node/bin" "$HOME/.local/bin"; do
  if [ -d "$d" ]; then
    case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
  fi
done
export PATH

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# .agents/skills/verify-piano -> repository root (the .claude/skills symlink has the same depth).
ROOT=$(cd "$SKILL_DIR/../../.." && pwd)
SCRATCH_ROOT=${VERIFY_SCRATCH:-/tmp/verify-piano}

# The one agent-browser version every script runs, through npx (never installed globally).
# Bump it here after checking the new release with a proof run; VERIFY_AB_VERSION overrides it
# for a single run.
AB_VERSION="${VERIFY_AB_VERSION:-0.39.1}"

die() {
  echo "verify-piano: $*" >&2
  exit 1
}

# Load a run directory written by launch.sh.
load_run() {
  RUN=${1:?usage: <run-dir>}
  [ -f "$RUN/run.env" ] || die "$RUN has no run.env; pass the directory launch.sh printed"
  # shellcheck disable=SC1091
  . "$RUN/run.env"
}

# Process and port facts, from what the host offers: Linux has /proc, ss and setsid; macOS has ps,
# lsof and neither of the others. Every script goes through these, so no script names a tool.

# One token for when PID $1 started (empty once it is gone): a recorded PID only counts as ours
# while its start token still matches, so a reused PID is never signalled.
starttime() {
  if [ -r /proc/self/stat ]; then
    awk '{print $22}' "/proc/$1/stat" 2> /dev/null
  else
    ps -p "$1" -o lstart= 2> /dev/null | tr -s ' ' | tr ' ' _
  fi
}

# Working directory of PID $1.
process_cwd() {
  if [ -r /proc/self/stat ]; then
    readlink "/proc/$1/cwd"
  else
    lsof -a -p "$1" -d cwd -Fn 2> /dev/null | sed -n 's/^n//p'
  fi
}

# PIDs listening on TCP port $1, one per line; nothing when the port is free.
listeners() {
  if command -v ss > /dev/null; then
    ss -Hltnp "sport = :$1" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  else
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2> /dev/null | sort -u
  fi
}

# Start a server as `detach <cmd...> &`: the background subshell becomes the command itself, so
# `$!` is the server's own PID, in its own session where setsid exists (a closing terminal never
# reaches it).
detach() {
  if command -v setsid > /dev/null; then exec setsid "$@"; else exec "$@"; fi
}

# `timeout <seconds> <cmd...>` where timeout exists (coreutils; absent on stock macOS), else the command alone.
with_timeout() {
  if command -v timeout > /dev/null; then timeout "$@"; else shift; "$@"; fi
}
