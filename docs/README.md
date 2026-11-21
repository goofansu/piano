# Development direction

Read these in order:

1. [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md).
2. [Development invariants](development-invariants.md): target contracts. A documented invariant
   is not a claim that it is implemented.

## Feature inventory

Start at [Using Piano](use.md) for the user guides or browse the [feature directories](../features) to find the source.

A feature keeps its browser code in `web/`, server services in `server/`, wire contracts in `contracts/`, Pi extensions in `extension/` and focused tests in `tests/`. Only the directories the feature uses are present. A contract used by both the browser and server of one feature belongs in that feature.

The [browser](../web/src/app) and [server](../server/app) compose features. Reusable code lives in [browser shared](../web/src/shared), [server shared](../server/shared) and the [portable protocol](../shared). Oxlint checks runtime boundaries and feature ownership for imports, including type imports and re-exports. The [verification map](../.agents/skills/verify-piano/features/README.md#features) lists the browser journeys.

Changes to these decisions belong in a new or superseding ADR, with the affected invariant IDs
and verification consequences made explicit. Routine implementation choices remain within the
accepted direction.
