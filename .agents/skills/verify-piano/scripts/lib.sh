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

# Kernel start time of a PID (field 22 of /proc/<pid>/stat): a recorded PID only counts as ours
# while its start time still matches, so a reused PID is never signalled.
starttime() {
  awk '{print $22}' "/proc/$1/stat" 2>/dev/null
}
