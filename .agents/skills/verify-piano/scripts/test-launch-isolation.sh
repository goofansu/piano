#!/usr/bin/env bash
# Exercise launch's isolation through real dispatch/Worktrunk, with owned stand-in user settings.
# Usage: test-launch-isolation.sh (VERIFY_EVIDENCE controls retained evidence as for launch.sh)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mkdir -p "$SCRATCH_ROOT"
fixture=$(mktemp -d "$SCRATCH_ROOT/isolation-fixture.XXXXXX")
run_id="isolation-$(date +%Y%m%d-%H%M%S)-$$"
RUN="$SCRATCH_ROOT/$run_id"
out="${VERIFY_EVIDENCE:-${TMPDIR:-/tmp}/verify-piano-evidence}/$run_id"
mkdir -p "$fixture/config/worktrunk" "$out"
cleanup() {
  local status=$?
  trap - EXIT
  if [ -f "$RUN/run.env" ]; then
    "$SKILL_DIR/scripts/cleanup.sh" "$RUN" > "$out/cleanup.log" 2>&1 || status=1
  fi
  rm -rf "$fixture"
  exit "$status"
}
trap cleanup EXIT
# Both possible placements stay within the throwaway repo even if isolation regresses.
printf 'worktree-path = "{{ repo_path }}/from-config/{{ branch | sanitize }}"\n' \
  > "$fixture/config/worktrunk/config.toml"
XDG_CONFIG_HOME="$fixture/config" XDG_CONFIG_DIRS="$fixture/config" \
  XDG_CACHE_HOME="$fixture/cache" XDG_STATE_HOME="$fixture/state" XDG_DATA_HOME="$fixture/data" \
  WORKTRUNK_CONFIG_PATH="$fixture/config/worktrunk/config.toml" \
  WORKTRUNK_SYSTEM_CONFIG_PATH="$fixture/config/worktrunk/config.toml" \
  WORKTRUNK_WORKTREE_PATH='{{ repo_path }}/from-env/{{ branch | sanitize }}' \
  VERIFY_RUN_ID="$run_id" "$SKILL_DIR/scripts/launch.sh" > "$out/launch.log" 2>&1
. "$RUN/run.env"
"$SKILL_DIR/scripts/doctor.sh" "$RUN" > "$out/doctor.log" 2>&1
printf 'isolation check' > "$RUN/prompt.txt"
node "$ROOT/scripts/dispatch-session.ts" "$RUN/prompt.txt" "$REPO" --worktree isolation-check \
  > "$out/dispatch.json" 2> "$out/dispatch.stderr"
node --input-type=module - "$out/dispatch.json" "$REPO" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(result.creation, 'created');
assert.equal(result.submission, 'started');
assert.equal(result.worktree.path, `${process.argv[3]}.isolation-check`);
assert.equal(result.cwd, result.worktree.path);
console.log('PASS launch ignores inherited Worktrunk placement');
JS
git -C "$REPO" worktree list > "$out/worktrees.txt"
echo "evidence $out"
