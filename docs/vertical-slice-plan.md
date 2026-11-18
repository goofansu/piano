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
