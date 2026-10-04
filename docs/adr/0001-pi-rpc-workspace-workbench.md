# ADR 0001: Pi RPC and the workspace workbench

- Date: 2026-10-04
- Status: Proposed; accepted when this PR is merged
- Runtime reference: Pi Coding Agent 1.0.2
- Related: [invariants](../development-invariants.md), [roadmap](../roadmap.md),
  [original research](../research/2026-10-02-harness-direction.md)

## Context

Piano already supervises one long-lived Pi RPC child per active session. Pi owns the conversation,
tools, configuration and session persistence; Piano owns the browser connection and process lifecycle.
Worktrunk creates and inspects worktrees. This is a useful foundation, but the current product is
primarily session and chat oriented.

The opportunity for the browser is to make changes, running applications, checks and remaining
uncertainty visible together. The baseline is the developer's Pi TUI + Herdr + Worktrunk workflow.
A fuller transcript alone does not establish a better development product.

## Decision

Build Piano as a workspace workbench for Pi, with revision-bound evidence.

1. **Keep the process boundary.** One active session has at most one server-owned
   `pi --mode rpc` child. Keep Pi protocol details behind `server/PiSessions.ts` and its
   `SessionAction` / `SessionEvent` vocabulary. Keep the Effect-native adapter; adopting Pi's
   exported `RpcClient` is not required. Browser tabs observe and control server-owned work.
2. **Preserve the user's Pi environment.** Use normal CLI configuration and resource loading in the
   selected checkout, including project MCP overrides. Forward supported RPC extension UI and state.
   Document terminal-only limitations instead of promising arbitrary TUI rendering in a browser.
   Pi remains authoritative for session semantics and history.
3. **Keep Worktrunk authoritative for worktree lifecycle.** Consume its supported structured schema
   and drive create, remove and integration through its documented contracts. Piano adds product
   identity, process supervision and evidence; it does not build a second worktree manager.
   Herdr remains an optional sibling interface.
4. **Make the workspace the product context.** A project has workspaces; a workspace attaches
   sessions, a revision, processes, evidence and integration state. A workspace can refer to the
   project root or a Worktrunk checkout. Retain the existing words `project`, `worktree`,
   `session` and `registry`; this decision does not require an immediate schema or UI rename.
5. **Bind evidence to actual content.** A workspace revision includes base HEAD and a deterministic
   index/working-tree fingerprint, with explicit treatment of untracked files and relevant inputs.
   A commit hash alone cannot identify uncommitted work. Checks and reviews name the inspected
   revision and environment; changes make affected evidence stale.
6. **Give each store one responsibility.** Registry owns selected projects, workspace identity,
   session references and preferences. Pi owns conversation history. A separate evidence store owns
   check executions, artifacts and revision references. Cached summaries may live in Registry;
   transcripts and evidence bundles must not accumulate in its config JSON.
7. **Deliver the evidence loop early.** After runtime correctness, build
   prompt → change → run app/check → inspect evidence and diff → follow up → integrate.
   Advanced Pi controls, independent reviewers and autonomous orchestration follow demonstrated need.
8. **Keep private development distinct from a remote product.** Running on exe.dev does not confer
   authentication or execution isolation on Piano. Keep the current unauthenticated server on
   loopback and access it through a private authenticated tunnel. General remote access requires
   an explicit architecture for authorization, isolation, credentials and preview origins.

## Alternatives and consequences

| Alternative | Reason for this decision |
| --- | --- |
| Browser terminal as the main UI | Useful as an escape hatch; it does not provide the coordinated workspace/evidence view. |
| Embed Pi SDK | In-process access is useful elsewhere, but it expands Piano's failure boundary and configuration responsibilities. RPC retains process isolation. |
| Pi Durable as the session substrate | It is a separate experimental environment, rather than a drop-in host of the user's Coding Agent setup. Revisit for bounded orchestration only after compatibility and recovery evidence. |
| Generic multi-agent platform | Broad abstractions would distract from the Pi + Worktrunk workflow. Preserve the existing focused seam. |
| Complete TUI parity before evidence | Delays the first proof that the browser improves development and review. |

Piano must now own reliable synchronization, lifecycle races, process visibility, evidence invalidation
and guarded integration. A worktree is a checkout, not a security sandbox. Preserving local Pi behavior
also preserves the trusted-developer execution model until a separate remote design changes it.

## Pi 1.0.2 checkpoint

The tagged [Coding Agent changelog](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/CHANGELOG.md)
records per-thinking-level sampling overrides in 1.0.2. The intervening 1.0.1 release adds project MCP
overrides and fixes, among other changes. These support letting Pi own configuration; they do not
provide a reason to change Piano's runtime boundary.

The tagged [RPC documentation](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc.md)
still describes long-lived subprocesses, strict JSONL, prompt dispositions and `agent_settled`.
These sources establish the documented direction, not a Piano compatibility test.

At this PR's base revision, package.json permits `^1.0.0` and package-lock.json resolves Pi 1.0.0.
This documentation PR does not upgrade dependencies or claim a verified 1.0.2 runtime. Upgrade and
test the lockfile deliberately as the first runtime milestone.

## Acceptance and reconsideration

The first product milestone is a real feature task where, after leaving and returning, the developer
can determine in under 30 seconds what changed, which evidence is current, what remains uncertain,
and whether to continue, revise or integrate without reading the entire transcript.

Reconsider this ADR when a measured workflow requires in-process APIs, restart-safe orchestration or
multi-user execution. A replacement must show configuration compatibility, failure behavior, recovery
semantics and product value against the current workflow. New runtime capabilities alone are not
sufficient grounds for a migration.
