# Piano domain glossary

This glossary is the source of truth for Piano's vocabulary: use these terms in code, wire,
SQLite, UI and documentation.

| Term | Meaning |
| --- | --- |
| Project | A named, bounded initiative grouping sessions from any folders toward one outcome; see [Projects](#projects). |
| Folder | An added root directory together with the worktrees created from it. |
| Directory | A filesystem path a session runs in: a repository root, one of its worktrees, or any other folder. |
| Checkout | The directory on disk a session runs in: a folder root, one of its worktrees, or another directory. |
| Workspace | Piano's context around a folder root or worktree, attaching sessions, revision, processes, evidence and integration state. Each has a registry ID, which URLs carry in place of its path. |
| Session | The Pi session, with Pi-owned history and identity. Use "session" for the entity and its lifecycle, never "thread". |
| Running session | A session whose Pi is running or starting, including while idle or waiting for input. Not merely the session selected on screen, and not only one that is Working. |
| Page | A main-pane view other than a session: the New page, the Projects index, a project's home, or Session not found. Opening one leaves the selected session; each has its own address. |
| Session pane | The main pane when it is not on a page: a session shown or being selected, a session being created (addressed `/new` until it has an ID), a selection that failed (kept at the session's address with its Retry), or an unresolved deep link. Closing Settings returns to it unless it holds nothing. |
| Conversation | The user messages and final assistant replies within a session, rather than its tool activity or intermediate assistant output. Use for navigation through that exchange, such as "Top of conversation" and "End of conversation"; not a separate session identity. |
| Agent area | The selected session's interaction region: transcript, tool activity and composer. It is the session's default content and has no title of its own; "Agent" names its tab only in the one-area-at-a-time layout when inspection tabs exist. |
| Inspector | The selected session's inspection region, showing views of the session's workspace as tabs: Changes and the files links opened. It appears beside or instead of the Agent area; name the view ("Changes"), never "Inspector", in visible UI text. |
| One-area-at-a-time | The session layout showing either the Agent area or the Inspector, with shared navigation when inspection tabs exist and no Agent tab otherwise. The session rail is unavailable in this layout; it is not limited to narrow viewports or phones. |
| Side-by-side | The session layout keeping the Agent area shown, with room on its right for either the Inspector or the session rail, whichever was brought in last. Neither must be open; this does not mean three simultaneous columns. |
| Session rail | The selected session's column of facts about its workspace and outputs, available only side-by-side and sharing the right side with the Inspector. One switch applies to every session, remembered by the browser: "Show session rail" / "Hide session rail". Not "Details", which names the Details popovers. |
| Artifact | A document a session published to Radius with the bundled artifact tools, opened at its Radius URL. The session header's Artifacts menu lists them by title; not a file Pi wrote (an output). |
| Task | An intended outcome that may span sessions; session completion does not establish task acceptance. Not implemented yet. |
| Acceptance criterion | An observable requirement with an identity and captured version, against which evidence can be evaluated. Not implemented yet. |
| Revision | A captured identity for relevant repository content, including uncommitted inputs; HEAD alone is insufficient. Not implemented yet. |
| Evidence | Recorded observations with revision, environment and execution provenance, such as test results or browser assertions. Not implemented yet. |
| Verification | Evaluation of evidence against identified acceptance criteria and project policy. It has a bounded scope and can become stale. Not implemented yet. |
| Approval | A human or authorized policy decision permitting a specific action on a specific candidate, subject to its recorded conditions. Not implemented yet. |
| Integration | Applying the approved candidate to a target. Local branch integration and forge PR merge are distinct actions. Not implemented yet. |
| Registry | Piano's SQLite store of folders, projects, workspace identities, session references and preferences; not a transcript or evidence database. In UI strings, say "Piano's database". |
| Prompt | A Pi prompt template created in Piano, offered as a `/name` command in the composer. Settings lists only these; Pi's own prompt templates stay Pi's. |
| Skill | Agent instructions for a method or discipline, loaded by Pi; skill use does not by itself constitute evidence. |
## Projects

| Term | Meaning |
| --- | --- |
| Project membership | An explicit association between a session and a project, independent of the session's execution location. |
| Done (project) | The user's reversible mark that a project's outcome is finished. It changes nothing about its sessions; a session started in it reopens it. Not verification, approval or archive. |

A repository can support multiple projects, and a project can span repositories. Neither tasks
nor a task hierarchy are required for grouping sessions. Pi's own "project trust" keeps Pi's name;
it is unrelated to Piano projects.

An agent can be settled while a task is unfinished. Tests can pass while an acceptance criterion
remains unverified. A verified candidate still needs whatever integration approval project policy
requires. Preserve these distinctions in UI, code and documentation.
