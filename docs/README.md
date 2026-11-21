# Development direction

Read these in order:

1. [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md).
2. [Development invariants](development-invariants.md): target contracts. A documented invariant
   is not a claim that it is implemented.

## Feature inventory

The directory name identifies the owner across the [browser](../web/src/features), [server](../server/features), [wire contracts](../shared/features), and [feature tests](../test/features). A feature has a directory in each runtime that implements it.

| Directory | What it owns |
| --- | --- |
| `projects` | Project index, project home, membership and settings |
| `navigation` | Browser routes and history, sidebar, session switching and panel layout |
| `commands` | Command palette, search, shortcuts and contextual actions |
| `sessions` | Starting and continuing sessions, drafts, attachments, agent questions, transcripts, Pi lifecycle and saved history |
| `dispatch` | Creating child sessions, waiting for their results and reporting their status |
| `workspace` | Folder selection and trust checks, Git worktrees, changes, pull requests and file previews |
| `models` | Model discovery, model and effort selection, and defaults |
| `sharing` | Confirming and sharing a saved session |
| `radius` | Radius setup, artifact publication and artifact access |
| `library` | Skills, prompts and review of agent-proposed edits |
| `providers` | Provider sign-in, API keys and account management |
| `mcp` | MCP server setup and authorization |
| `webhooks` | Webhook configuration, testing and session event delivery |
| `voice-input` | Microphone setup, recording and transcription into a draft |
| `data-controls` | Archiving sessions and restoring archived sessions |
| `settings` | Settings sections and their navigation |

Pi loads its tool entry points from [extensions](../extensions). The browser and server assemble features in [web/src/app](../web/src/app) and [server/app](../server/app). The HTTP endpoint registry and WebSocket protocol remain in [shared](../shared). Reusable browser controls and transport live in [web/src/shared](../web/src/shared). The shadcn CLI owns [components/ui](../web/src/components/ui). The server shares storage and runtime utilities through [server/shared](../server/shared).

Keep `web → shared ← server`. Put feature-specific behavior and its tests under its owner. Keep runtime-shared modules independent of application wiring and feature implementations. Use distinct module names within a directory, including when extensions or capitalization differ. The [verification map](../.agents/skills/verify-piano/features/README.md#features) connects the inventory to user journeys.

Changes to these decisions belong in a new or superseding ADR, with the affected invariant IDs
and verification consequences made explicit. Routine implementation choices remain within the
accepted direction.
