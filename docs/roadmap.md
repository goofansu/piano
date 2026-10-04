# Implementation roadmap

This is the working order under [ADR 0001](adr/0001-pi-rpc-workspace-workbench.md).
The [invariants](development-invariants.md) are acceptance contracts, not a claim of completed work.
All milestones below are planned; the original research audit describes the 2026-10-02 implementation.

## 1. Runtime correctness

- Upgrade the package and lockfile deliberately to Pi 1.0.2 and record the tested version. Inspect the
  RPC/extension UI changes against the tagged docs; do not assume the caret range upgraded the lock.
- Surface prompt disposition; distinguish settled, queued, waiting, compacting, retrying and exited.
- Atomically claim dialogs, propagate cancellation on abort, expose deadlines and prevent late
  acknowledgements from changing a newer operation.
- Reconcile authoritative message endings, selected versus physically routed model, usage and
  nested tool calls where the current translation drops them.
- Validate Worktrunk schema/output and preserve unknown/error states.
- Add event sequence + host generation, snapshot/live ordering, slow-client handling and consistent
  redaction. Keep reconnect snapshot based; defer historical replay.

**Exit:** short browser roundtrip on 1.0.2 plus fake-Pi scenarios for handled prompt, immediate
completion, two-tab dialog races, timeout, abort, refresh, interrupted commands and child exit.
No automatic resubmission on reconnect. Run `npm test` and `npm run typecheck`.
Covers INV-01–06 and INV-11–12.

## 2. Observable workspace workbench

- Add workspace context around existing project roots and Worktrunk checkouts; attach sessions
  without renaming every existing worktree type.
- Expose Worktrunk state, revision/dirty identity and diff alongside the session.
- Track app/process cwd, lifecycle, logs and preview identity. Make active workspace unmistakable.
- Define revision capture and separate evidence-store ownership now. Start with one configured check
  action recording revision, command, exit status and output; edits visibly stale its result.
- Separate agent activity from verification and integration status.

**Exit:** prompt → changed files → run app/check → inspect diff and current/stale result → follow up.
Two simultaneous workspaces cannot confuse previews or checks. This is the first useful evidence
loop, before full TUI parity. Covers INV-01, INV-07–09.

## 3. Repeatable verification and controlled integration

- Record proportional acceptance criteria and authoritative check configuration.
- Add browser journeys, traces/screenshots and repeatable regression checks with revision/environment
  provenance. Execute against stable snapshots or mark racing checks inconclusive.
- Retain evidence history and invalidate affected results on edits, configuration changes and rebase.
- Add Worktrunk merge/remove jobs with streamed output, process coordination and explicit outcomes.
  Establish post-rebase validation and approval tied to the actual candidate before integration.
- Test interrupted external effects and reconcile before retries.

**Exit:** a real feature meets recorded acceptance criteria; changing the candidate makes evidence
stale and blocks old approval. The returning developer can assess changes, current evidence and
remaining uncertainty in under 30 seconds. Covers INV-07–11.

## 4. Pi ergonomics driven by usage

Add distinct steering/follow-up, queue management, compaction, session naming, command discovery and
fork/tree controls when actual work needs them. Preserve code/conversation branching identities and
extension capability limits. Do not gate milestone 2 on a complete copy of the TUI.

**Exit:** observed user workflows improve without weakening the runtime contracts. Covers INV-02–05,
INV-07 and INV-12.

## 5. Independent review and bounded orchestration

Start with a separate Pi reviewer against the candidate snapshot/checkout, read-only capabilities,
acceptance criteria and evidence. Require actionable findings and reproductions; bound rounds,
cost and repeated failures. Reviewer approval is evidence, not authoritative verification.

Only then consider a Pi Durable prototype for one restart-safe orchestration workflow. Record its
experimental status, resource/configuration differences, single-storage ownership and external-effect
reconciliation. Require kill/restart and compatibility tests; production adoption needs an ADR.
Do not maintain two production runtimes for hypothetical flexibility.

**Exit:** review demonstrably catches meaningful defects at an acceptable cost, and any orchestration
prototype recovers without duplicate external effects. Covers INV-01–02, INV-07–12.

## 6. Remote or multi-user product

Write the security/isolation ADR before widening access: HTTP/WebSocket authentication and operation
authorization, execution boundaries, credential handling, preview origins, quotas and failure modes.
Private exe.dev development through a tunnel remains within the current trusted-developer model;
it is not this milestone.

**Exit:** adversarial access and isolation scenarios pass; raw execution/control endpoints are not
exposed. Covers INV-11 plus all lifecycle and ownership invariants.

## Measure the improvement

Compare against Pi TUI + Herdr + Worktrunk on representative real tasks, using comparable starting
revisions, models and budgets. Track accepted changes without regression, human review time, escaped
defects and cost per accepted change. Repeat model-driven trials when consistency matters.

Keep deterministic recovery/race tests separate from product-quality trials. Avoid adding agent
count, transport sophistication or orchestration merely to lengthen the feature list.
