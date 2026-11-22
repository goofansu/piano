# Using Piano

To start your first session, open **Settings → Providers** and sign in if Pi does not already have credentials. Choose **Home**, then **New session** in the sidebar. Select the folder you want Pi to work in, write your request, and send it. [Install Piano](../README.md#run-piano) · [Start and continue sessions](../features/sessions/README.md)

## Work in a session

| I want to… | Guide |
| --- | --- |
| Continue a conversation, attach an image, or read an earlier answer | [Sessions](../features/sessions/README.md) |
| Choose a model or change how much effort it spends on an answer | [Models and effort](../features/models/README.md) |
| Dictate a message and edit it before sending | [Voice input](../features/voice-input/README.md) |
| Read a file, inspect a diff, or check a pull request | [Workspace](../features/workspace/README.md) |
| Give part of a task to a separate session | [Dispatch work](../features/dispatch/README.md) |

## Find and organize work

| I want to… | Guide |
| --- | --- |
| Group related sessions or give them common instructions | [Projects](../features/projects/README.md) |
| Switch between sessions or rearrange my view | [Navigation](../features/navigation/README.md) |
| Find a project, session, or action with the keyboard | [Search and commands](../features/commands/README.md) |
| Clear old sessions from the sidebar and restore them later | [Data controls](../features/data-controls/README.md) |

## Set up tools and share results

| I want to… | Guide |
| --- | --- |
| Sign in to a model provider or use an API key | [Providers](../features/providers/README.md) |
| Give Pi access to tools on an MCP server | [MCP](../features/mcp/README.md) |
| Reuse instructions or a prompt across sessions | [Skills and prompts](../features/library/README.md) |
| Publish a report or another artifact to Radius | [Radius](../features/radius/README.md) |
| Share a copy of a saved conversation | [Session sharing](../features/sharing/README.md) |
| Receive a notification when a session needs attention | [Webhooks](../features/webhooks/README.md) |

## Back up Piano's database

`server/shared/registry/RegistryDatabase.ts` owns the SQLite schema and its in-place upgrades. Run one backend
per database: when a second backend writes, the first backend's next write fails, and that
backend needs a restart. SQLite runs in WAL mode: to back up by copying files, stop Piano first;
while Piano runs, use SQLite's backup API.
