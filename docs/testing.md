# Evidence-based development and testing

The goal is justified confidence in changed behavior, not more tests or a coverage percentage.

## The development loop

[AGENTS.md](../AGENTS.md#verification) states the loop. In addition:

- Do not invent a reproduction result.
- For a regression, show failure before the fix and success after it when feasible, and check
  that the failure was the intended defect, not a broken fixture or missing dependency.
- On exe.dev, publish evidence by [PR evidence](development-on-exe-dev.md#pr-evidence).
- A passing test proves only its assertions; a build or agent summary proves no user journey.

## When to add a test

A reproduction is PR evidence; a committed test is a contract kept for good. Take a meaningful
behavior, boundary or regression that existing checks miss down this ladder and stop at the first
rung that holds:

1. **Close the class.** When the defect is one instance of a rule that a type, lint rule or shared
   boundary can enforce, enforce it there and test the rule once.
2. **Extend a case.** When an existing test states the contract, give it the failing input. Inputs
   that differ only in shape or size, such as path names, counts or encodings, share one table.
3. **Add a test** for a contract no existing test title states, at the smallest reliable boundary.

`npm run verify` prints the lines changed in `test/` and `features/*/tests/` since `origin/main`. A behavior-preserving
refactor adds no more test lines than it removes; when it adds more, name the uncovered risk each
added test protects.

Repeated manual verification of important behavior is a signal to automate it.

Do not add tests solely for documentation, copy-only edits, trivial delegation, generated code,
type-level guarantees or a reversible low-impact change already covered. No one-test-per-function
rule, coverage target or requirement that every PR add tests applies.

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
- Wait for the event you depend on; never infer it from another one finishing first. An
  acknowledgement does not mean its effects have arrived: Pi answers a prompt before it sends the
  user message, and file-watch events can arrive long after the write. Subscribe before acting,
  then wait for the state you assert on, such as Pi going idle. `npm test` runs files in
  parallel, so a test that passes only on an idle machine is broken. To check whether a test
  depends on ordering, run several copies of it at once.
- Cover meaningful error, cancellation, timeout and concurrency paths when the changed behavior
  depends on them. Do not enumerate combinations without identifying a distinct risk.
- Prefer focused assertions to large snapshots. Snapshots are appropriate for stable structured
  contracts only when their scope is intentional and changes can be meaningfully reviewed.
- To show a new or moved test guards its contract, break the production code it protects once,
  watch the test fail for that reason, then restore the code exactly.
- A behavior-preserving refactor should normally retain its tests. If harmless implementation
  changes repeatedly break them, inspect whether they assert implementation details.
- Fix or explicitly track flaky tests; retries must not manufacture confidence. A failing or
  flaky test may be reporting a product bug: diagnose which before changing the test. Remove
  obsolete tests when the protected contract is deliberately retired, and explain the changed
  contract.

## Choose the right evidence boundary

| Change or risk | Useful evidence |
| --- | --- |
| Domain rule, translation or state transition | Focused unit/module test if the behavior is consequential and not already covered. |
| Browser–server request or reply (`ClientMessage`/`ServerMessage` in `shared/wire.ts`, feature HTTP endpoints assembled in `server/app/Endpoints.ts`) | Module test through the handler: `test/ClientDispatch.test.ts` for socket messages, `test/Api.test.ts` for HTTP. |
| RPC lifecycle, reconnect, dialog race | Deterministic fake-Pi contract test through PiSessions; browser observation when UI behavior changes. |
| Git lifecycle semantics | Integration check in a throwaway repository against real Git; a mocked CLI alone cannot establish compatibility. |
| User interaction, rendering or preview identity | Observe the affected browser journey, including relevant error/empty states; retain a regression test when recurrence warrants it. |
| Pi/runtime dependency upgrade | Existing suites/typechecks plus the compatibility and scratch-browser checks in INV-12. |
| Refactor with unchanged behavior | Existing relevant tests and typecheck; add a test only for a meaningful uncovered risk. |

Avoid proving the same behavior at every layer. Use a small number of integration/browser checks
where boundaries matter, backed by focused lower-level tests for distinct logic. A fake-protocol
test validates Piano's contract handling, not the real Pi release; a real-runtime smoke check serves
a different purpose.

## Feature verification map

For a new or substantially changed feature, give verification one starting place: its
`features/<feature>/README.md`, linking:

- the owning modules per runtime and their public interfaces;
- the relevant module tests;
- the `verify-piano` feature entry and browser journey or focused verification recipe.

Link that page from the feature's entry in the [verification map](../.agents/skills/verify-piano/features/README.md#features).
Keep implementation maps in the owning doc and user-facing steps in the feature recipe. Choose
coverage by the risk rules above; the map does not itself require new tests, duplicate tests or
separate guides for each runtime.

## UI evidence scope

Choose coverage by the changed contract:

- **Local cosmetic edit** (for example, swapping one icon or correcting display text): when
  interaction, accessibility, layout and shared styling are unchanged, inspect the affected
  element on scratch Piano and retain one after screenshot. Done when the intended appearance
  is visible and diff review confirms the change stays local. That check is sufficient: no
  before capture, replay of unchanged actions, viewport matrix or `style-shots.mjs` run is required.
- **Behavior, accessibility or layout change:** observe the affected journey or state, exercise
  changed actions and capture their answers. Cover additional viewports or input modes only
  where the changed contract depends on them. Done when each changed contract has an observed
  result; expand coverage for a concrete unresolved risk.
- **Shared styles or components:** for a shadcn upgrade or changes to shared `Piano*` styling or
  `index.css` tokens, run `test/browser/style-shots.mjs` before and after into separate directories
  and compare affected surfaces. Done when differences are explained; publish representative
  changed surfaces rather than the entire screenshot set. Follow the
  [upgrade procedure](shadcn-ui.md#upgrade-procedure) for shadcn upgrades.

Keep the PR evidence proportional too: a short observation and the relevant capture suffice for
an isolated cosmetic edit. The repository's code-check gates still apply.

## Browser tests

Browser evidence for a change is an observation through `agent-browser` on a scratch instance,
kept in the PR. It becomes committed only as a step in an existing journey, when a regression is
likely to recur. The committed journeys in `test/browser/` are the critical paths and run in CI.

On macOS `open-session.mjs` skips its copied-content check, so only a Linux run or CI covers it.

For production startup observations, run `npm run build` first, then prefix a journey with
`PIANO_BROWSER_PRODUCTION=1`: the harness serves the existing `web/dist` and does not rebuild.

## Alignment

A transcript row's gutter glyph centres on its content's first text line, so content must not pad
its first line: a folding row (`disclosureRow`) keeps its padding outside the flow with negative
margins. `test/browser/transcript-rows.mjs` measures it; add a new row kind to its `messages` and
`expected` lists.

## Evidence directories

Keep local verification evidence in one root, `~/piano-evidence/`, shared across Piano worktrees.
Group checks under a uniquely allocated task/run directory rather than creating new top-level
folders in home. Before running checks, allocate a run in the shell that will invoke them:

```sh
mkdir -p "$HOME/piano-evidence"
# Replace short-task-name with an issue ID or task slug.
EVIDENCE_RUN=$(mktemp -d "$HOME/piano-evidence/short-task-name.XXXXXX")
export VERIFY_EVIDENCE="$EVIDENCE_RUN/manual"
```

Pass a separate child path to each explicit-output command, such as
`npm run verify -- "$EVIDENCE_RUN/baseline"` or
`node test/browser/start-session.mjs "$EVIDENCE_RUN/start-session"`. For retries or before/after
comparisons, use new child paths or allocate another run; preserve earlier output. Manual
`verify-piano` launches use `VERIFY_EVIDENCE` as their parent and append their own run ID.
It does not configure the baseline or browser harness: those need the positional path.

## File evidence provenance

`scripts/verification-evidence.mjs` defines what a `run.json` records and excludes. Review logs,
paths and screenshots for private information before publishing them on the PR.

A leftover **running** record is incomplete, never a pass: inspect its owned resources by hand
before replacing it. A baseline gate passes on exit 0, so report skipped-test counts and reasons
from its log. Checks run in the live checkout: run uncontended, and report an **unstable** or
**unknown** result, or known concurrent edits, as inconclusive and rerun. A pass is a bounded
observation of the executed assertions; the PR still names the claim and any checks not run.

## Completion evidence

In the PR, summarize what changed, what evidence supports it, the tested revision/environment and
any material gaps. For new or substantially changed features, name the starting document from the
[feature verification map](#feature-verification-map). Give the test lines `npm run verify`
reported and the [ladder](#when-to-add-a-test) rung each added test stands on, or say why existing
coverage was sufficient.

Evidence belongs to the PR, not the repository. Do not commit per-issue verification reports,
captured output, screenshots or recordings, including under `docs/`. When a change settles a
lasting policy or contract, record it in the document that owns that area.

Changes to acceptance criteria, tests or gates must expose the intended contract change for
review. Distinguish a failing check from a check that could not run; neither is a pass.
