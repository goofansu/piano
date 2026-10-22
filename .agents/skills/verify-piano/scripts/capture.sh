#!/usr/bin/env bash
# Capture one proof step from this run's browser into the evidence dir, which cleanup keeps:
# $EVIDENCE/<feature>/<step>.png (screenshot), .aria.txt (accessibility snapshot) and .state.json
# (URL, title, session header text, fake-Pi command count at capture time).
# Usage: capture.sh <run-dir> <feature-id> <step>
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_run "${1:-}"
feature=${2:?usage: capture.sh <run-dir> <feature-id> <step>}
step=${3:?usage: capture.sh <run-dir> <feature-id> <step>}
out=$EVIDENCE/$feature
mkdir -p "$out"
ab() { "$SKILL_DIR/scripts/ab.sh" "$RUN" "$@"; }
ab screenshot "$out/$step.png" > /dev/null
ab snapshot > "$out/$step.aria.txt"
ab eval "JSON.stringify({ url: location.href, title: document.title, header: document.querySelector('main header')?.innerText ?? null })" |
  node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const page=JSON.parse(JSON.parse(s));page.fakePiCommands=Number(process.argv[1]);page.capturedAt=new Date().toISOString();console.log(JSON.stringify(page,null,2))})' \
    "$(cat "$AUDIT" 2> /dev/null | wc -l)" > "$out/$step.state.json"
echo "$out/$step.{png,aria.txt,state.json}"
