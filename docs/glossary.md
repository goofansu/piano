# Piano domain glossary

These terms describe the target model in [ADR 0001](adr/0001-pi-rpc-workspace-workbench.md).
They do not imply that every object or capability is already implemented.

| Term | Meaning |
| --- | --- |
| Project | A named, bounded initiative grouping sessions from any folders toward one outcome; see [Projects](#projects). |
| Folder | An added root directory together with the worktrees created from it. Sessions in a worktree are listed under their folder with the branch beside them. A non-Git directory is listed the same way with a Non-Git badge. |
| Directory | A filesystem path a session runs in: a repository root, one of its worktrees, or any other folder. The New page picks a directory; the sidebar groups by repository. |
| Worktree | A Git checkout; Worktrunk is the initial backend for its lifecycle. |
| Workspace | Piano's context around a folder root or worktree, attaching sessions, revision, processes, evidence and integration state. |
| Session | One Pi conversation with Pi-owned history; an active session has one supervised RPC child. |
| Task | An intended outcome that may span sessions; session completion does not establish task acceptance. |
| Acceptance criterion | An observable requirement with an identity and captured version, against which evidence can be evaluated. |
| Revision | A captured identity for relevant repository content, including uncommitted inputs; HEAD alone is insufficient. |
| Evidence | Recorded observations with revision, environment and execution provenance, such as test results or browser assertions. |
| Verification | Evaluation of evidence against identified acceptance criteria and project policy. It has a bounded scope and can become stale. |
| Approval | A human or authorized policy decision permitting a specific action on a specific candidate, subject to its recorded conditions. |
| Integration | Applying the approved candidate to a target. Local branch integration and forge PR merge are distinct actions. |
| Registry | Piano's folders, projects, workspace identities, session references and preferences; not a transcript or evidence database. |
| Skill | Agent instructions for a method or discipline, loaded by Pi; skill use does not by itself constitute evidence. |
| Control plane | Piano's coordination of workspaces, execution lifecycle, observations and guarded actions. It does not prescribe a development methodology. |

## Projects

The [project plan](outcome-projects.md) and [ADR 0002](adr/0002-outcome-projects.md) separate
organization from execution. Grouping is implemented; shared context/instructions remain planned.
Earlier documents call a project an "outcome project".

| Term | Meaning |
| --- | --- |
| Project membership | An explicit association between a session and a project, independent of the session's execution location. |
| Shared project context | Background and reference material supplied to member sessions to support the project's goal; a later capability. |
| Shared project instructions | Project-scoped guidance supplied to member sessions, distinct from background material and subject to explicit application rules; a later capability. |

A repository can support multiple projects, and a project can span repositories.
A task is a narrower intended outcome that may contribute to a project; neither tasks nor a task
hierarchy are required for grouping sessions. Workspaces still identify where execution happens.
The sidebar groups sessions by folder, by project or not at all. Code, wire and SQLite use the same
names: `folders` for added directories and `projects` for groupings.

An agent can be settled while a task is unfinished. Tests can pass while an acceptance criterion
remains unverified. A verified candidate still needs whatever integration approval project policy
requires. Preserve these distinctions in UI, code and documentation.
