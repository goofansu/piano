# Evidence-based development and testing

The goal is justified confidence in changed behavior, not more tests or a coverage percentage.

## The development loop

Before changing behavior, name the claim, relevant invariant and smallest check that could disprove
it. Inspect existing coverage first. For a bug, reproduce it before fixing it when feasible, then
show the same check passing; that reproduction is PR evidence. Every check you report must be able
to go **red**: seen failing before the fix or with the change reverted, or naming the observation
that would differ if the change were broken. Drop a check that would stay green with the change
broken; it is decoration, not evidence. Commit a regression test only for a meaningful failure that
is not already protected, by the [test ladder](#when-to-add-a-test). Test observable contracts, not
private helpers or mock choreography.

Ground new fallback states, retries and compatibility branches in observed reproducible behavior,
documented supported contracts or explicit requirements. Fake or mutated external replies alone
do not establish a real bug. Trust documented guarantees while retaining ordinary boundary
validation and required security/resource protections. For a hypothetical upstream contract
violation, report uncertainty or ask before expanding product behavior.

- Do not invent a reproduction result.
- For a regression, show failure before the fix and success after it when feasible, and check
  that the failure was the intended defect, not a broken fixture or missing dependency.
- On exe.dev, `gh pr comment --attach` fails: the VM's GitHub access rejects uploads. Put textual
  results in the PR and say that visual evidence was captured locally, not published.
- A passing test proves only its assertions; a build or agent summary proves no user journey.
- For a behavior claim, read the result from state: a reply, a database row, DOM text. A
  screenshot proves appearance; pair it with a read value when the claim is about behavior.

## What to add and run

| Change | Verification |
| --- | --- |
| Documentation or comments only | Review accuracy, links and the diff; confirm no runtime or tooling directives changed. No tests or app run needed. |
| Logic, protocol or lifecycle behavior | Cover an uncovered failure at the public boundary by the [test ladder](#when-to-add-a-test), in a focused module test. Run `node --test --import ./test/setup.ts features/<feature>/test/<name>.test.ts`. |
| Application behavior | Observe the affected journey on a [scratch instance](#scratch-instance), using an existing browser journey or a focused `agent-browser` check. Module tests alone do not prove the user journey. |
| UI strings, controls or styling | Apply [Quiet UI](quiet-ui.md) and choose evidence by the [UI evidence scope](#ui-evidence-scope). |
| New critical path | Add a journey in `test/browser/`; otherwise extend relevant existing coverage rather than adding another browser journey. |
| New transcript row kind | Extend and run `node test/browser/transcript-rows.mjs <evidence-directory>`; see [Alignment](#alignment). |

Locally, run only the checks your claims need, keeping output under the
[evidence root](#evidence-directories). CI is the baseline: on every PR it runs typecheck, lint,
build, the full module suite, the critical-path journeys and `npm run test-changes`. Run an affected
journey with `node test/browser/<journey>.mjs <evidence-directory>`, and anything beyond a row's
check only for a named risk it leaves open. `npm run verify` runs the full baseline locally when CI
cannot. Keep assertions at full strength; give each skip or net-removed assertion that Test changes
flags a reason in the PR. Stop once the claim and relevant risk are covered and CI passes.

### Fresh-context review

For logic, protocol, lifecycle, application behavior or test changes, before opening the PR give a
fresh-context reviewer (a subagent without your reasoning) only the diff and the
[verification block](#completion-evidence). Ask which check would stay green if its claim were
broken, what breakage no check covers, and where the code falls short of AGENTS.md and the documents
it routes to. Fix each finding or answer it in the PR. Documentation, comments and other local edits
skip the reviewer unless a named risk calls for one.

### Scratch instance

Use `verify-piano` for scratch launch, doctor, browser checks, evidence and cleanup. Committed
browser journeys own their scratch setup; do not launch another instance beside them. Leave the
user's real Piano, backend and database alone (local 7070; exe.dev 8000/8001).

Prefer fake Pi; when a real model call is needed, prompt "Reply with exactly: X" and read it back.

## When to add a test

A reproduction is PR evidence; a committed test is a contract kept for good. Take a meaningful
behavior, boundary or regression that existing checks miss down this ladder and stop at the first
rung that holds:

1. **Close the class.** When the defect is one instance of a rule that a type, lint rule or shared
   boundary can enforce, enforce it there and test the rule once.
2. **Extend a case.** When an existing test states the contract, give it the failing input. Inputs
   that differ only in shape or size, such as path names, counts or encodings, share one table.
3. **Add a test** for a contract no existing test title states, at the smallest reliable boundary.

`npm run test-changes` prints the lines changed in `test/` and `features/*/test/` since `origin/main`. A behavior-preserving
refactor adds no more test lines than it removes; when it adds more, name the uncovered risk each
added test protects. It also lists added `skip`, `only` and `todo` markers and flags assertion lines
removed beyond those added. A line-based heuristic, it misses assertions inside callbacks and
can flag an unrelated `only:` property; read its list rather than trusting the count.

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

When changing HTML previews, use a scratch browser to check that page scripts stay disabled and that opening local links stays under Piano’s control. After a React-PDF upgrade, check the installed `react-pdf` and `pdfjs-dist` versions, the emitted worker and assets, and a PDF rendered in the browser.

## Feature verification map

For a new or substantially changed feature, update its recipe in `features/<feature>/verify/` and its entry in the [verification map](../.agents/skills/verify-piano/map.md#features). Link to its user guide and identify the relevant module tests and browser journey or focused check there. Choose coverage according to the risk of the change.

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
margins. `test/browser/transcript-rows.mjs` measures it, since a screenshot alone cannot; add a
new row kind to its `messages` and `expected` lists.

## Evidence directories

Keep local verification evidence in one root, `${TMPDIR:-/tmp}/piano-evidence/`, shared across
Piano worktrees. Group checks under a uniquely allocated task/run directory. The system may clear
the temporary directory after a reboot or days of disuse, so attach evidence to the PR before then.
Before running checks, allocate a run in the shell that will invoke them:

```sh
EVIDENCE_ROOT="${TMPDIR:-/tmp}/piano-evidence"
mkdir -p "$EVIDENCE_ROOT"
# Replace short-task-name with an issue ID or task slug.
EVIDENCE_RUN=$(mktemp -d "$EVIDENCE_ROOT/short-task-name.XXXXXX")
export VERIFY_EVIDENCE="$EVIDENCE_RUN/manual"
```

Pass a separate child path to each explicit-output command, such as
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

Report evidence in the PR as one verification block, one row per claim:

```markdown
Revision: <commit> · <OS, Node, fake or real Pi>

| Claim | Check | Goes red when | Result |
| --- | --- | --- | --- |
| Reopening a session restores its draft | `node test/browser/open-session.mjs` | the fix is reverted (seen) | pass |

CI: <Quality gates and each Critical paths result>; Test changes: <the test lines and test weakening lines it printed>
Not checked: <claim or risk> — <why>
```

Keep each cell to a line and link or collapse logs; a reviewer reads the block, not the output.
For each skip or net-removed assertion that Test changes flagged, give its reason under the block. For new or
substantially changed features, name the starting document from the
[feature verification map](#feature-verification-map). Name the [ladder](#when-to-add-a-test) rung
each added test stands on, or say why existing coverage was sufficient.

Evidence belongs to the PR, not the repository. Do not commit per-issue verification reports,
captured output, screenshots or recordings, including under `docs/`. When a change settles a
lasting policy or contract, record it in the document that owns that area.

Changes to acceptance criteria, tests or gates must expose the intended contract change for
review. Distinguish a failing check from a check that could not run; neither is a pass.
