# YEJ-18: rejected session selection recovery

Base: `465be1e`, plus this implementation diff. Node 24.21.0, npm 11.19.0,
installed Effect 4.0.2; scratch fake Pi, no model calls. Contracts: INV-02/05.

Admission rejection previously emitted a generic error that ordinary attachment ignored;
a retained session also suppressed explicit retry. Added `selection_rejected` for admission
failure before selection/create starts. The matching pending attachment ends, drops its
unusable correlation, retains a visible failure and offers Retry for an existing session.
A new attempt clears the failure and uses a fresh selection ID. Stale rejections are ignored;
ready/pending duplicates remain suppressed. A rejected first submission is marked rejected,
not uncertain, and is never automatically recreated. The server's prior selection and
reserved controls remain untouched.

Verification:

- `node --test --import ./test/setup.ts --test-name-pattern='selection rejection' test/Client.test.ts`
  failed before the fix: selecting remained non-null, both with and without retained history.
- Focused Client and ClientDispatch suites passed after the fix. Cross-layer test uses the real
  browser client wired to saturated ClientDispatch, releases capacity and explicitly retries.
  Existing dispatcher answer/abort saturation tests still pass.
- `node test/browser-admission-recovery.mjs /tmp/piano-yej18-browser` passed against scratch
  backend 7171/UI 7172 through agent-browser. Eight held prompts saturated the same socket;
  navigating to another session showed the failure; abort on the old attachment released capacity;
  clicking Retry loaded the target with a fresh ID. Exactly two target selects, no reconnect,
  no browser errors. Commands, wire frames, screenshots and process logs retained in that directory.
  Initial harness run waited for a nonexistent fixture notice; corrected to its actual
  `Capacity dialog answered` cancellation notice, then passed. This was a harness failure.
- `npm test`: 388 passed, no failures/skips. `npm run typecheck` passed.
  `npm run lint` passed after formatting the new browser script. `git diff --check` passed.
- Detailed local logs: `/tmp/piano-issue-audit/selection-*.log` and `browser-selection.log`.

Only scratch processes/files were used and cleaned up. No deployment. Normal execution errors
remain separate from this pre-execution admission outcome; no Pi runtime/protocol upgrade.
