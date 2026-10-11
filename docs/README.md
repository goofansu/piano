# Development direction

Piano turns agent activity into inspectable software work.
It is a control plane for evidence-based development, with skill-agnostic methodology and Worktrunk
as its initial worktree lifecycle backend. Piano owns workspace, evidence and integration policy.

Read these documents in order:

1. [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md)
   records the architectural decision and its trade-offs.
2. [Development invariants](development-invariants.md) defines the guardrails and their verification
   scenarios. These are target contracts; a documented invariant is not a claim that it is implemented.
3. [Implementation roadmap](roadmap.md) orders the work and defines milestone exit criteria.
   The [verification-gated vertical-slice plan](vertical-slice-plan.md) breaks those milestones into observable
   journeys with focused implementation gates, based on the October 4 source/documentation audit.
4. [Developing on exe.dev](development-on-exe-dev.md) describes the private development workflow,
   scratch verification, and the Pi 1.0.2 upgrade handoff.

The [outcome-project plan](outcome-projects.md), with its boundary decision in
[ADR 0002](adr/0002-outcome-projects.md), adds organization around bounded goals across repositories.
Session grouping is implemented; shared context and instructions remain deferred. The UI distinguishes
Projects from Repositories while existing directory-based `project` fields retain their meaning.

Use the [domain glossary](glossary.md) to distinguish sessions, tasks, evidence and verification.
Contributor skill preferences are optional; see the development handoff.
When developing Piano, follow [evidence-based development and testing](testing.md): choose checks
from the risk and acceptance claim, and add regression tests only where they provide durable value.

The [2026-10-02 research note](research/2026-10-02-harness-direction.md) retains the original
Pi 1.0.0 findings and citations. Its implementation audit is dated, and its phase ordering and
registry-based evidence proposal and broad Worktrunk ownership wording are superseded by the documents above.
The [MCP management research](research/2026-10-09-mcp-management.md) documents setup through Pi,
current RPC/browser limitations and a proposed management surface; it does not claim that surface exists.
[Radius setup](radius-setup.md) describes the implemented, narrower Settings section for
provider OAuth, provider-auth MCP configuration and web-search extension installation.
[MCP setup](mcp-setup.md) describes the Settings section that installs catalog MCP servers
(Linear first) and signs in to them through Pi's MCP OAuth.

Changes to these decisions belong in a new or superseding ADR, with the affected invariant IDs
and verification consequences made explicit. Routine implementation choices remain within the
accepted direction.
