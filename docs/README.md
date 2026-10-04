# Development direction

Piano turns agent activity into inspectable software work.

Read these documents in order:

1. [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md)
   records the architectural decision and its trade-offs.
2. [Development invariants](development-invariants.md) defines the guardrails and their verification
   scenarios. These are target contracts; a documented invariant is not a claim that it is implemented.
3. [Implementation roadmap](roadmap.md) orders the work and defines milestone exit criteria.
4. [Developing on exe.dev](development-on-exe-dev.md) describes the private development workflow,
   scratch verification, and the Pi 1.0.2 upgrade handoff.

The [2026-10-02 research note](research/2026-10-02-harness-direction.md) retains the original
Pi 1.0.0 findings and citations. Its implementation audit is dated, and its phase ordering and
registry-based evidence proposal are superseded by the documents above.

Changes to these decisions belong in a new or superseding ADR, with the affected invariant IDs
and verification consequences made explicit. Routine implementation choices remain within the
accepted direction.
