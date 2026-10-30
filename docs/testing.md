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
   on the PR: summarize it in the description and attach output, screenshots or recordings with
   `gh pr comment --attach`. Do not commit evidence to the repository; see
   [Completion evidence](#completion-evidence).
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

### Managed preview host journey

`node test/browser/preview.mjs <evidence-directory>` is an opt-in journey on macOS (launchd, in a
logged-in session) or Linux (systemd, with an existing lingering user manager), separate from
portable CI. It needs free ports 9400–9479. It reads the origin from `PIANO_PREVIEW_CONFIG` when set,
otherwise uses `http://localhost` on macOS and `https://<os.hostname()>.exe.xyz` on Linux; on Linux,
Vite's allowed host comes from that origin. Only the origin is reused: ports and state remain
scratch-only. On macOS it opens the agent's `localhost` link itself.
It uses the real installed Pi with a scripted loopback model (no credentials), scratch HOME/Pi
history/database, and unique managed services. It checks prompt → tool → preview link, the session
header's preview menu, its details and logs, and the palette rows, local browser load and HMR, then original-instance survival through settlement, abort, browser disconnect,
session switching and a short idle timeout. Reload finds the same instance. **Stop preview** in the
header menu stops it and leaves the session answering, and permits idle retirement. It checks
Pi SIGKILL and Piano SIGTERM/SIGKILL cleanup before reopening/restarting, no adoption on reopen,
archive/delete via the palette, with confirmations that name the app, and cleanup after checkout
removal. A child ignores TERM to exercise
the kill bound. Only its scratch services stop; native platform gaps must be reported.
Authenticated external exe.dev access is a separate manual observation; this journey does not grant
access or change proxy configuration. See [managed previews](live-previews.md).

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

## Folder and registry benchmark

`test/performance-folder-registry.mjs` measures folder-picker and registry latency and event-loop
stalls against a scratch backend:

```sh
node test/performance-folder-registry.mjs .scratch/piano-performance.json
# Short controlled slow-folder reproduction (adds 1 ms to each filesystem metadata operation):
PIANO_BENCH_SLOW_ONLY=1 node test/performance-folder-registry.mjs .scratch/piano-performance-slow.json
```

Run it uncontended, apart from the test suite and browser checks. It requires Node 24, Git and Linux
`ss`. It starts `server/main.ts` on an ephemeral loopback port with a temporary SQLite registry,
isolated home/config/Pi directories and `test/fake-pi.mjs`, then deletes its scratch data after
stopping its own child; no credentials or model calls. JSON and backend logs are written beside the
output path, whose parent directory must exist. To compare before and after a change, copy
`test/performance-{folder-registry,monitor}.mjs` into a separate checkout of the base revision and
run them there too; never against a running checkout or the real registry.

## Sidebar sessions benchmark

`test/performance-sidebar-sessions.mjs` is an opt-in rendering benchmark, not a CI timing gate:

```sh
npm ci
npx agent-browser install
node test/performance-sidebar-sessions.mjs .scratch/sidebar-performance
# Override the session counts for a narrower comparison:
node test/performance-sidebar-sessions.mjs .scratch/sidebar-performance 2000 5000
```

Requires Node 24, Git and agent-browser/Chromium (the same prerequisites as the browser journeys).
The existing browser harness starts a scratch backend and Vite **development** UI on free loopback
ports, with isolated database, HOME and Pi directories, fake Pi and a throwaway repository. It
creates N saved session references and empty synthetic histories, all in Today, with no pinned,
archived or running sessions. No prompts or model calls; no live database/history. Recorded children
and scratch data are cleaned up even on failure. Output JSON and screenshots survive in the chosen
evidence directory; keep them on the PR, not in Git. Run uncontended, separately from test suites.

The default counts are 100, 500, 1,000 and 2,000, at 1280×900 without throttling. Each count gets a
fresh scratch instance and browser. After an untimed app bootstrap (warming Vite and selecting the
browser target), CDP installs instrumentation before application code and measures:

- **Navigation to rows ready:** reload to the initial sidebar window committed, then two animation frames
  (a paint opportunity, not a paint trace). First reload clears the browser HTTP cache; the next
  two retain it. This is cache-cold versus cache-warm, **not** cold process/server startup. Includes
  app startup, WebSocket registry delivery, development module loading, React and layout. JSON also
  retains the commit timestamp and observed long tasks; it is not isolated sidebar CPU time.
- **Group reopen:** three real Today button clicks after collapsing and observing zero mounted
  rows. Time starts at the captured browser click, ends two animation frames after the window mounts;
  CLI invocation latency is excluded. This does not time completion of the disclosure animation.
- **Scroll cadence:** three 3-second requestAnimationFrame probes, advancing scrollTop by 120px
  each frame and reversing at the ends. JSON reports frame count, effective rate, p95/max interval,
  intervals over 34ms and distance actually travelled. This measures main-thread cadence during
  scripted scrolling, **not** compositor FPS or input-to-pixel latency. Large lists need not reach
  the bottom. Assertions bound mounted rows independently of N, then jump to the middle and bottom
  and verify contiguous visible rows. For N ≥ 100, untimed checks also retain the actual focused/menu
  node while scrolling, Tab/Shift+Tab through it, dismiss its menu with focus restored, and verify
  the offscreen row unmounts once neither focus nor menu needs it. Pin/Unpin at the list's end
  checks that a shrinking window never reads past the new session count.
- **Memory/DOM:** whole-page CDP JS heap after explicit GC, DOM node/listener counts and sidebar
  element count. Not browser RSS or sidebar-only heap. Screenshots show the actual tested surface.

The implementation path is `web/src/store.ts` (registry snapshot) →
`web/src/lib/sessionCatalog.ts` → `sidebarList.ts` / `sidebarView.ts` (filter/group/sort, cached
against sidebar facts) → `useSidebarList.ts` → `web/src/components/Sidebar.tsx`.
`SessionRows` uses `useSidebarWindow.ts` to mount visible rows plus five rows of overscan on each
side, against the shared Radix `ScrollArea` viewport. Group headers stay in normal flow. A CSS ruler
measures the existing responsive row heights and list gap/padding; each list preserves its full
scroll height. Stable session keys retain row identity through range updates. Focused rows, their
neighbours (including the nearest available sessions), open-menu anchors (through Radix focus
restoration), and each list's keyboard entry/exit rows stay mounted outside the window. Closed groups still unmount their rows. This bounds session
DOM by visible rows plus a small buffer per expanded group, not by sessions per group. It does not
virtualize group headers or paginate/filter the catalog.

Compare the raw runs, their environment/revision fields and repeated samples rather than treating
one machine's times as budgets. Before virtualization, the same instrumentation waited for all N
rows; use the base revision's harness for that comparison. Production builds, real wheel/touch
input, many-folder grouping, streaming and session selection are separate experiments. No new UI
strings, controls or actions are introduced.

## Completion evidence

For code or dependency changes, run `npm test`, `npm run typecheck` and `npm run lint` as the repository baseline.
Run build or other checks when the changed surface requires them. Observe affected application
behavior through `agent-browser` on a scratch instance that
[the `verify-piano` skill](../.agents/skills/verify-piano/SKILL.md) launches.
Documentation-only work needs document review and link checks, not a browser smoke test.

In the PR, summarize what changed, what evidence supports it, the tested revision/environment and
any material gaps. Mention whether a regression test was added or why existing coverage/inspection
was sufficient. Short explanations are enough; do not create a second evidence database in the
registry or a large ritual for small edits.

Evidence belongs to the PR, not the repository. Do not commit per-issue verification reports,
captured output, screenshots or recordings, including under `docs/`; `docs/research/` holds
research notes. When a change settles a lasting policy or contract, record it in the document that
owns that area, such as [runtime ownership](runtime-ownership.md).

Never weaken a required assertion just to make a change green. Changes to acceptance criteria,
tests or gates must expose the intended contract change for review. Distinguish a failing check
from a check that could not run; neither is a pass.
