# Development direction

Piano turns agent activity into inspectable software work.
It is a control plane for evidence-based development, with skill-agnostic methodology and Worktrunk
as its initial worktree lifecycle backend. Piano owns workspace, evidence and integration policy.

Read these documents in order:

1. [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md)
   records the architectural decision and its trade-offs.
2. [Development invariants](development-invariants.md) defines the guardrails and their verification
   scenarios. These are target contracts; a documented invariant is not a claim that it is implemented.
For new or substantially changed features, group what genuinely changes together within its
runtime behind a small interface; preserve `web → shared ← server`. This is not a folder migration
or a retroactive reorganization. Connect the feature's owners and interfaces to its checks using
the [feature verification map](testing.md#feature-verification-map).

Changes to these decisions belong in a new or superseding ADR, with the affected invariant IDs
and verification consequences made explicit. Routine implementation choices remain within the
accepted direction.
