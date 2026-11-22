# Usage

To start your first session, open **Settings → Providers** and sign in if Pi does not already have credentials. Choose **Home**, then **New session** in the sidebar. Select the folder you want Pi to work in, write your request, and send it. [Run Piano](../README.md#run-piano) · [Start or continue a session](../features/sessions/README.md)

## Work in a session

| I want to… | Guide |
| --- | --- |
| Continue a conversation, attach an image, or read an earlier answer | [Start or continue a session](../features/sessions/README.md) |
| Choose a model or change how much effort it spends on an answer | [Choose a model and effort level](../features/models/README.md) |
| Dictate a message and edit it before sending | [Dictate a message](../features/voice-input/README.md) |
| Read a file, inspect a diff, or check a pull request | [Work with a checkout](../features/workspace/README.md) |
| Give part of a task to a separate session | [Delegate work to another session](../features/dispatch/README.md) |

## Find and organize work

| I want to… | Guide |
| --- | --- |
| Group related sessions or give them common instructions | [Projects](../features/projects/README.md) |
| Switch between sessions or rearrange my view | [Navigate between sessions](../features/navigation/README.md) |
| Find a project, session, or action with the keyboard | [Search sessions, projects and commands](../features/commands/README.md) |
| Clear old sessions from the sidebar and restore them later | [Archive and restore sessions](../features/data-controls/README.md) |

## Set up tools and share results

| I want to… | Guide |
| --- | --- |
| Sign in to a model provider or use an API key | [Connect a model provider](../features/providers/README.md) |
| Give Pi access to tools on an MCP server | [Connect Pi to an MCP server](../features/mcp/README.md) |
| Reuse instructions or a prompt across sessions | [Skills and prompts](../features/library/README.md) |
| Publish a report or another artifact to Radius | [Set up Radius](../features/radius/README.md) |
| Share a copy of a saved conversation | [Share a saved session](../features/sharing/README.md) |
| Receive a notification when a session needs attention | [Send session events to a webhook](../features/webhooks/README.md) |

## Back up Piano's database

Piano keeps its folders, projects, session references and preferences in one SQLite file:
`~/.local/share/piano/piano.db`, or `$XDG_DATA_HOME/piano/piano.db` when `XDG_DATA_HOME` is set.
Set `PIANO_DB_PATH` to use another file. Pi keeps the session histories, not this file.

- To back up by copying, stop Piano first, then copy `piano.db` and any `piano.db-wal` beside it.
- While Piano runs, use SQLite's backup command instead:
  `sqlite3 ~/.local/share/piano/piano.db ".backup piano-backup.db"`.
- Run one Piano per database. If a second one writes to it, the first one's next write fails until
  you restart it.
