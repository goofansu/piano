# Evidence-based development and testing

Use evidence-based development while building Piano itself. This contributor policy supports
[the development invariants](development-invariants.md); it does not prescribe a skill package.
The goal is justified confidence in changed behavior, not more tests, higher test counts or a
coverage percentage.

## The development loop

1. State the intended behavior and concrete failure risk. Reference an acceptance criterion or
   invariant when relevant. A small change may need only a sentence in the PR.
2. Inspect existing coverage and choose the cheapest check that can actually falsify the claim.
   For a bug, reproduce it before fixing it when feasible. Do not invent a reproduction result.
3. Make one coherent change, run the relevant check and inspect the actual outcome. When adding
   behavior tests, work in small red/green increments instead of speculative test batches.
4. Retain evidence tied to the tested revision (including dirty changes), environment and commands.
   For regressions, show failure before the fix and success after it when feasible; verify that the
   failure was the intended defect, not a broken fixture or missing dependency.
5. Stop when the acceptance claim and relevant risk are covered and required gates pass. Broaden
   verification only for a concrete unresolved risk. Report uncertainty or blocked checks honestly.

A passing test proves only its assertions. An agent summary, skill invocation or successful build
does not prove an unobserved user journey. Evidence may be test output, browser observations,
reproduction logs or document review, depending on the change.

## When to add a test

Add or extend a durable test when it protects a meaningful behavior, boundary or regression that
existing checks do not cover. Before adding it, answer:

- What plausible defect would make this test fail?
- Why is that defect consequential or likely to recur?
- Why does existing coverage not already catch it?
- Is this the smallest reliable boundary at which to observe it?

These are review questions, not a mandatory per-test form. Prefer extending a relevant case over
duplicating it. A critical failure can justify a test before it has occurred in production.
Repeated manual verification of important behavior is a signal to automate it.

Do not add tests solely for documentation, copy-only edits, trivial delegation, generated code,
type-level guarantees or a reversible low-impact change already covered by existing checks. Such
changes still need appropriate inspection. If trivial-looking code carries real policy or lifecycle
risk, test that behavior. No one-test-per-function rule, arbitrary coverage target or requirement
that every PR add tests applies.

## Unit and module test guardrails

- Test observable inputs, outputs, errors and state transitions through stable public boundaries.
  For PiSessions, use `open`, `events`, `act`, `state`, `commands`, `probe` and `history`. Do not
  export private helpers or restructure production code merely to assert incidental internals.
- Derive expected results from the contract, a worked example or a known fixture. Do not calculate
  expectations using the same algorithm as the implementation under test.
- Assert the behavior that matters. Exact calls or ordering are appropriate only when they are
  part of the external contract, such as exactly one dialog response written to Pi.
- Keep real domain logic in the test path. Fake external boundaries such as the Pi subprocess,
  clock or network; do not mock every internal collaborator and then test those mocks.
- Keep tests isolated and deterministic: scratch repositories, explicit event synchronization,
  controlled deadlines, bounded waits and cleanup of resources the test created. Avoid arbitrary
  sleeps, live model calls and dependence on developer credentials or the user's running instance.
- Cover meaningful error, cancellation, timeout and concurrency paths when the changed behavior
  depends on them. Do not enumerate combinations without identifying a distinct risk.
- Prefer focused assertions to large snapshots. Snapshots are appropriate for stable structured
  contracts only when their scope is intentional and changes can be meaningfully reviewed.
- A behavior-preserving refactor should normally retain its tests. If harmless implementation
  changes repeatedly break them, inspect whether they assert implementation details.
- Fix or explicitly track flaky tests; retries must not manufacture confidence. Remove obsolete
  tests when the protected contract is deliberately retired, and explain the changed contract.

## Choose the right evidence boundary

| Change or risk | Useful evidence |
| --- | --- |
| Domain rule, translation or state transition | Focused unit/module test if the behavior is consequential and not already covered. |
| RPC lifecycle, reconnect, dialog race | Deterministic fake-Pi contract test through PiSessions; browser observation when UI behavior changes. |
| Git/Worktrunk lifecycle semantics | Integration check in a throwaway repository against the supported version; a mocked CLI alone cannot establish compatibility. |
| User interaction, rendering or preview identity | Observe the affected browser journey, including relevant error/empty states; retain a regression test when recurrence warrants it. |
| Pi/runtime dependency upgrade | Existing suites/typechecks plus the compatibility and scratch-browser checks in INV-12. |
| Documentation or comments only | Inspect accuracy, links and consistency; no new unit tests or unrelated runtime suite needed. |
| Refactor with unchanged behavior | Existing relevant tests and typecheck; add a test only for a meaningful uncovered risk. |

Avoid proving the same behavior at every layer. Use a small number of integration/browser checks
where boundaries matter, backed by focused lower-level tests for distinct logic. A fake-protocol
test validates Piano's contract handling, not the real Pi release; a real-runtime smoke check serves
a different purpose.

## Browser tests

Browser evidence for a change is an observation through `agent-browser` on a scratch instance,
kept in the PR; it does not become a committed script. The committed browser tests are only the
critical paths, which must keep working on every change and run in CI:

- `test/browser/start-session.mjs`: choose a folder, model, effort and project; send the first
  message; see the reply; reload without resending.
- `test/browser/open-session.mjs`: open a session from the sidebar; read its transcript; jump to an
  earlier message; read the session cost; send a follow-up and see the reply and updated cost;
  stop a running reply.

`npm run test:browser` runs both (about 6 seconds each) against a scratch registry, Pi history and
`test/browser/fake-pi.mjs`, with no model calls. They drive the UI by role and accessible name and
assert what a user sees and what Pi receives, not markup. Add a journey only for a new critical
path; cover rules and edge cases with module tests. Earlier documents cite `test/browser-*.mjs`
scripts as the evidence of their time; those scripts were removed for these two journeys.

## Completion evidence

For code or dependency changes, run `npm test`, `npm run typecheck` and `npm run lint` as the repository baseline.
Run build or other checks when the changed surface requires them. Observe affected application
behavior through `agent-browser` on a scratch instance as described in root AGENTS.md.
Documentation-only work needs document review and link checks, not a browser smoke test.

In the PR, summarize what changed, what evidence supports it, the tested revision/environment and
any material gaps. Mention whether a regression test was added or why existing coverage/inspection
was sufficient. Short explanations are enough; do not create a second evidence database in the
registry or a large ritual for small edits.

Never weaken a required assertion just to make a change green. Changes to acceptance criteria,
tests or gates must expose the intended contract change for review. Distinguish a failing check
from a check that could not run; neither is a pass.
