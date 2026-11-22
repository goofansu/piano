#!/usr/bin/env bash
set -euo pipefail
usage() {
  cat <<'USAGE'
Usage: ab.sh <run-dir> <agent-browser args...>
Run the installed agent-browser in this run's own browser session.
  ab.sh "$RUN" open "$WEB_URL/new"
  ab.sh "$RUN" find role button click --name "New session" --exact
Env: VERIFY_AB_TIMEOUT (seconds, default 60).
USAGE
}
case "${1:-}" in -h | --help) usage; exit 0 ;; esac
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_run "${1:-}"
shift
with_timeout "${VERIFY_AB_TIMEOUT:-60}" agent-browser --session "$AB_SESSION" "$@"
