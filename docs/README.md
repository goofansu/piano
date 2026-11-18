# Development direction

Read these in order:

1. [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md).
2. [Development invariants](development-invariants.md): target contracts; a documented invariant
   is not a claim that it is implemented.
For new or substantially changed features, group what genuinely changes together within its
runtime behind a small interface; preserve `web → shared ← server`. This is not a folder migration
or a retroactive reorganization. Connect the feature's owners and interfaces to its checks using
the [feature verification map](testing.md#feature-verification-map).

Changes to these decisions belong in a new or superseding ADR, with the affected invariant IDs
and verification consequences made explicit. Routine implementation choices remain within the
accepted direction.
