# Piano domain glossary

This glossary is the source of truth for Piano's vocabulary: use these terms in code, wire,
SQLite, UI and documentation. Some describe the target model in
[ADR 0001](adr/0001-pi-rpc-workspace-workbench.md) and are not implemented yet.

| Term | Meaning |
| --- | --- |
| Project | A named, bounded initiative grouping sessions from any folders toward one outcome; see [Projects](#projects). |
| Folder | An added root directory together with the worktrees created from it. Sessions in a worktree are listed under their folder with the branch beside them. A non-Git directory is listed the same way, without a branch label. |
| Directory | A filesystem path a session runs in: a repository root, one of its worktrees, or any other folder. The New page picks a directory; the sidebar groups by repository. |
| Checkout | The directory on disk a session runs in: a folder root, one of its worktrees, or another directory. A session whose checkout is gone keeps its history but cannot continue until the directory is restored at the same path. |
| Worktree | A Git checkout of a folder. Piano lists worktrees from Git and creates new ones through Worktrunk (`wt`), the initial backend for their lifecycle. |
| Workspace | Piano's context around a folder root or worktree, attaching sessions, revision, processes, evidence and integration state. Each has a registry ID, which URLs carry in place of its path. |
| Session | The Pi session, with Pi-owned history and identity. Use "session" for the entity and its lifecycle, never "thread". |
| Page | A main-pane view other than a session: the New page, the Projects index, a project's home, or Session not found. Opening one leaves the selected session; each has its own address. |
| Conversation | The user messages and final assistant replies within a session, rather than its tool activity or intermediate assistant output. Use for navigation through that exchange, such as "Top of conversation" and "End of conversation"; not a separate session identity. |
| Agent area | The selected session's interaction region: transcript, tool activity and composer. It is the session's default content and has no title of its own; "Agent" names it only as a tab where the areas take turns on a narrow screen. |
| Surface area | The selected session's inspection region beside the Agent area, showing views of the session's workspace as tabs: Changes, Preview while that session's app is open there, and the files links opened. Name the view ("Changes", "Preview"), never "Surface", in the UI. |
| Session rail | The selected session's column of facts: its workspace, outputs and links. One switch for every session ("Show session rail" / "Hide session rail"), remembered by the browser; beside the Agent area it shares the right side with the Surface area, and whichever came in last shows. Where the areas take turns it has no room and does not show. Not "Details", which names the Details popovers. |
| Task | An intended outcome that may span sessions; session completion does not establish task acceptance. |
| Acceptance criterion | An observable requirement with an identity and captured version, against which evidence can be evaluated. |
| Revision | A captured identity for relevant repository content, including uncommitted inputs; HEAD alone is insufficient. |
| Evidence | Recorded observations with revision, environment and execution provenance, such as test results or browser assertions. |
| Verification | Evaluation of evidence against identified acceptance criteria and project policy. It has a bounded scope and can become stale. |
| Approval | A human or authorized policy decision permitting a specific action on a specific candidate, subject to its recorded conditions. |
| Integration | Applying the approved candidate to a target. Local branch integration and forge PR merge are distinct actions. |
| Registry | Piano's SQLite store of folders, projects, workspace identities, session references and preferences; not a transcript or evidence database. |
| Skill | Agent instructions for a method or discipline, loaded by Pi; skill use does not by itself constitute evidence. |
| Control plane | Piano's coordination of workspaces, execution lifecycle, observations and guarded actions. It does not prescribe a development methodology. |

## Projects

The [project plan](outcome-projects.md) and [ADR 0002](adr/0002-outcome-projects.md) separate
organization from execution. Grouping is implemented; shared context/instructions remain planned.
Earlier documents call a project an "outcome project".

| Term | Meaning |
| --- | --- |
| Project membership | An explicit association between a session and a project, independent of the session's execution location. |
| Shared project context | Background and reference material supplied to member sessions to support the project's outcome; a later capability. |
| Shared project instructions | Project-scoped guidance supplied to member sessions, distinct from background material and subject to explicit application rules; a later capability. |

A repository can support multiple projects, and a project can span repositories.
A task is a narrower intended outcome that may contribute to a project; neither tasks nor a task
hierarchy are required for grouping sessions. Workspaces still identify where execution happens.
The sidebar groups sessions by folder, by project or not at all. Code, wire and SQLite use the same
names: `folders` for added directories and `projects` for groupings. Pi's own "project trust" keeps
Pi's name; it is unrelated to Piano projects.

An agent can be settled while a task is unfinished. Tests can pass while an acceptance criterion
remains unverified. A verified candidate still needs whatever integration approval project policy
requires. Preserve these distinctions in UI, code and documentation.
