# Projects

Status: Step 1 implemented; Step 2 remains deferred. See the
[implementation evidence](research/outcome-projects-step1.md) for verification and limitations.
[ADR 0002](adr/0002-outcome-projects.md) records the boundary decision. The
[glossary](glossary.md#projects) defines the vocabulary. Earlier revisions called these "outcome projects".

## Goal

Organize work around a bounded outcome rather than a directory. A project such as **Launch
subscriptions** can involve API, web and infrastructure repositories, while the web repository also
supports **Improve accessibility**. Neither project owns those repositories or their lifetime.

The user wants shared context and instructions eventually, but the first step is organizing related
work. Ship that useful slice without making instruction delivery, task tracking or orchestration a
prerequisite. This complements the [daily-use priority](roadmap.md#current-priority-joyful-daily-use);
it does not resume the deferred evidence/integration phases.

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
a root with its worktrees; a non-Git directory is listed the same way with a Non-Git badge. The
sidebar's view menu groups sessions by folder, by project (with a No project group) or not at all.
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
  access remain available. Projects had an archive state at first; it was retired because finished
  projects were rarely revisited, and opening a registry older than version 9 brings each archived
  project back as an ordinary one with its members.
- Unlinking a session does not delete it. Closing a repository does not cascade-delete the outcome
  project or its associations. A missing checkout/history is an explicit unavailable state, not
  a reason to silently recreate or drop the reference. Explicit session-reference removal must also
  remove its association without deleting the project or other members.
- Keep the view quiet: project name, sessions and essential actions. No synthetic
  progress percentages, mandatory task board or permanent implementation-status banners.
- Provide equivalent command-palette entries for new sidebar/header actions, under the existing
  command groups and with matching names. Mod+K remains the only global shortcut.

### Compatibility and ownership

Extend/version the registry with a backup and validated migration. Preserve current directory
selections, workspace IDs, `(cwd, sessionId)` references and Pi history paths. Existing sessions begin
ungrouped; do not turn each existing directory into a project automatically. Reject malformed
or incompatible data with recovery guidance rather than resetting it.

Registry owns the grouping metadata and references. Pi remains authoritative for conversations and
configuration; Git owns repository facts; Worktrunk remains behind checkout lifecycle operations.
Grouping does not change host acquisition or create another Pi child for an already open session.
A directory's existing trust decision does not change when its sessions join a project.

### Exit gate

In scratch repositories and a separate registry, observe through the browser:

- One project groups sessions from two repositories; a second project uses another session from one
  of those same repositories. Switching groups never switches a session's cwd or relabels its diff.
- An empty project and an ungrouped session are usable; reload/restart preserves memberships.
- Moving/unlinking a session and deleting a project preserve conversation access and
  running execution. Unavailable members are explained without silent data loss.
- Migrating an old registry preserves its existing references, leaves sessions ungrouped, and has a
  usable backup. A malformed registry is not overwritten.

Use existing coverage where sufficient; add focused regression checks for new association,
non-destructive lifecycle and migration risks. Follow [the testing policy](testing.md), including
`npm test`, typecheck and retained scratch-browser output.
Observed outcomes are recorded in the [Step 1 evidence](research/outcome-projects-step1.md).
The implementation uses registry v2 with an exact pre-migration backup. Restore that backup only
with the backend stopped; older Piano versions cannot read v2. Restoring it discards all subsequent
registry edits, including newly added session references, but does not delete Pi-owned conversations.
A project is a group in the sidebar beside the repositories, and `/projects/<id>` is its home:
one card per member session, newest activity first, with its title, folder, branch (the one
Piano registered once Git no longer lists the worktree), saved pull request number and last
activity. The cards draw only from what the browser already holds (PIN-83). Above them, the home
has the New page's composer: a session started there joins the project, and runs by default in the
folder of the member session active most recently (at the folder's own checkout), else wherever
the person picks. `/projects/<id>/new` is its New page, where a session started joins it too. Closed-directory and archived-session references remain reachable
from the group and from session search.

## Step 2 — Shared context and instructions, later

Make project background and working instructions available consistently to member sessions,
without replacing the selected checkout's normal Pi configuration or treating another conversation's
entire history as shared context. This is a separate slice after grouping proves useful.

**Shipped first: plain project instructions.** A project has optional instructions, one text of
up to 20,000 characters kept in Piano's database (registry version 10) and edited, with the name,
in the Project settings dialog (its home's header, the project menu or Mod+K on the home). Each
time Piano starts Pi for a
member session, new or reopened, it passes the project's current instructions in the child's
environment, and Piano's own extension adds them on every run as a `project_instructions` system
prompt section. Pi's own sections, including the user's and the checkout's `APPEND_SYSTEM.md`,
stay as Pi loads them; Pi's `--append-system-prompt` is not used because it replaces that file.
An edit applies from the session's next Pi start, never to a running Pi; a session moved out of
the project starts without them. Not yet built from the list below: versioned content, a record of
which version a session received, and background material distinct from instructions.

Before extending it, resolve and document:

- **Content and ownership:** distinguish background/reference material from instructions; choose a
  versioned content store and registry references without growing the registry into a document or
  evidence database. Do not add dormant instruction fields during Step 1.
- **Delivery and precedence:** inspect the then-supported Pi interfaces and resource-loading behavior.
  Specify how explicitly supplied project instructions compose with user and checkout instructions;
  retain Pi's configuration/trust handling rather than building a second loader or silently rewriting
  repository instruction files.
- **Application boundary:** define behavior for new, resumed and running sessions, edits to shared
  material, and sessions moved between projects. Start with explicit application at a defined boundary,
  not silent retroactive replacement or injection into an active turn. Previously delivered content
  remains part of Pi-owned history; reassignment cannot promise to erase it.
- **Provenance and failure:** record the content version actually supplied to a session, make it
  inspectable on demand, and distinguish saved content from successful delivery. Missing content,
  conflicting instructions and uncertain delivery must have explicit recovery behavior.
- **Scope:** sharing text does not grant filesystem access, trust a repository, coordinate agents or
  authorize integration. If shared material changes acceptance requirements, future verification must
  reevaluate the affected requirement versions rather than preserving a falsely current conclusion.

The later gate must show two sessions in different workspaces receiving the intended version,
no leakage to an unrelated project, unchanged checkout configuration/trust, and explicit behavior for
edits, reassignment, reload and failed delivery. A saved setting alone is not evidence of delivery.
This plan deliberately does not select a Pi injection mechanism or promise arbitrary hot updates.

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
