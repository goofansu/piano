#!/usr/bin/env bash
# agent-browser@$AB_VERSION (pinned in lib.sh) in this run's own browser session, through npx.
# Never installs it globally.
# Usage: ab.sh <run-dir> <agent-browser args...>
#   ab.sh "$RUN" open "$WEB_URL/new"
#   ab.sh "$RUN" find role button click --name "New session" --exact
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_run "${1:-}"
shift
exec timeout "${VERIFY_AB_TIMEOUT:-60}" npx -y "agent-browser@${AB_VERSION}" --session "$AB_SESSION" "$@"
