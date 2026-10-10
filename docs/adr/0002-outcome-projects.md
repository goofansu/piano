# ADR 0002: Separate outcome projects from execution locations

- Status: Accepted for Step 1 by the user's implementation request. Grouping is implemented;
  shared context/instructions remain deferred. See [evidence](../research/outcome-projects-step1.md).
- Related: [staged plan](../outcome-projects.md), [glossary](../glossary.md#projects),
  [ADR 0001](0001-pi-rpc-workspace-workbench.md).
- Naming: code now calls added directories folders and outcome projects simply projects.

Piano currently calls an added directory a project, but a bounded initiative can span repositories,
and one repository can support several initiatives. Add an optional outcome-project grouping above
session references while keeping each session's workspace as its execution context. Ship grouping
first; shared context and instructions are a separate later step.

## Boundary and trade-off

This extends ADR 0001 decision 4: a workspace remains the context for execution, revision,
processes and evidence, while an outcome project supplies the organizational context across that work.
It does not become a checkout owner or a multi-repository execution workspace. Registry v2 preserves
the directory meaning of existing `project` fields and adds outcome identity
and session associations separately. The UI calls these groupings Projects and execution locations
Repositories; persisted paths are not reinterpreted.

Simply renaming directories would not support cross-repository outcomes. A list of repository paths
alone would not distinguish related sessions from unrelated work in those repositories. Explicit
session membership provides the first useful grouping without requiring a repository hierarchy. The
initial implementation allows at most one outcome project per session, keeping reassignment and eventual
instruction selection unambiguous; repositories remain reusable across projects.

## Consequences

- Registry owns project identity, organizational metadata and associations, not transcripts or evidence
  (INV-01). Existing directory/workspace/session references survive a backed-up, validated migration.
- Membership and archive actions do not change cwd, host ownership, trust, session history, checkout
  lifecycle or verification/approval state (INV-02–11). Archive is organization, not acceptance.
- Later shared context/instructions need explicit delivery, version and application-boundary semantics
  that preserve normal Pi configuration and trust; no second loader or required skill set (INV-12–13).
- Terminology, UI labels, storage and verification gates are detailed in the
  [staged plan](../outcome-projects.md). Automatic orchestration and cross-repository integration are
  not consequences of introducing this grouping.
