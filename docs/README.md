# Development direction

Read these in order:

1. [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md).
2. [Development invariants](development-invariants.md): target contracts. A documented invariant
   is not a claim that it is implemented.

## Feature inventory

Each feature has a single source root. Open its guide to find its behavior, implementation and checks.

| Directory | What it owns |
| --- | --- |
| [projects](../features/projects/README.md) | Project index, project home, membership and settings |
| [navigation](../features/navigation/README.md) | Browser routes and history, sidebar, session switching and panel layout |
| [commands](../features/commands/README.md) | Command palette, search, shortcuts and contextual actions |
| [sessions](../features/sessions/README.md) | Starting and continuing sessions, drafts, attachments, agent questions, transcripts, Pi lifecycle and saved history |
| [dispatch](../features/dispatch/README.md) | Creating child sessions, waiting for their results and reporting their status |
| [workspace](../features/workspace/README.md) | Folder selection and trust checks, Git worktrees, changes, pull requests and file previews |
| [models](../features/models/README.md) | Model discovery, model and effort selection, and defaults |
| [sharing](../features/sharing/README.md) | Confirming and sharing a saved session |
| [radius](../features/radius/README.md) | Radius setup, artifact publication and artifact access |
| [library](../features/library/README.md) | Skills, prompts and review of agent-proposed edits |
| [providers](../features/providers/README.md) | Provider sign-in, API keys and account management |
| [mcp](../features/mcp/README.md) | MCP server setup and authorization |
| [webhooks](../features/webhooks/README.md) | Webhook configuration, testing and session event delivery |
| [voice-input](../features/voice-input/README.md) | Microphone setup, recording and transcription into a draft |
| [data-controls](../features/data-controls/README.md) | Archiving sessions and restoring archived sessions |
| [settings](../features/settings/README.md) | Settings sections and their navigation |

A feature keeps its browser code in `web/`, server services in `server/`, wire contracts in `contracts/`, Pi extensions in `extension/` and focused tests in `tests/`. Only the directories the feature uses are present.

The [browser](../web/src/app) and [server](../server/app) compose features. Reusable code lives in [browser shared](../web/src/shared), [server shared](../server/shared) and the [portable protocol](../shared). Oxlint checks runtime boundaries and feature ownership for imports, including type imports and re-exports. The [verification map](../.agents/skills/verify-piano/features/README.md#features) lists the browser journeys.

Changes to these decisions belong in a new or superseding ADR, with the affected invariant IDs
and verification consequences made explicit. Routine implementation choices remain within the
accepted direction.
