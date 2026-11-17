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
4. Retain evidence tied to the tested revision (including dirty changes), environment and commands,
   on the PR: summarize it in the description and include output, screenshots or recordings through
   a supported publication route. On exe.dev, follow [PR evidence](development-on-exe-dev.md#pr-evidence)
   for publication limits and the non-blocking fallback. Do not commit evidence to the repository;
   see [Completion evidence](#completion-evidence).
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
| Browser–server request or reply (`ClientMessage`/`ServerMessage` in `shared/wire.ts`, endpoints in `shared/http.ts`) | Module test through the handler: `test/ClientDispatch.test.ts` for socket messages, `test/Api.test.ts` for HTTP; `test/PeerScope.test.ts` when a remote may send it. |
| RPC lifecycle, reconnect, dialog race | Deterministic fake-Pi contract test through PiSessions; browser observation when UI behavior changes. |
| Git/Worktrunk lifecycle semantics | Integration check in a throwaway repository against the supported version; a mocked CLI alone cannot establish compatibility. |
| User interaction, rendering or preview identity | Observe the affected browser journey, including relevant error/empty states; retain a regression test when recurrence warrants it. |
| Pi/runtime dependency upgrade | Existing suites/typechecks plus the compatibility and scratch-browser checks in INV-12. |
| Refactor with unchanged behavior | Existing relevant tests and typecheck; add a test only for a meaningful uncovered risk. |

Avoid proving the same behavior at every layer. Use a small number of integration/browser checks
where boundaries matter, backed by focused lower-level tests for distinct logic. A fake-protocol
test validates Piano's contract handling, not the real Pi release; a real-runtime smoke check serves
a different purpose.

## Feature verification map

For a new or substantially changed feature, give verification one starting place: a
`docs/<feature>.md` page, or the existing owning page, linking:

- the owning modules per runtime and their public interfaces;
- the relevant module tests;
- the `verify-piano` feature entry and browser journey or focused verification recipe.

Link that page from the feature's entry in the [verification map](../.agents/skills/verify-piano/features/README.md#features).
Keep implementation maps in the owning doc and user-facing steps in the feature recipe. Choose
coverage by the risk rules above; the map does not itself require new tests, a folder migration or
retroactive documentation of unchanged features.

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
likely to recur. Install agent-browser and Chromium as
specified in [development setup](development.md#setup); journeys use the CLI on `PATH`. The committed browser
tests are only the critical paths, which must keep working on every change and run in CI:

- `test/browser/start-session.mjs`: choose a folder, model, effort and project; send the first
  message; see the reply; reload without resending.
- `test/browser/open-session.mjs`: open a session from the sidebar; read its transcript; jump to an
  earlier message; read the session cost; send a follow-up and see the reply and updated cost;
  stop a running reply.
- `test/browser/remote-session.mjs`: a main and two independent scratch peers with colliding
  workspace/session identities; list existing sessions, continue each, switch/back/forward with
  isolated drafts/catalogs, answer a dialog, disconnect/reconnect/reload without replay, and Stop
  on the same remote generation/PID. One unavailable peer cannot stop the other's stream or
  redirect input. Local receives no remote prompt or HTTP/socket request. A project created on a
  peer takes a session there, and Local does not list it. A remote session's Changes, a file
  opened from it and its session rail read the peer, never Local. Trusting a folder on a peer
  leaves Local's trust for the same path as it was. Each machine's model list and last directory
  are stored under its own ID, and a machine no longer configured is forgotten on load. The harness's optional
  `peers` fixtures each own separate database/history/audit; `remote` is the one-peer shorthand.

`npm run test:browser` runs these and the transcript-row alignment check against scratch registries, Pi history and
`test/browser/fake-pi.mjs`, with no model calls. They drive the UI by role and accessible name and
assert what a user sees and what Pi receives, not markup. Add a journey only for a new critical
path; cover rules and edge cases with module tests. Earlier documents cite `test/browser-*.mjs`
scripts as the evidence of their time; those scripts no longer exist. On macOS
`remote-session.mjs` skips (exit 0, no `run.json`) and `open-session.mjs` skips its copied-content
check, so only a Linux run or CI covers them.

For production startup observations, first run `npm run build` in the checkout being tested, then
prefix a journey with `PIANO_BROWSER_PRODUCTION=1`. The same isolated backend serves that
`web/dist` build through `server/main.ts`; no Vite process runs. The harness records this mode in
`run.json`. Rebuild after source changes: this opt-in mode deliberately does not build for you.
For example, `PIANO_BROWSER_PRODUCTION=1 node test/browser/open-session.mjs /tmp/piano-open`.

### Managed preview host journey

`node test/browser/preview.mjs <evidence-directory>` is an opt-in journey on macOS (launchd, in a
logged-in session) or Linux (systemd, with an existing lingering user manager), separate from
portable CI. It needs free ports 9400–9479. It reads the origin from `PIANO_PREVIEW_CONFIG` when set,
otherwise uses `http://localhost` on macOS and `https://<os.hostname()>.exe.xyz` on Linux; on Linux,
Vite's allowed host comes from that origin. Only the origin is reused: ports and state remain
scratch-only. On macOS it opens the agent's `localhost` link itself.
It uses the real installed Pi with a scripted loopback model (no credentials), scratch HOME/Pi
history/database, and unique managed services. It checks prompt → tool → preview link, the session
rail and header external links, same-sheet Preview pane in narrow and desktop single-area layouts,
on-demand details/logs and distinct palette rows, then original-instance survival through settlement,
abort, browser disconnect, session switching and a short idle timeout. Reload finds the same instance.
**Stop preview** in the rail or sheet asks before stopping it, leaves the session answering and
permits idle retirement. It checks unknown/failed-stop inspection with an unreadable scratch intent,
a non-owning session, and replacement while confirmation is open: the old confirmation cannot stop
the new app, and no old URL remains while the replacement is starting. It checks Pi SIGKILL and
Piano SIGTERM/SIGKILL cleanup before reopening/restarting, no adoption on reopen, archive/delete via
the palette with confirmations that name the app, and cleanup after checkout removal. A child
ignores TERM to exercise the kill bound. Only its scratch services stop; native platform gaps must
be reported.

With a loopback origin (the macOS default http://localhost, or on Linux PIANO_PREVIEW_CONFIG
pointing to a JSON file containing {"origin":"http://127.0.0.1"}), it also observes the actual
external tab and app interaction/HMR. No app iframe or Preview Surface tab is created; Changes and
file inspection remain separate. Authenticated external exe.dev access is a separate manual
observation; this journey does not grant access or change proxy configuration. See
[managed previews](live-previews.md).

`PIANO_TEST_NATIVE_PREVIEW=1 node --test test/PreviewNative.test.ts` is the smaller opt-in native
runner/supervisor check for clean exit, nonzero exit, application signal, explicit stop and owner
disconnect. It uses temporary owners/workspaces/state and ports 9480–9519; it has the same native
supervisor prerequisites. Portable runner tests also cover spawn errors without a supervisor.
Report the platform actually run; simulated launchd output is not native macOS evidence.

## Alignment

Every transcript row is a gutter glyph beside its content (`Row` in `MessageList.tsx`). The glyph
box is one line tall and centres on the content's first text line, so content must not pad its
first line: a folding row (`disclosureRow`) keeps its padding outside the flow with negative
margins. `node test/browser/transcript-rows.mjs` seeds a session with every row kind and fails
when any glyph is more than 1px off its line; a new row kind is added to its `messages` and
`expected` lists. The same measurement, for a scratch instance with the row on screen:

```bash
agent-browser eval "$(cat <<'JS'
(() => [...document.querySelectorAll('[data-slot="gutter"]')].map((gutter) => {
  const glyph = gutter.firstElementChild;
  const walker = document.createTreeWalker(gutter.nextElementSibling, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.textContent.trim() && !n.parentElement.closest('.sr-only') ? 1 : 2,
  });
  const text = walker.nextNode();
  if (!glyph || !text) return null;
  const range = document.createRange();
  range.selectNodeContents(text);
  const line = range.getClientRects()[0], box = glyph.getBoundingClientRect();
  return { text: text.textContent.trim().slice(0, 40), offset: Math.round((box.top + box.bottom - line.top - line.bottom) / 2) };
}).filter(Boolean))()
JS
)"
```

`offset` is the glyph centre minus the first line's centre, in pixels; every row passes at 0 or
±1. Keep the output with the screenshot: the screenshot shows the row, the numbers show it is
aligned.

## File evidence provenance

`npm run verify -- <evidence-directory>` and `test/browser/harness.mjs` write `run.json`, command
logs and (for browser journeys) screenshots and fake-Pi audits outside scratch state. Defaults are
ignored `.scratch/verify/<run-id>` and `.scratch/browser/<journey>`; use a fresh explicit directory
for durable comparisons. Cleanup removes only the run's disposable state, not evidence. Temp
cleanup may eventually remove `/tmp`; publish the relevant output on the PR. Review logs before
publication: source/config **bytes** are not in the fingerprint manifest, but paths, output and
screenshots can still contain private information.

The version-1 revision capture records HEAD, the index's stages/object IDs/modes, and SHA-256 of
all tracked and non-ignored untracked file bytes, with paths, working-tree permissions, deletions
and symlink text. Thus two edits to the same dirty path differ, as do stage/unstage operations.
Symlinks are identified, not traversed: internal targets must also be in the captured path set;
external/uncaptured targets, submodules, unreadable inputs and unsupported file kinds make
provenance **unknown**, not passed. Root and web `.env*` files are included even if ignored;
production browser mode also hashes the existing `web/dist` tree. It identifies the served build,
not proof that the build came from the current source: rebuild first.

Exclusions are explicit in each record: other ignored/generated files, installed dependency
**bytes**, external configuration and services are not snapshotted. The lockfile is captured and
installed direct dependency versions recorded; use `npm ci`, not hand-edited dependencies. Vite
regenerates `web/public/pdfjs` from installed `pdfjs-dist`; this derived directory is excluded.
Node/OS/architecture, npm/Git/Worktrunk and (for browsers) agent-browser/browser versions, cwd,
argv, safe environment fields, journey name, process commands/isolated state paths and timestamps
identify the execution. Browser preflight requires Git and agent-browser. A journey that uses
Worktrunk declares `requiresWorktrunk: true` in its harness options (currently `start-session`);
missing `wt` then blocks before backend/browser startup. Otherwise npm/Worktrunk versions are
optional observations, recorded as unavailable when absent. The baseline still requires Worktrunk
for its lifecycle module test. Journey-supplied backend overrides have a digest and key list, not secret
values; report external overrides needed for reproduction separately. This is not a full environment
snapshot, a product evidence engine or implementation of all INV-08/09 target contracts.

The harness persists **running** before setup, and a terminal result only after cleanup. Failed
assertions are **failed**; missing prerequisites are **blocked**; execution/cleanup problems are
**error**. SIGINT/SIGTERM are **cancelled** and trigger owned cleanup. SIGKILL/host loss cannot run
finalizers: a leftover **running** record is incomplete, never a pass, and needs manual owned-resource
inspection before replacement. The baseline marks unexecuted gates **not-run**. A baseline gate passes on command exit 0, not
on a claim that every subtest ran: retain/report skipped-test counts and reasons from its log.
Browser setup
failures also retain a record and remove their scratch root. A helper file exiting zero without
calling the harness is not a journey result.

Checks run in the **live checkout**, not an immutable snapshot. Start/end capture differences yield
**unstable**, capture problems yield **unknown**; both exit nonzero even if assertions passed.
Matching endpoints mean only `endpoints-match`: they cannot exclude transient edits (including
during capture), dependency mutation or external environment changes. Run uncontended, report
known concurrent edits as inconclusive and rerun. Do not infer an atomic snapshot, complete race
detection, automatic reuse after a commit/rebase, or acceptance of an entire feature from a pass.
A pass is the bounded observation of executed assertions with the recorded limitations. The PR
still names the acceptance claim/invariants and any checks not run (INV-07–09, INV-11, INV-13).

Harness failure/cleanup probes, separate from the critical-path suite:

```sh
node test/fixtures/verification-journey.mjs /tmp/piano-setup-failure setup
node test/fixtures/verification-journey.mjs /tmp/piano-journey-failure failure
node test/fixtures/verification-journey.mjs /tmp/piano-cancelled cancel
```

These deliberately exit nonzero. Inspect `run.json` for the intended error/cancellation, retained
logs/captures, `cleanup.outcome`, removed scratch path and exited owned PIDs; exit failure alone is
not evidence that the intended failure was exercised. They use the same scratch harness, never
live Piano. The module suite covers capture identities, baseline outcomes/cancellation and setup
failure without requiring a browser installation.

## Completion evidence

For code or dependency changes, run the [baseline](development.md#setup).
Run build or other checks when the changed surface requires them. Observe affected application
behavior through `agent-browser` on a scratch instance that
[the `verify-piano` skill](../.agents/skills/verify-piano/SKILL.md) launches.

In the PR, summarize what changed, what evidence supports it, the tested revision/environment and
any material gaps. For new or substantially changed features, also name the starting document
from the [feature verification map](#feature-verification-map). Mention whether a regression test was added or
why existing coverage/inspection was sufficient. Short explanations are enough; do not create a
second evidence database in the registry or a large ritual for small edits.

Evidence belongs to the PR, not the repository. Do not commit per-issue verification reports,
captured output, screenshots or recordings, including under `docs/`; `docs/research/` holds
research notes. When a change settles a lasting policy or contract, record it in the document that
owns that area, such as [runtime ownership](runtime-ownership.md).

Never weaken a required assertion just to make a change green. Changes to acceptance criteria,
tests or gates must expose the intended contract change for review. Distinguish a failing check
from a check that could not run; neither is a pass.
