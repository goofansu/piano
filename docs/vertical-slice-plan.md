# Verification-gated vertical-slice implementation plan

Research baseline: October 4, 2026, commit `aeeb220d5dea2087eb16124556ccbf80e6d1a270`.
Status: proposed implementation breakdown; **no phase is certified by this plan**.
Scope: turn the existing session UI into the workspace/evidence workbench in
[ADR 0001](adr/0001-pi-rpc-workspace-workbench.md). This does not authorize implementation,
change the ADR, or widen access to the running development instance.

## 1. What the research establishes

Read all repository direction, invariant, roadmap, glossary, testing, development/hosting and
research documents. The [current source audit](research/2026-10-04-vertical-slice-baseline.md)
separates existing implementation/coverage from inferred risks. Runtime details were checked against
the installed Pi 1.0.2 documentation; Worktrunk's official list/merge/remove/hook references and
installed 0.80.0 command help inform the lifecycle plan. These are documentation/source observations,
not fresh application verification. Primary-source references are collected below.

### Authority and dated findings

- The ADR, [invariants](development-invariants.md) and [roadmap](roadmap.md) govern the target.
  The October 2 research is historical: do **not** revive evidence in registry JSON, HEAD-only
  invalidation, incremental transcript replay, or its old phase order.
- Pi 1.0.2 is already exactly declared, locked and installed. The
  [October 4 upgrade report](research/2026-10-04-pi-update-effort.md#evidence-and-limits) records tests,
  build and a real prompt/reload/effort roundtrip. Do not repeat the upgrade as new work or claim its
  limited smoke check completed INV-12: project MCP loading, dialog/abort races and other compatibility
  paths remain unverified there.
- Existing tests cover a streamed turn, late dialog attachment/answer, model/effort changes and crash,
  probe, and release notification. They do not establish concurrent host uniqueness, dialog races,
  ordered reconnect, revision validity, evidence or integration. Several tests synchronize with sleeps;
  replace those only when extending the affected case, using an observed subscription/event barrier.
- PiSessions already uses `agent_settled`, strict request correlation, retained dialogs, and a
  semaphore-protected snapshot/subscription. Preserve these working foundations. Missing disposition,
  expanded activity, deadlines and dialog claims are additions, not a runtime migration.
- Workspace revisions, managed applications, evidence storage and guarded integration are target
  capabilities, not existing ones. The current unused `listWorktrees` adapter hides command errors
  behind a root-only list; today's sidebar reads registry-backed views, not those structured observations.
- Worktrunk 0.80.0 is installed, but not yet enforced as a supported backend by Piano. Live web docs
  can evolve independently of this binary; help confirms available options, not operation semantics.
  Each lifecycle phase needs a throwaway-repository check against the supported binary.
- Machine-local exe.dev model metadata fixes are outside this repository. Fixtures must not depend on
  that extension being present, on an arbitrary global `pi`, or on the live developer registry.

### Decisions preserved

Keep one server-owned RPC child per canonical checkout/session identity; Pi owns history/configuration.
Keep protocol translation behind `PiSessions.open`, `probe`, and session `events`, `act`, `state`, using
`shared/wire.ts`. Keep Worktrunk behind the lifecycle adapter and Git authoritative for exact content.
Registry stores selection, workspace/session references and preferences, not executions/artifacts.
Evidence and integration are separate from agent activity. Skills never award verification.

New domain modules should hide capture, execution or approval complexity behind small observable
interfaces. Introduce them with a caller and a complete journey, not as unused scaffolding. Module
names below describe responsibilities, not a mandated class/file inventory.

## 2. How a phase earns completion

A phase is a thin **user journey through storage/execution → wire → browser**, including its important
failure outcome. Do not finish a backend-only phase and leave the observable contract for a later UI
phase. A phase can contain several small PRs, but its gate applies to the assembled journey.

For every implemented phase:

1. Name the acceptance claim and affected invariant IDs before editing. Reinspect current coverage;
   add/extend a regression only for a meaningful uncovered defect.
2. Use the smallest falsifiable check listed below. Pi protocol tests use the PiSessions interface and
   scripted fake Pi, not private translators. Host/routing contracts are observed through public
   server operations with real fake-Pi subprocesses. Domain modules use their caller-facing interfaces;
   Git/Worktrunk compatibility uses real scratch repositories. No mocked CLI can prove backend semantics.
3. Observe the changed browser journey through `agent-browser`, including the named failure state,
   and retain output. Fake Pi handles races/faults; paid prompts are short compatibility/product checks,
   not race generators. Open Radix menus/popovers with browser pointer clicks.
4. Run `npm test` and `npm run typecheck` for code/dependency changes. Run `npm run build` for runtime
   dependency, bundling, asset or production-serving changes; do not treat a build as journey evidence.
5. Record the actual revision **including dirty content**, environment/tool versions, claim, command
   and observed result, artifacts and remaining limitations. A blocked check is not a pass. Stop when
   the relevant claim/risk and required gates are covered; do not rerun every invariant scenario.

Retain a small evidence packet per implementation phase outside the registry: tested commit plus dirty
patch/input digest, effective Pi CLI path/version and arguments, Node/Effect/Worktrunk versions, relevant
fixture/check/requirement versions, command outcomes, browser observations and artifact paths. Keep
secrets out of exported records. Missing output cannot substantiate a claimed observation.

### Isolation for all implementation checks

Use a created scratch directory, registry, throwaway Git repository and isolated Pi agent/session
storage as appropriate. The static/browser instance is:

```bash
HOST=127.0.0.1 PIANO_DB_PATH=<scratch-path>/piano.db PORT=7171 node server/main.ts
```

Retain its PID; stop only processes you started. Register only scratch directories, remove scratch
worktrees/branches and the exact scratch session files afterward. Never restart the user's instance
(on 7070 or the hosted 8000/8001 services), change its registry, or blanket-clean Pi's session store.
Keep private authenticated access and loopback binding throughout. Preview isolation is not permission
to expose the control plane. See [the development handoff](development-on-exe-dev.md).

## 3. Sequence and checkpoints

| Phase | Completed user-visible slice | Depends on | Roadmap milestone |
| --- | --- | --- | --- |
| 0 | Record compatibility baseline and remaining failures | Existing upgrade | 1, checkpoint only |
| 1 | Submit and understand what Pi did | 0 | 1 |
| 2 | Answer, expire or abort a dialog safely | 1 | 1 |
| 3 | Inspect faithful, safely projected session output | 1–2 | 1 |
| 4 | Leave/return without duplicate or wrongly retired work | 1–2 | 1 |
| 5 | Reconnect or switch sessions into an ordered current view | 3–4 | 1 |
| 6 | Discover/create a worktree without invented healthy state | 0 | 1 |
| 7 | Identify the workspace and exact changed content | 5–6 | 2 |
| 8 | Dropped: Piano-specific Checks runner and configuration | — | — |
| 9 | Run the intended workspace's app and inspect its logs/preview | 7 | 2 |
| 10 | Repeat a browser check and assess bounded task readiness | 9; verification design review | 3 |
| 11 | Prepare a candidate without integrating it | 6, 10 | 3 |
| 12 | Approve and locally integrate exactly that candidate | 11 | 3 |
| 13 | Clean up separately and recover truthful lifecycle outcomes | 9, 12 | 3 |

**Current priority (October 5):** the user wants a joyful everyday web experience before deeper
workflow features. Phases 9–13 are deferred for focused UX improvements to the existing product;
see the [roadmap priority](roadmap.md#current-priority-joyful-daily-use) and
[first UX pass](research/2026-10-05-daily-ux-first-pass.md). Runtime contracts remain in force;
this does not require full TUI parity or revive Phase 8.

The [outcome-project slices](outcome-projects.md) complement that daily-use priority.
Step 1 grouping is implemented; [evidence](research/outcome-projects-step1.md) records the gates.
Shared context/instructions remain deferred. These slices are not a new prerequisite for this table,
do not renumber its phases, and do not resume phases 9–13.

When deeper workflow work resumes, use the dependency order above. Do not parallelize two writing
tasks in one checkout; use separate workspaces and explicit handoffs. No unsupported time estimates:
size PRs around claims, not a speculative calendar.

**Runtime checkpoint (0–6):** remaining Pi compatibility observations, fake-Pi failure/race gates and
Worktrunk discovery/create compatibility are recorded. No automatic prompt resubmission.

**Workspace loop (7, 9):** prompt → changes/diff → intended running app → inspect → follow up.
Phase 8 was dropped at the user's request. Phases 10–13 require a revised verification design based
on existing project tools before implementation; they do not authorize restoring the custom runner
or defining a replacement check schema.

**Controlled integration checkpoint (10–13):** a real feature meets versioned criteria; edits block old
approval; integrate and cleanup have independent, recoverable outcomes. Measure the returning
human's decision time, not merely the number of green checks.

## 4. Phase contracts

### Phase 0 — Compatibility checkpoint, not another dependency upgrade

**Claim:** the effective locked runtime loads the selected checkout's Pi environment and supports the
interaction contracts this plan relies on. **INV-01, INV-11–12.**

- Reuse the recorded 1.0.2 upgrade evidence where its environment/revision is still applicable; record
  effective CLI/override path and version. No dependency rewrite is needed at this baseline.
- Close the remaining compatibility gaps with a small normal-CLI fixture: command-triggered supported
  dialog after readiness, project-local MCP override over a disposable global MCP definition,
  model/effort state, abort and explicit child exit. Use a local stdio sentinel server and compare a
  trusted project disabling it with a control where it connects; disabled globally/broken MCP must
  not falsely pass. `/mcp` is a no-model inspection command, not a hosted tool invocation.
- Respect Pi's project trust: headless RPC cannot show its built-in trust prompt and may skip project
  resources. Use scratch-only explicit trust plus an untrusted control, never automatic production
  `--approve` or a second trust/config loader. Preserve built-in MCP; `--no-extensions` would invalidate
  this fixture. Isolate HOME/agent/session resources and credentials, disable cache warming, and use
  only local fixture commands/endpoints; offline mode alone does not prevent extension/MCP traffic.
- Source inspection identifies a separate blocking `session_start` dialog risk before RPC attaches
  its stdin reader. Reproduce it without a model call if startup support is in scope; retain an
  explicit limitation and bounded startup failure rather than claiming command-triggered dialogs
  prove arbitrary startup UI works.
- **Smallest check:** deterministic fake-protocol suite plus real 1.0.2 fixture observations. Compare
  fixture-loaded settings/tool identity with Pi facts, not Piano's reconstruction of config files.
- **Browser gate:** answer the supported dialog, abort a fixture wait and observe exit/reload without
  a fictional continuation. The earlier paid prompt/reload check need not be repeated for unchanged
  behavior; repeat a short exact-response prompt if the runtime/loading path changes.
- **Stop:** this research/fixture checkpoint records outcomes, not implementation acceptance. If a
  fixture exposes a defect assigned to phases 1–5, retain its failing evidence and proceed to the
  fixing slice. Reobserve each affected real-runtime fixture at the 0–6 checkpoint before declaring
  runtime completion; an unresolved compatibility failure cannot be waived by a fake-Pi pass.

**Observed checkpoint:** [October 4 implementation evidence](research/2026-10-04-phase0-compatibility.md)
records real MCP/trust controls, supported dialog/abort/exit/browser observations and the readiness
error fix. Its idle command-dialog abort failure is fixed and reobserved in the
[Phase 2 evidence](research/2026-10-04-phase2-dialog-lifecycle.md). Awaited startup dialogs remain
unsupported with bounded failure. The checkpoint is implemented, not full runtime acceptance.

### Phase 1 — Submit a prompt and explain its disposition/activity

**Claim:** submit once; display started, queued, handled, rejected or delivery-uncertain truthfully,
without waiting for a run that never starts or calling `agent_end` settled. **INV-02–03, INV-12.**

- Carry prompt disposition into wire/UI. Keep submission handling separate from session execution;
  expose queue, waiting, compaction, retry and exit facts without inventing one misleading status.
  Ordinary browser submissions should preserve extension-command semantics via `prompt` with explicit
  busy behavior, not cached-state routing to `follow_up` (which rejects extension commands). Ordinary
  input may reject during compaction; do not promise universal queueing. `handled` describes input
  consumption, not command success, and must not synthesize a finalized Pi user message.
- Retain existing `agent_settled` handling. Reconcile relevant Pi state after commands; a late response
  cannot roll back a newer operation. A timed-out accepted submission is not automatically retried.
- **Smallest check:** fake Pi handles input without `agent_start`, completes immediately, queues a
  follow-up, continues retry/compaction after `agent_end`, rejects, and withholds an acknowledgement.
  Observe disposition/activity through PiSessions with subscription installed before action.
- **Browser gate:** handled input returns to an explained usable composer; queued input is visible;
  retrying work stays active; uncertain delivery invites inspection rather than resubmission.
- **Stop:** these distinct outcomes are explained, baseline gates pass. Do not add steering controls,
  queue editing, compaction buttons or autonomous retries yet.

**Observed slice:** [Phase 1 implementation evidence](research/2026-10-04-phase1-prompt-activity.md)
records disposition/activity checks. The Phase 2 review additionally fixes command-state reconciliation
after answering a dialog; the broader runtime checkpoint remains open.

### Phase 2 — Resolve a supported dialog exactly once

**Claim:** competing answers, timeout and abort produce at most one Pi UI response; no abandoned
supported dialog blocks an extension or reappears on refresh. **INV-02–04, INV-12.**

- Claim dialogs before yielding to writes, keyed to the current child incarnation plus dialog ID;
  introduce this minimal generation identity now, with full event sequencing in phase 5. Handle
  dialogs before the originating prompt acknowledgement, including idle commands with no agent run.
- Retain advertised timeout, receipt time and an explicitly estimated host deadline; Pi owns the
  actual timeout and emits no ordinary closure/acceptance acknowledgement. Reject locally expired
  answers and update all tabs. Unobservable extension-owned signal cancellation remains a documented
  limitation requiring a bounded host recovery policy or explicit completion information, not an
  invented Pi closure event.
- Abort requests native cancellation and releases supported waiting dialogs without awaiting the
  abort acknowledgement. Cancel dialogs arriving during abort; scope late results to their operation.
  Pi's abort can continue remaining queued inputs: name/explain abort-current versus an explicit
  cancel-all policy and test that distinction rather than treating abort as release or implicit queue clear.
- UI responses have no normal RPC acknowledgement. Distinguish local claim/transport delivery from
  proof Pi consumed it; uncertain writes do not reopen a dialog and invite duplicate delivery.
- **Smallest check:** controlled fake-Pi barriers/clock for answer/answer, answer/timeout and
  abort/answer/new-turn races. Count actual `extension_ui_response` records at the fake-process seam;
  inject write/process failure and observe an explicit outcome. No arbitrary sleeps.
- **Browser gate:** two tabs see one resolution, original deadline survives reload, abort releases a
  blocking fixture and a newer turn is not cleared by an old acknowledgement.
- **Stop:** supported dialog lifecycle is closed and observable. Terminal-only `custom()` rendering
  stays unsupported and documented.

**Observed slice:** [Phase 2 implementation evidence and Phases 0–2 review](research/2026-10-04-phase2-dialog-lifecycle.md)
records atomic claims, child-scoped dialog identity, estimated deadlines, bounded host recovery,
abort-current semantics and uncertain transport outcomes. Module and two-tab browser gates pass for
supported post-readiness dialogs; startup/custom UI limitations and Phases 3–6 remain open.

### Phase 3 — Inspect faithful and safely projected session output

**Claim:** the live view converges to Pi's authoritative message and model facts; supported extension
state is visible, and known secrets/untrusted markup are not leaked or executed. **INV-01, INV-03,
INV-11–12.**

- Reconcile content-indexed `text_end`/`message_end`, tool-call endings, nested tool identities and
  cumulative usage. Nested execution previews are not additional transcript messages; count finalized
  parent usage once and obtain session totals from Pi, not the displayed current-context messages.
  Distinguish selected model from the physical model that answered, also after
  reopening the Pi file. Read selected model/effort back when Pi clamps or changes it. Make catalog
  observations relevant to the selected cwd; a home-directory probe cannot establish project-local
  models/resources or MCP overrides. Let Pi load them rather than building another configuration loader.
- Choose and document a consistent display scope: `get_messages` is Pi's current model-context view,
  not all raw history. Compaction/context edits and active-branch reopening must use authoritative Pi
  projections for the chosen scope, never concatenated stale cache or a second Piano context builder.
  Enforce this in code/tests; scope and protocol caveats are not permanent header copy. Keep model
  selection in the composer and additional response/usage facts available on demand.
- Show tool updates and retained supported status/widgets/editor requests with documented RPC limits.
  Interpret partial tool results using their actual contract, not an unconditional append rule.
- Apply one consistent projection/redaction rule to live output, authoritative reload snapshots,
  notices/errors and later exported artifacts. Preserve Pi's original history; do not rewrite it.
  Treat transcript/tool/widget content as untrusted and avoid raw executable HTML. Redaction is
  heuristic protection, not credential containment; handle secrets split across streaming chunks.
- **Smallest check:** fake Pi emits deliberately different partial/final text, interleaved content
  indexes, nested tools, status set/clear, usage, virtual/physical models and clamped effort. Include
  split secret canaries and malicious markup in both live and reloaded paths. Assert caller-visible
  results, not private assembler methods.
- **Browser gate:** corrected final text, the model picker and on-demand response/usage details,
  nested tool output and extension state remain consistent after reload; secret canaries are absent
  and markup cannot run code. Actual refresh failures remain visible without routine caveat banners.
- **Stop:** changed supported projections are faithful and safe within the stated scope. Do not
  chase arbitrary TUI parity or add unrelated image/model capabilities.

**Observed slice:** [Phase 3 implementation evidence](research/2026-10-04-phase3-session-projection.md)
records indexed authoritative endings, current-context file/live projections, selected/routed facts,
usage and nested execution previews, cwd-scoped catalogs, retained extension state and heuristic
redaction. Module, locked-CLI discovery/UI and scratch-browser gates pass for the supported text
scope. The [October 5 presentation correction](research/2026-10-05-quiet-session-ui.md) records the
user-requested Codex/T3 Code reference pattern: preserve these contracts in code, without permanent
provenance banners. Credential containment, terminal-only UI and Phases 4–6 remain outside this acceptance.

### Phase 4 — Keep one canonical server-owned execution

**Claim:** concurrent tabs, path aliases, release/reopen and idle retirement never create overlapping
children for one canonical checkout/session; browser detachment does not stop work. **INV-01–04.**

- Serialize/coalesce host acquisition and retain ownership until child shutdown completes. Canonicalize
  checkout identity without changing Pi-owned session history or silently merging incompatible saved
  references. Explain any alias migration/conflict rather than losing access to existing sessions.
- Retirement uses actual quiescence, including dialogs, pending work, retries and compaction. Release,
  abort, archive/delete and disconnect retain distinct semantics; child exit is not successful work.
- Bound pending command waits and report spawn/exit/timeout causes; do not hide a permanently hung
  state/stat request behind a spinner or let it stop protocol consumption.
- **Smallest check:** concurrent public server opens with fake-Pi spawn/exit observations; block
  shutdown then reopen; use real/symlink checkout aliases; advance a controlled idle deadline with
  queued/retrying/dialog work. Observe one child lifetime at a time, not a private hosts-map shape.
- **Browser gate:** disconnect during a run, reconnect from two tabs, see one execution; crash an
  in-progress fixture command and reopen history with an interruption explanation, never a resumed
  shell command. Archive/delete races cannot resurrect a still-closing host.
- **Stop:** ownership and retirement contracts are demonstrated. No browser-owned Pi stdin, second
  TUI writer, or transparent replay of interrupted work.

**Observed slice:** [Phase 4 implementation evidence](research/2026-10-05-phase4-session-ownership.md)
records canonical acquisition, server-owned startup/actions, shutdown-before-reopen, atomic retention,
quiescent retirement, nonblocking bounded readbacks and interruption-aware history reopening. Public
host, real locked-CLI alias reopening and scratch two-tab/browser gates pass. Registry/Pi references
are preserved; incompatible aliases fail explicitly rather than being migrated or merged. Cross-backend
writer exclusion, durable exit diagnostics and Phases 5–6 remain outside this acceptance.

### Phase 5 — Reconnect/switch into an ordered, bounded current view

**Claim:** attaching, reconnecting or selecting another session cannot apply old deltas/dialogs over a
new snapshot or relabel another session's events; slow tabs cannot stall Pi or grow memory without
bound. **INV-01–05, INV-11.**

- Add explicit session identity, host generation and monotonic sequence to snapshots/live events.
  Preserve the existing atomic subscription/snapshot foundation; include current partial message,
  active tools/dialogs and extension state needed for an honest mid-run view.
- Ignore duplicates, detect gaps/generation changes and resnapshot. Order selection responses or
  reject superseded selections. Continue snapshot-based reconnect; never resend pending prompts.
- Define bounded/coalesced delivery: replace obsolete projections or disconnect/resnapshot a slow
  consumer, but do not silently drop indispensable events. Keep Pi stdout draining and redact both
  snapshot and live paths consistently.
- **Smallest check:** attach while state mutates; inject duplicated/dropped/delayed frames, old
  selection responses and a new host generation. Hold one consumer while another receives a bounded
  burst; assert the documented overflow/resync outcome and an unaffected Pi/fast subscriber.
- **Browser gate:** reload mid-message/dialog; switch A→B rapidly; reconnect a slow second tab after
  exit/restart. All views agree with the authoritative snapshot, with no duplicate messages or sends.
- **Stop:** runtime checkpoint is demonstrable with phase 6; no historical replay/cursor database.

**Observed slice:** [Phase 5 implementation evidence](research/2026-10-05-phase5-ordered-delivery.md)
records atomic session/generation/sequence snapshots, selection correlation, duplicate/gap recovery,
bounded subscriber queues and acknowledgement-window socket delivery. Module and scratch two-tab
browser gates pass, including delayed A→B selection and slow-tab recovery after child exit/restart.
Oversized views fail explicitly; transient notices are not replayed. Phase 6 and the full runtime
checkpoint remain open.

### Phase 6 — Discover/create worktrees without false health

**Claim:** observed Git/Worktrunk state, unknowns and failures survive into the UI; creation uses the
returned checkout identity and does not silently bypass hook approval. **INV-01, INV-06, INV-11.**

- Record/enforce the supported Worktrunk contract (initial candidate: 0.80.0, schema 2), request complete
  non-progressive output, validate the envelope and translate needed structured facts into domain
  types. Preserve detached/null/unavailable/absent/failed states and external changes.
- Preserve explicit project/worktree selection; discovery does not register every external session.
  A genuine non-Git project may remain usable for chat, but must be labeled non-Git, not a healthy
  fallback for a failed Git/Worktrunk command. Keep stale last-known facts labeled stale.
- Create from structured lifecycle outcomes/path/base identity, not synthesized paths or prose regex
  success. Hooks remain explicit; do not pass unconditional `--yes` when enabling unapproved hooks.
- **Smallest check:** adapter contract fixtures for schema/malformed/null/error cases plus real 0.80.0
  discovery/create in a throwaway repository under isolated Worktrunk config/approval storage. Include
  a configured custom path, detached checkout and unapproved hook. Capture actual schema/options.
- **Browser gate:** select the returned new path, see dirty/in-progress/unknown state; an unavailable
  backend or rejected hook is an error with recovery guidance, not a root-only success.
- **Stop:** tested supported lifecycle discovery/create only. Branch PR/check summaries may be shown
  as observations, never as revision-bound verification; defer merge/remove.

**Observed slice:** [Phase 6 implementation evidence](research/2026-10-05-phase6-worktree-discovery.md)
records the enforced 0.80.0/schema-2 contract, explicit checkout discovery/selection, returned custom
creation paths, non-Git/unknown/error states, and approval-preserving hooks with partial-failure
reconciliation. Module, real scratch Worktrunk and browser gates pass for discovery/new-branch creation.
PR/check collection, exact revisions, merge/remove and durable lifecycle jobs remain outside this
acceptance. This does not retroactively certify every earlier runtime-checkpoint scenario.

### Phase 7 — Identify a workspace and inspect its exact revision/diff

**Claim:** every session/diff/observation names its workspace; materially different relevant content
cannot share a falsely current revision. **INV-01, INV-07–08.**

- Add stable workspace context for project root and registered worktrees, preserving existing
  project/worktree/session vocabulary and registry selections. Back up/version migrations and preserve
  existing references without copying Pi transcripts or silently registering terminal sessions.
  Unreadable registry data must produce an explicit recovery error, not be overwritten as empty data.
- Present a versioned revision manifest and diff together: base HEAD, index, working-tree content,
  relevant untracked paths, deletions, modes, symlinks and submodule state. Capture scope/exclusions
  explicitly; identify required ignored/generated/external inputs in revision or environment.
- Prefer materializing a stable captured candidate; detect capture races or refuse an unsupported
  state rather than calling it exact. Unsupported/conflicted/submodule inputs may initially be
  marked ineligible for verification, not silently omitted. HEAD/mtime/status counts are insufficient.
- **Smallest check:** migrate/reopen an old scratch registry and reject a malformed one without data
  loss. Real scratch Git operations through the revision/workspace interface: tracked edit,
  stage/unstage, untracked source, delete, mode/symlink change and rebase change identity as
  specified; deterministic recapture of unchanged inputs agrees. Race a capture with controlled
  mutation and assert consistent content or an explicit inconclusive result.
- **Browser gate:** two workspaces show their own paths/revisions/diffs; an external edit/checkout
  change refreshes the intended workspace and capture failure is visible, not an empty clean diff.
- **Stop:** supported capture scope is explicit and usable for workspace inspection. No whole new Git
  backend, universal filesystem snapshot promise or HEAD-only evidence shortcut.

**Observed slice:** [Phase 7 implementation evidence](research/2026-10-05-phase7-workspace-revisions.md)
records backed-up registry versioning, stable workspace references, content-addressed base/index/working
manifests and diffs from captured bytes. Real scratch Git, module and two-workspace browser gates pass,
including external edits/checkout changes and failure recovery. Conflicts/submodules and other
unsupported inputs fail explicitly; ignored/external inputs, execution provisioning, evidence currency
and universal filesystem isolation remain outside this acceptance. No checks or previews are shipped
by this capture slice.

**Removed on October 14, 2026:** revision capture (`WorkspaceRevisions`, `POST /api/workspace/capture`
and the revision store) had no consumer once Phase 8 was dropped, so it was removed rather than kept
as unused scaffolding. Workspace identity and the live Changes view remain. INV-08 stays the target
for whichever evidence feature next needs a revision; rebuild capture alongside that consumer
(the last implementation is at commit `30201dc`). Its race detection waited one event-loop turn for
macOS file-watch events, which arrive late under load, so a transient edit could be reported as
`captured`. A rebuild needs a deterministic flush, such as waiting for a sentinel file's own event.

### Phase 8 — Dropped

Dropped at the user's request on October 5, 2026: the Piano-specific Checks feature, Node-script
runner, check-definition schema and configuration are out of scope. The implementation and its
feature-specific tests have been removed, rather than retained as unused scaffolding.

Existing check configuration and evidence files are left untouched on disk and are no longer read
by Piano. Workspace identity, live diffs and the broader evidence ownership invariants remain;
revision capture was removed later (see Phase 7). Future
verification work needs a concrete project workflow, not another bespoke check-definition format.

### Phase 9 — Run and inspect the intended workspace's application

**Claim:** a preview and its logs identify a managed process, cwd, revision/environment and lifecycle,
not whichever application currently answers a remembered port. **INV-02, INV-07, INV-09, INV-11.**

- Add explicit configured app start/stop, bounded logs, startup readiness, process exit and cancellation
  outcomes. Record an app-instance identity and its input provenance; browser disconnect leaves
  server-owned work alone. On server restart reconcile or show interrupted/unknown, not a resurrected
  process based solely on a saved PID/port.
- Use an isolated preview origin (initially a separately opened private preview), not generated HTML
  on the control origin. Before enabling preview interaction, reject inappropriate control HTTP/WS
  origins and avoid forwarding control credentials/the entire developer environment to the app.
  Provide only configured required environment inputs; record names/digests without secret values.
- Live/hot-reloading development is allowed but visibly mutable; its observations are advisory until
  bound to stable inputs in phase 10. Copy cwd alone cannot prove the process loaded captured content.
- **Smallest check:** two scratch apps return distinct workspace/app-instance markers and emit distinct
  logs; include port collision, startup failure, exit, stop and restart. Reject preview-origin control
  requests/WebSockets without breaking the explicitly allowed private control/Vite origin.
- **Browser gate:** switch between both workspaces and read their markers/logs; stopping A cannot
  stop/relabel B. Failed readiness does not open a green preview. Preview content cannot operate the
  control plane, and no credential values appear in logs or evidence.
- **Stop:** the workspace loop is usable across two workspaces. No general remote routing,
  container sandbox claim, credential-containment claim or production process manager.

### Phase 10 — Repeat a browser journey and explain task readiness

**Claim:** evidence evaluates only its versioned criteria/policy on stable inputs; the workbench makes
current proof, failures and uncertainty obvious after returning. **INV-07–09, INV-11, INV-13.**

- Run one configured browser journey against an app started from the captured candidate, with isolated
  browser profile and app-instance/environment identity. Retain assertions, screenshots/trace/logs
  and artifact availability; a screenshot or an agent saying "verified" is not a passing assertion.
- Show task criteria, applicable check definitions, historical results, current/stale/unknown evidence
  and remaining unmet requirements alongside diff/process/session facts. Record the policy/requirement
  version on evaluation; changing those or environment/check inputs reevaluates conclusions.
- Keep gates harness-owned. Surface edits to tests, criteria and gate config for authorized review;
  edited project files do not silently redefine the accepted policy. No integration button is enabled
  before phases 11–12 establish its guard. Review evidence remains bounded, not an authority shortcut.
- **Smallest check:** one deterministic browser assertion passes then fails on a candidate change;
  missing artifact, changed requirement with unchanged code, changed gate config and changed environment
  prevent a current conclusion. Exercise transient input changes/unsupported inputs without false proof.
- **Browser gate:** inspect pass/fail/stale/unknown and the affected criterion; reopen from a second
  session/tab and identify changes, current evidence and uncertainty. Repeat equivalent work with a
  normal prompt and a compatible custom skill; only recorded evidence changes readiness. Compare
  another skill collection when available, otherwise retain that as an explicit INV-13 limitation.
- **Stop:** a returning human can choose continue/revise from the overview; measure the ADR's under-30-
  second assessment on a real feature rather than asserting it from a UI screenshot. Do not add more
  check kinds until the first one proves useful.

### Phase 11 — Prepare a candidate without integrating it

**Claim:** commit/squash/rebase and required validation produce an inspectable candidate; preparing or
failing it cannot be reported as target integration. **INV-06–10.**

- Add a server-owned preparation job with streamed output and workspace identity, independent of the
  WebSocket request's lifetime. Use supported Worktrunk steps through the adapter; record target
  branch/revision, intended action, candidate and applicable hook/policy digests.
- Serialize Piano writers or use a separate stable checkout. Require explicit workspace writing
  ownership/handoff; sessions/app jobs must not silently mutate the prepared candidate. Unrestricted
  external shell writers remain a stated trusted-developer limitation, not a universal enforcement claim.
- Commit/rebase changes conservatively stale old evidence; capture/check the actual post-preparation
  candidate. Run/record applicable required hooks with their real scope/outcome; skipped/background
  hooks are not passing checks. Establish the hook strategy before exposing approval: hooks that can
  mutate the candidate must finish before capture/validation/approval or block supported integration.
- **Smallest check:** real scratch Worktrunk preparation for clean/dirty input and a target advance;
  a conflict remains visibly unresolved with no target update. A hook edit/failure or candidate
  change invalidates earlier conclusions. Stop/restart mid-preparation reconciles Git operation state
  before offering retry; it never blindly repeats an external effect.
- **Browser gate:** prepare → inspect new diff/revision → see old evidence stale → verify prepared
  content. Show conflict/error and separate prepare/check states; target branch is unchanged.
- **Stop:** one supported preparation path and hook policy are tested. No monolithic `wt merge` that
  rebases, approves itself, integrates and destroys the checkout in one hidden action.

### Phase 12 — Approve and locally integrate the exact candidate

**Claim:** only a current approval for the actual candidate/target/policy permits the irreversible
step; failure reporting reconciles what Git actually changed. **INV-07–11.**

- Approval records workspace, candidate, target branch/revision, action, criteria/policy/hook versions
  and expiry. Revalidate at the server action, not just a disabled UI button. Double-click/two-tab
  approval cannot execute integration twice; lost replies do not authorize blind retry.
- Limit the first action to a clean prepared candidate and local fast-forward target integration.
  Candidate-preserving Worktrunk options to validate are `--no-commit --no-rebase --no-remove`;
  explicitly control user-configured merge/squash/fast-forward/hook behavior as part of the contract.
  Option names/help alone do not prove safety. No forge PR merge or implicit fetch is included.
- Hold Piano writer ownership through revalidation/execution; the execution path must not introduce
  unreviewed writes/rebases/hooks after validation. A policy may explicitly permit previously recorded
  required hooks plus disabled automatic rerun; otherwise provide an equivalent tested post-hook
  validation boundary or keep integration blocked. Never equate `--no-hooks`/command success with
  required-hook evidence. Artifact or policy changes also block approval, not only Git changes.
- Record intent before external effects and reconcile candidate/target Git facts after completion,
  timeout, process loss or restart. Preserve integrated-but-later-failed outcomes; target advanced is
  not "nothing happened". Cleanup remains separate.
- **Smallest check:** real scratch integration preserves the approved tip and retains the worktree.
  Edit candidate, advance target, expire approval, alter policy/hook or hold a competing writer and
  assert old approval cannot proceed. Interrupt after target update/before reply and reconcile once,
  without duplicate execution or a false failure-to-integrate claim.
- **Browser gate:** approve → integrate → see target/candidate and retained workspace. Two tabs cannot
  bypass a stale gate; a lost reply yields reconciling/known outcome, not a generic retry button.
- **Stop:** exact-candidate local integration is proven for the supported policy. If the Worktrunk path
  cannot preserve the approval boundary, stop and document the concrete limitation/ADR consequence
  rather than replacing the backend or relaxing the gate.

### Phase 13 — Clean up independently and reconcile lifecycle outcomes

**Claim:** removing a checkout is separately authorized and coordinated; cleanup failure cannot hide
successful integration or erase evidence. **INV-01–02, INV-06–07, INV-09–10.**

- Show dirty work, branch consequences, attached sessions/processes and artifact retention before a
  remove approval. Revalidate identity/consequences; an old approval cannot discard newly dirty work.
  Stop only owned jobs/children and prevent reopen during removal. External processes need explicit
  handling/confirmation, not blanket PID or cwd-based killing.
- Use tested foreground structured removal (candidate contract: `wt remove --foreground --format=json`)
  and distinguish deleted, retained, not-attempted and unknown outcomes. Force checkout removal and
  force branch deletion are different permissions; never silently escalate either.
- Retain evidence independently of removed checkouts and retain Pi history/session references per
  explicit retention policy. Reconcile interrupted lifecycle intent from Git/Worktrunk/process facts
  before retry; keep integration and cleanup histories separate.
- **Smallest check:** real scratch remove with active owned app/session, dirty work, retained unmerged
  branch, hook failure and process interruption. Observe actual directory/branch/process state and
  preserved artifact retrieval. Removing an already-gone checkout after restart cannot replay a merge.
- **Browser gate:** integrated → cleanup failed still says integrated; inspect failure and explicitly
  retry after reconciliation. Newly dirty checkout blocks old removal approval; other workspace
  processes and retained evidence remain intact.
- **Stop:** a real feature can complete prepare → verify → approve → integrate → clean up with honest
  partial outcomes and the returning-developer assessment. No automatic destructive cleanup.

## 5. Later milestones: pull only after demonstrated need

These are not dependencies of the workspace loop. Turn each requested control/workflow into its
own vertical slice; do not bundle the following into a new platform rewrite.

| Later slice | Trigger and bounded scope | Tight exit gate |
| --- | --- | --- |
| Outcome-project grouping (daily-use priority) | A bounded goal needs sessions from multiple repositories. Add optional project identity, explicit session membership and archive/reopen; migrate references without changing cwd or Pi history. (A short goal shipped with it and was later removed.) See the [plan](outcome-projects.md#step-1--organize-sessions-across-repositories). | Two projects reuse a repository while one spans repositories; reload, reassignment, archive and migration preserve sessions/workspaces and running work. No implicit membership or verification. INV-01–11. |
| Shared project context/instructions (later) | Grouping is useful and shared guidance is needed. Define versioned content, explicit delivery/application boundaries and precedence using supported Pi mechanisms; no second configuration loader or retroactive history rewrite. See the [plan](outcome-projects.md#step-2--shared-context-and-instructions-later). | Observe the intended version in two workspaces, no unrelated-project leakage, preserved checkout loading/trust, and explicit edit/reassignment/resume/failure outcomes. INV-01–05, INV-09, INV-11–13. |
| Pi ergonomics (roadmap 4) | A recorded workflow needs one of steering/follow-up, queue editing, compaction, naming, discovery or conversation fork/tree control. Add one action through PiSessions and wire/UI at a time. | Fake-Pi outcome plus affected browser journey; preserve phases 1–5. A conversation fork records its relationship to code/workspace without claiming a code fork. INV-02–05, INV-07, INV-12. |
| Independent review (roadmap 5) | Phase 10/12 evidence suggests review can catch meaningful defects. Use a separate Pi reviewer over a stable candidate/checkout with restricted read-only capabilities, criteria and bounded rounds/cost. | A seeded consequential defect produces an actionable reproducing finding; a clean control does not manufacture one; reviewer cannot mutate the candidate or award authoritative acceptance. Record cost/limits, including extension/execution restrictions. INV-01–02, INV-07–12. |
| Orchestration experiment (roadmap 5) | A measured workflow needs restart-safe orchestration; prototype exactly one workflow, do not replace the production Pi session runtime. | Primary-source compatibility audit at the selected version plus kill/restart around external effects: no duplicate action, storage has one owner, configuration/recovery differences documented. Adoption needs an ADR; experimental capability is not production readiness. |
| Remote/multi-user (roadmap 6) | A product requirement exceeds private trusted-developer access. First write the security/isolation ADR; define narrow authenticated/authorized journeys before enabling remote execution. | Every shipped remote slice has HTTP/WS authorization, cross-workspace denial, origin/session-expiry/credential tests and isolated preview behavior. The complete ADR's adversarial/isolation gate must pass before widened access. A worktree is not a sandbox. INV-11 and lifecycle/ownership contracts. |

Compare real tasks with Pi TUI + Herdr + Worktrunk at comparable starting revisions/models/budgets:
accepted changes without regression, human review/return time, escaped defects and cost per accepted
change. Keep deterministic race/recovery evidence separate from model-quality trials; use repeated
trials only where quality variability matters. More agents or transport sophistication are not success.

## 6. Decisions to resolve inside the relevant slice

These are bounded design questions, not reasons to build a generic framework first:

- **Phase 4:** canonical checkout identity and migration of old alias-based session references. Never
  move/merge Pi history to make a host-key normalization look successful.
- **Phase 7:** revision format/version, capture scope, stable materialization, submodule/ignored input
  support and explicit unsupported states. Capture/diff must agree on the content shown.
- **Phase 9:** managed process lifetime/recovery and allowlisted environment; private preview origin
  and control-origin checks compatible with local Vite and the private hosted proxy.
- **Phases 11–12:** exact supported Worktrunk preparation/finalization options, hook execution boundary,
  target comparison, writer exclusion, approval expiry and reconciliation of interrupted effects.
- **Phase 13:** session/artifact retention and explicit removal/branch deletion permissions. Avoid
  destructive defaults; new decisions outside the ADR require a superseding ADR.

## 7. Primary sources and verification limits

Repository sources:

- [ADR 0001](adr/0001-pi-rpc-workspace-workbench.md), [invariants](development-invariants.md),
  [roadmap](roadmap.md), [glossary](glossary.md), [testing policy](testing.md).
- [Current implementation audit](research/2026-10-04-vertical-slice-baseline.md),
  [Pi 1.0.2 observed upgrade](research/2026-10-04-pi-update-effort.md),
  [historical research](research/2026-10-02-harness-direction.md),
  [private development](development-on-exe-dev.md), [hosted development](hosted-development.md).
- [`package.json`](../package.json), [`package-lock.json`](../package-lock.json),
  [`PiSessions`](../server/PiSessions.ts), [`SessionHosts`](../server/SessionHosts.ts),
  [`PiRecords`](../server/PiRecords.ts), [`SessionFiles`](../server/SessionFiles.ts),
  [`Worktrees`](../server/Worktrees.ts), [`WsClient`](../server/WsClient.ts),
  [`wire`](../shared/wire.ts), [`browser store`](../web/src/store.ts),
  [`existing module tests`](../test/PiSessions.test.ts).

Pi primary docs were read from the installed **1.0.2** package, rather than assuming upstream `main`
is the locked contract. Stable versioned references:

- [RPC framing/lifecycle](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc.md),
  [command/disposition/state definitions](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc-commands.md),
  [authoritative messages/events](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/json.md).
- [Extension UI responses/deadlines/limits](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc-extension-ui.md),
  [headless project trust](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/security.md#project-trust-without-an-interactive-prompt),
  [process environment](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/environment-variables.md),
  [MCP configuration/overrides](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/mcp.md),
  [CLI resource loading](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/cli.md),
  [selected/physical virtual models](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/virtual-models.md),
  [session entries](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/session-format.md).

Worktrunk primary references fetched during this research (live, not version-pinned):

- [List schema 2 and absent/null states](https://worktrunk.dev/list/#json-output).
- [Merge pipeline and candidate-preserving options](https://worktrunk.dev/merge/#pipeline):
  default commit/squash/rebase/cleanup behavior is not a guarded integration transaction;
  `--no-commit --no-rebase` requires a clean candidate; local merge never fetches.
- [Foreground removal and branch outcomes](https://worktrunk.dev/remove/#json-output):
  background/default success cannot establish completed removal.
- [Hooks, approvals and background execution](https://worktrunk.dev/hook/):
  pre-merge follows rebase; skipped/background hooks require actual result recording.

Read-only `wt --version`, `wt merge --help` and `wt remove --help` confirmed installed 0.80.0 and
option availability, not safe integration, hook completeness or recovery. This research ran no model
prompts, app instances or implementation tests and changed no runtime settings. Documentation work
requires document/link review only. All runtime checks above are **future phase gates**, not results.
