# Pi RPC failure policy — YEJ-7

Scope: INV-02, INV-03, INV-05 and INV-12, behind `PiSessions`.

## Policy

- Stdout is JSONL, not a logging channel. Malformed JSON, null, primitives, arrays,
  missing/empty/non-string `type`, or invalid response envelopes fail the session.
- An envelope permits extra fields. Unknown event types remain forward compatible;
  payload interpretation remains in PiRecords. This is not full payload validation.
- Responses require a string command and boolean success; optional IDs/errors must
  be strings. Valid responses without a matching pending ID are ignored, including
  late acknowledgements. They never become agent activity.
- Reader errors and defects use the same failed-session transition. Diagnostics do
  not include raw lines or reader causes, which may contain secrets.
- EOF allows one second for normal process-exit notification. A still-running child
  without stdout fails instead of leaving requests waiting for acknowledgement.
- Failure settles pending requests/writes, ends the record stream (preserving already
  queued records before closure), rejects further input and terminates the child via
  the existing one-second force-kill grace. Scope interruption is not a protocol error.
- No automatic retry: a failed acknowledgement cannot prove input was not executed.
  Inspect/reopen Pi history before deciding whether to submit again.

## Evidence

Environment: Node v24.21.0, Linux, branch `fix/yej-7-pi-rpc-validation`, base
`542bf85597042452308d6c72afd500b783d96e01` plus this commit's changes.

- Before: `node --test --import ./test/setup.ts --test-name-pattern='invalid Pi output.*null' test/PiSessions.test.ts`
  failed at the five-second test deadline: no session closure or settled prompt.
- After: public-interface tests cover malformed JSON, invalid envelopes, response
  validation, stdout EOF, a spawner-injected reader defect during readiness, and a
  valid unknown event. All pass. Existing exit, dialog and normal-turn checks pass.
- `npm test`: 367 passed, zero failures/skips.
- `npm run typecheck`, `npm run lint`, `npm run build`: passed. Build retains its
  large-chunk warning. `npm ci` succeeded and reported seven high vulnerabilities;
  dependency remediation is outside this issue.
- `npx agent-browser --session yej7` against scratch UI 7172/backend 7171, separate
  SQLite registry and `/tmp/yej7-browser/repo`, using `test/fake-pi.mjs`: submitted
  `protocol raw:null`; observed **Exited**, the stdout failure explanation, delivery
  uncertainty, and disabled Send. Reload retained the failure explanation. No model
  calls or deployment. Scratch processes and Pi session directory were removed.
- Local retained output: `/tmp/yej7-{red,focused,test,typecheck,lint,build}.log` and
  `/tmp/yej7-browser/{before,failed,reloaded}.txt`.

Limitations: browser fault injection uses fake Pi, not a live-provider compatibility
claim. Reader-defect injection substitutes the external spawner's stdout stream;
EOF and malformed records use a real subprocess. Payload validation, queue/frame
limits (YEJ-9), and the wider suppression audit (YEJ-10) remain separate work.
