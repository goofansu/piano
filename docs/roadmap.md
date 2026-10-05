# Implementation roadmap

This is the working order under [ADR 0001](adr/0001-pi-rpc-workspace-workbench.md).
The [invariants](development-invariants.md) are acceptance contracts, not a claim of completed work.
These are target milestones, not completion claims. The original research audit describes the
2026-10-02 implementation; the [vertical-slice plan](vertical-slice-plan.md) records the October 4
baseline and breaks the milestones into separately verifiable journeys.

## Current priority: joyful daily use

On October 5, the user prioritized a polished everyday web experience before deeper workflow
features. Keep the architecture below, but defer phases 9–13 while improving the existing
session → conversation → changes journey. Start with visual hierarchy, responsive interaction,
useful motion and keyboard/focus behavior; let daily use identify the next friction rather than
chasing full TUI parity or adding more backend machinery. Preserve runtime correctness and the
quiet-UI principle throughout. The [first UX pass](research/2026-10-05-daily-ux-first-pass.md)
records the initial changes and verification, not completion of the broader UX goal.

## 1. Runtime correctness

- Preserve the deliberate exact Pi 1.0.2 package/lockfile upgrade, recorded in the
  [October 4 report](research/2026-10-04-pi-update-effort.md). Complete the remaining compatibility
  checks, including project MCP overrides and dialog/abort behavior. Inspect RPC/extension UI changes
  against the tagged docs; the completed dependency upgrade is not full runtime-milestone acceptance.
- Surface prompt disposition; distinguish settled, queued, waiting, compacting, retrying and exited.
- Atomically claim dialogs, propagate cancellation on abort, expose deadlines and prevent late
  acknowledgements from changing a newer operation.
- Reconcile authoritative message endings, selected versus physically routed model, usage and
  nested tool calls where the current translation drops them.
- Validate the supported Worktrunk version/schema/output behind a narrow adapter and preserve
  unknown/error states; allow direct Git inspection for exact revision capture.
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
- Keep revision capture and separate evidence-store ownership. Future verification should reuse
  project tooling rather than require a Piano-specific check-definition format. The custom
  [Phase 8 runner has been dropped](vertical-slice-plan.md#phase-8--dropped).
- Separate agent activity from verification and integration status.
- Attach lightweight task/acceptance-criterion references to work and evidence, with captured
  requirement versions. Avoid requiring a skill set, document template or issue tracker.

**Exit:** prompt → changed files → run app/check → inspect diff and current/stale result → follow up.
Two simultaneous workspaces cannot confuse previews or checks. This is the first useful evidence
loop, before full TUI parity. Equivalent work with different skills or ordinary prompting follows
the same contracts. Covers INV-01, INV-07–09 and INV-13.

## 3. Repeatable verification and controlled integration

- Record proportional acceptance criteria and the project's verification requirements.
- Add browser journeys, traces/screenshots and repeatable regression checks with revision/environment
  provenance. Execute against stable snapshots or mark racing checks inconclusive.
- Retain evidence history and reevaluate affected conclusions on edits, requirement/policy changes,
  configuration changes and rebase.
- Add Worktrunk merge/remove jobs with streamed output, process coordination and explicit outcomes.
  Establish post-rebase validation and approval tied to the actual candidate before integration.
- Separate prepare → verify → approve → integrate → clean up. Test candidate-preserving Worktrunk
  options, skipped/background hooks and partial failures. Distinguish local integration from forge PR
  merge. Required checks need recorded results, not just a successful lifecycle command.
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
