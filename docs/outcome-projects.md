# Projects

[ADR 0002](adr/0002-outcome-projects.md) records the boundary decision. The
[glossary](glossary.md#projects) defines the vocabulary.

## Project instructions

Each time Piano starts Pi for a member session it passes the project's current instructions in
the child's environment, and the `piano-project` extension adds them as a `project_instructions`
system prompt section. Pi's `--append-system-prompt` is not used because it replaces the user's
and the checkout's `APPEND_SYSTEM.md`.
