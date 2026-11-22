for d in ${HOME:+"$HOME/node/bin" "$HOME/.local/bin"}; do
  if [ -d "$d" ]; then
    case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
  fi
done
export PATH

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROOT=$(cd "$SKILL_DIR/../../.." && pwd)
TMP_ROOT=${TMPDIR:-/tmp}
TMP_ROOT=${TMP_ROOT%/}
SCRATCH_ROOT=${VERIFY_SCRATCH:-$TMP_ROOT/verify-piano}

die() {
  echo "verify-piano: $*" >&2
  exit 1
}

load_run() {
  RUN=${1:?usage: <run-dir>}
  [ -f "$RUN/run.env" ] || die "$RUN has no run.env; pass the directory launch.sh printed"
  # shellcheck disable=SC1091
  . "$RUN/run.env"
}


starttime() {
  if [ -r /proc/self/stat ]; then
    awk '{print $22}' "/proc/$1/stat" 2> /dev/null
  else
    ps -p "$1" -o lstart= 2> /dev/null | tr -s ' ' | tr ' ' _
  fi
}

process_cwd() {
  if [ -r /proc/self/stat ]; then
    readlink "/proc/$1/cwd"
  else
    lsof -a -p "$1" -d cwd -Fn 2> /dev/null | sed -n 's/^n//p'
  fi
}

listeners() {
  if command -v ss > /dev/null; then
    ss -Hltnp "sport = :$1" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  else
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2> /dev/null | sort -u
  fi
}

detach() {
  if command -v setsid > /dev/null; then exec setsid "$@"; else exec "$@"; fi
}

with_timeout() {
  if command -v timeout > /dev/null; then timeout "$@"; else shift; "$@"; fi
}
