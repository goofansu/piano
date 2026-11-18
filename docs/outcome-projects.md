# Projects

[ADR 0002](adr/0002-outcome-projects.md) records the boundary decision. The
[glossary](glossary.md#projects) defines the vocabulary.

## Model and terminology

- **Project:** a named, bounded initiative that groups related work independently of where
  it runs. It has an identity independent of its name or any filesystem path and can start empty.
- **Folder/directory:** a code or working location, potentially used by many projects.
  Non-Git directories remain supported; do not rename every existing directory a repository.
- **Workspace:** the execution context around one selected root or worktree. Grouping must not
  change its identity, path, revision, processes or evidence.
- **Session:** one Pi conversation, still associated with its actual workspace. A project groups
  session references; it does not copy or merge conversations.
- **Task:** a narrower intended outcome that may span sessions. Projects may eventually organize
  tasks, but the first slice requires neither task records nor a task hierarchy.

The UI now uses **Project** for outcomes and **Folders** for the sidebar's location groups, each
a root with its worktrees; a non-Git directory is listed the same way without a branch label. The
sidebar's view menu groups sessions by date, by folder or by project (with a No project group).
Code uses the same words: `folders` for locations and `projects`/`projectId` for organization.

## Step 1 — Organize sessions across repositories

### User journey

1. Create **Launch subscriptions** with a name, without choosing a directory.
2. Add existing API and web sessions, or start a new session from the project by explicitly choosing
   its working directory/worktree. Starting outside a project remains supported.
3. Return to the project and find those sessions together. Opening one still identifies its actual
   workspace and shows only that workspace's changes.
4. Rename, move/remove a session association, or delete the project without moving code,
   changing session history or stopping running work.

The initial membership rule is **zero or one project per session**. This is a
simplicity trade-off, not a limitation on repository reuse: different sessions in the same repository
can belong to different projects. Moving a session is explicit and changes only its association.
Multi-project session membership can wait for a concrete need; it would also complicate future
instruction selection. Separate concurrent writing tasks still need separate workspaces (INV-07).

### Scope and boundaries

- Persist a stable project identity, name and explicit session
  associations in the registry. Reuse existing session/workspace references; no transcript copies,
  evidence bundles, synthesized Pi sessions or required project directory.
- Derive the participating locations from member sessions initially. Do not add a separate repository
  ownership hierarchy or infer membership for every session in a selected repository.
- A project has no goal or description field. An optional goal shipped at first and was removed to
  keep a project to its name. Opening a version-1 registry drops its `goal` column after saving a
  `<database>.v1-backup` copy (see the [configuration and storage](configuration.md#registry-storage)).
- Deleting a project removes the project and unlinks its sessions, which stay registered and move to
  No project. It is not session archive or delete, abort, process release, checkout removal,
  verification, approval or proof that the outcome was achieved; running work and direct session
  access remain available.
- Marking a project done (`doneAt`) is the reversible way to set a finished outcome aside without
  deleting its grouping: the index lists it under Done and the sidebar's project grouping puts it
  last, while its sessions keep their state, their Pi and their places in the sidebar and the
  palette. Reopen undoes it, and a session started in a done project reopens it; nothing marks a
  project done by itself. Projects had a hidden archive state at first; it was retired in registry
  version 9 because finished projects were rarely revisited once hidden, and opening an older
  registry brings each archived project back as an ordinary one with its members. Done differs
  in staying visible and one click from open.
- Unlinking a session does not delete it. Closing a repository does not cascade-delete the outcome
  project or its associations. A missing checkout/history is an explicit unavailable state, not
  a reason to silently recreate or drop the reference. Explicit session-reference removal must also
  remove its association without deleting the project or other members.
- Keep the view quiet: project name, sessions and essential actions. No synthetic
  progress percentages, mandatory task board or permanent implementation-status banners.
- Provide equivalent command-palette entries for new sidebar/header actions, under the existing
  command groups and with matching names.

### Compatibility and ownership

Extend/version the registry with a backup and validated migration. Preserve current directory
selections, workspace IDs, `(cwd, sessionId)` references and Pi history paths. Existing sessions begin
ungrouped; do not turn each existing directory into a project automatically. Reject malformed
or incompatible data with recovery guidance rather than resetting it.

Registry owns the grouping metadata and references. Pi remains authoritative for conversations and
configuration; Git owns repository facts; Worktrunk remains behind checkout lifecycle operations.
Grouping does not change host acquisition or create another Pi child for an already open session.
A directory's existing trust decision does not change when its sessions join a project.

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

## Guardrails and non-goals

| Invariants | Consequence for this plan |
| --- | --- |
| INV-01 | Registry owns grouping/references, not Pi history, Git facts or evidence. |
| INV-02–05 | Navigation and membership changes do not duplicate/restart execution, replay prompts or mix session events. |
| INV-06–08 | Grouping does not create/remove checkouts, change workspace identity or produce a combined multi-repository revision. |
| INV-09–10 | Deletion/organization is not verification or approval; future shared requirements retain versioned acceptance semantics. |
| INV-11–13 | Project membership grants no trust/authorization; shared instructions preserve Pi loading and remain skill-agnostic. |

No automatic multi-repository execution, cross-repository merge transaction, inherited permissions,
mandatory issue tracker, task hierarchy, dependency graph or completion scoring is included. A future
aggregate project status must preserve each workspace's bounded evidence and integration outcomes.
