# Development invariants

These are Piano's target contracts, governed by [ADR 0001](adr/0001-pi-rpc-workspace-workbench.md).
They guide implementation and review; several require work identified in the [roadmap](roadmap.md).
Do not infer compliance from the existence of this document.

Use stable IDs in PR descriptions, tests and follow-up issues. When a change touches a contract,
state which IDs it preserves and retain the relevant observed output. Test behavior through the
module boundary rather than reproducing implementation details.

## INV-01 — One authoritative owner per state

Pi owns session history and agent semantics. Registry owns selected projects, workspace identity,
session references and preferences. Worktrunk/Git own checkout facts. The evidence store owns
executions and artifacts. Browser state and cached summaries are projections.

**Verify:** reopening a session loads Pi's authoritative history; restarting Piano preserves workspace
and evidence references without constructing a competing transcript. An external checkout change is
reconciled into observed workspace state, not overwritten by stale registry facts.

**Guardrail:** retain the registry's explicit selection model; discovering worktrees need not silently
register every terminal-created session.

## INV-02 — Server ownership survives browser lifecycle

At most one live Pi child owns a canonical checkout/session identity. Refresh, disconnect and multiple
tabs do not start duplicate children or resubmit work. Browser disconnect, abort, session release and
background-job cancellation are separate operations. Idle retirement requires actual quiescence,
including no pending dialogs, queued work, retry or compaction that can continue automatically.

**Verify:** disconnect during a run, reconnect from two tabs and observe one child and one execution.
A worker exit is reported as an exit; restarting from a session file is not presented as continuation
of the interrupted shell command.

**Guardrail:** do not let a browser connection own child stdin or independently open a TUI writer for
the same active session. Future automatic retry of submissions needs stable submission identities
and server-side deduplication; until then, reconnect must never resend them automatically.

## INV-03 — Agent state comes from Pi facts

A successful command response means command handling succeeded. Surface `started`, `queued` and
`handled`; `handled` must not wait for a run that never starts. `agent_end` is not quiescence;
`agent_settled` means Pi will not continue automatically. Waiting for input, compaction, retry, queue
state, rejection and process failure remain distinguishable.

**Verify:** a fake Pi consumes a prompt without starting, queues a follow-up, retries after
`agent_end`, and exits unexpectedly. The UI reaches the correct explained state in each case.
Install observation before submitting to catch immediate completion.

**Guardrail:** a final assistant message never makes a workspace verified or integrated. Session
execution status, evidence validity and integration status are separate axes.

## INV-04 — A dialog has one terminal resolution

Answer, cancel, timeout and abort compete for the same dialog claim. At most one response is written
to Pi. Claim before awaiting the write; duplicate or expired answers fail clearly. Abort cancels Pi's
pending supported dialogs as well as clearing retained UI state. Late acknowledgements cannot settle
a newer run.

**Verify:** two tabs answer simultaneously; answer races timeout; abort races answer and a later turn.
Count actual `extension_ui_response` writes and ensure no extension remains blocked on an abandoned
dialog. A failed write produces an explicit transport/process outcome, not a silent success.

**Guardrail:** retain timeout/deadline information and define recovery after an uncertain write.
Extension UI responses have no normal RPC acknowledgement.

## INV-05 — Reconnect creates a consistent view

A snapshot and its subsequent events share an ordered boundary. Sequence numbers are monotonic within
an identified host generation; a restarted host cannot be confused with an earlier sequence. Ignore
duplicates, detect gaps and resynchronize from authoritative state. Do not replay older deltas over a
newer snapshot.

**Verify:** mutate state while attaching; drop and duplicate events; reconnect with a slow tab; restart
the child. The resulting client view agrees with the authoritative snapshot and has no duplicate
messages or dialogs.

**Guardrail:** start with snapshot plus live events. Add incremental historical replay only after
measurement. Bound/coalesce delivery where appropriate; a slow browser must not create unbounded
memory growth or stall Pi stdout draining.

## INV-06 — Worktrunk failures remain unknown or failed

Assert the supported `wt list` schema and consume complete structured output (currently schema 2
with `--no-progressive`). Preserve null, unavailable, absent, detached, clean and failed states.
Use Worktrunk's returned identity and lifecycle results instead of synthesizing paths or duplicating
its Git/PR calculations.

**Verify:** valid output, unsupported schema, malformed output, unavailable PR/check data and a failed
command. None of the failure cases becomes a healthy project-root-only list or a passing check.

**Guardrail:** hooks, interactive approval and foreground completion follow the pinned Worktrunk
contract. Worktree removal coordinates running sessions/processes before destroying their checkout.

## INV-07 — Every observation identifies its workspace

Sessions, previews, commands, logs, diffs and evidence carry workspace identity. A process includes
its cwd and associated revision/environment; a port number alone is not identity. Separate concurrent
writing tasks use separate workspaces; multiple writing sessions in one workspace require an explicit
ownership/handoff policy.

**Verify:** two workspaces run similar applications; each preview and check uses the intended one.
Switching the selected workspace cannot relabel an older process or artifact as current.

**Guardrail:** conversation fork does not imply code fork. Record the relationship explicitly.
A reviewer inspects an immutable candidate or separate checkout, never an unexplained moving target.

## INV-08 — A revision identifies relevant content

Define a versioned, deterministic revision identity from base HEAD, index state and working-tree
content, including relevant untracked paths, deletions, modes, symlinks and submodule state.
Record the capture scope and exclusions. Capture relevant ignored/generated inputs and external
configuration in the revision or environment provenance if checks depend on them.

**Verify:** edit a tracked file, stage/unstage, add an untracked source file, delete a file, change
a mode and rebase. Each affected observation is invalidated or explicitly recaptured. Capturing while
files change yields a consistent snapshot or a detected race, never false certainty.

**Guardrail:** timestamps and HEAD alone are insufficient. A content-preserving commit can reuse
evidence only through an explicit equivalence rule covering all check inputs; conservative
invalidation is the initial policy.

## INV-09 — Evidence proves a bounded claim

A check record includes ID, workspace, captured revision, command/check configuration, environment
and tool versions, start/end times, exit status, outcome, and artifact references. Browser evidence
names the running app and the journey/assertions observed. Outcomes distinguish pass, fail, cancelled,
error, stale and unknown; success applies only to the checks actually executed.

**Verify:** run against a candidate, mutate during/after the run, cancel, lose an artifact, or change
check configuration. The UI retains the historical result but cannot present it as current proof.
Use an immutable execution snapshot where possible; otherwise detect mutations across execution and
mark unstable runs inconclusive. A matching end fingerprint alone cannot exclude transient edits.

**Guardrail:** authoritative acceptance gates belong to the harness. Changes to tests or gates are
visible and reviewed; the coding agent cannot weaken a gate and self-award verification. Acceptance
criteria and required evidence are recorded proportionally to the task.

## INV-10 — Integration applies to the approved candidate

Integration approval identifies workspace, candidate revision, target branch/revision, action,
applicable hooks and expiry. Remove approval identifies the checkout and the consequences for dirty
work, sessions and processes. Revalidate immediately before execution and report the actual outcome.

**Verify:** edit after approval, advance the target, and rebase during Worktrunk merge. Any changed
candidate loses approval and affected evidence. Serialize writers or operate on immutable state so
revalidation is not followed by an unchecked mutation.

**Guardrail:** Worktrunk pre-merge hooks run after rebase; pre-rebase evidence or approval cannot
silently cover changed post-rebase content. Establish a preparation/validation boundary before the
irreversible integration step. External effects interrupted by a crash require reconciliation,
not blind replay.

## INV-11 — Private development is an explicit trust boundary

Current Piano is a trusted-developer tool with no application authentication. Keep it bound to
loopback behind private authenticated access, including on exe.dev. A general remote product requires
workspace authorization on every operation, isolated execution, scoped credentials and separate
origins for generated previews. A worktree and a Pi subprocess are not security sandboxes.

**Verify:** in private development the raw control port is unreachable from an unauthenticated network
client. For any remote-access implementation, test HTTP and WebSocket authorization, cross-workspace
access, origin checks, session expiry and preview-to-control separation.

**Guardrail:** never infer that a hostname, TLS, a private VM or a reverse proxy alone protects the
application. Render transcripts/tool output as untrusted content. Redact known secrets consistently
before browser delivery and exported artifacts; document that heuristic redaction is not containment.
Do not forward the whole developer credential environment into an untrusted preview.

## INV-12 — Pi compatibility is tested, not inferred

Pi's normal CLI setup loads resources in the selected cwd. Keep protocol translation in PiSessions;
supported extension dialogs/status are exposed and terminal-only methods have documented limits.
Record installed versions and test the locked dependency plus any explicit CLI override.

**Verify:** a deliberate Pi upgrade runs fake-protocol tests, typecheck, and a short browser roundtrip
with prompt handling, supported dialog, reload, abort and child exit. Include a project MCP override
fixture and confirm selected model/thinking settings without leaking credentials.

**Guardrail:** neither a semver range nor a tagged documentation review proves runtime compatibility.
Do not implement a second settings/MCP/credential loader just to reproduce what the CLI already owns.

## Applying the guardrails

For an implementation PR, identify affected IDs, the acceptance scenario, observed verification,
remaining gaps and any migration effects. Existing gaps are backlog items, not blanket exemptions.
When a contract cannot be preserved, explain the concrete need in a superseding ADR before expanding
the architecture. Avoid ceremonial reviews for unrelated small changes.
