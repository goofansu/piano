# Projects

[ADR 0002](adr/0002-outcome-projects.md) records the boundary decision. The
[glossary](glossary.md#projects) defines the vocabulary.

## Step 2 — Shared context and instructions, later

Make project background and working instructions available consistently to member sessions,
without replacing the selected checkout's normal Pi configuration or treating another conversation's
entire history as shared context. This is a separate slice after grouping proves useful.

**Shipped first: plain project instructions.** A project has optional instructions, one text of
up to 20,000 characters kept in Piano's database (registry version 10), given with the name in the
New project dialog or edited later in the Project settings dialog (its home's header, the project
menu or Mod+K on the home); both dialogs show the same two fields. Each
time Piano starts Pi for a
member session, new or reopened, it passes the project's current instructions in the child's
environment, and Piano's `piano-project` extension adds them on every run as a `project_instructions` system
prompt section. Pi's own sections, including the user's and the checkout's `APPEND_SYSTEM.md`,
stay as Pi loads them; Pi's `--append-system-prompt` is not used because it replaces that file.
An edit applies from the session's next Pi start, never to a running Pi; a session moved out of
the project starts without them. Not yet built from the list below: versioned content, a record of
which version a session received, and background material distinct from instructions.
