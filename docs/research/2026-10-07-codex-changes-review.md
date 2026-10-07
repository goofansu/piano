# Codex changes review: lessons for Piano

Date: 2026-10-07. Research only; recommendations are not implemented requirements.

## Question and conclusion

How does Codex display changes, and what should Piano borrow to make human review easy?

Borrow the review loop, not the entire Git client: open Changes, choose a meaningful scope,
read navigable diffs, attach precise feedback, and inspect the next result. Prioritize a stable
reading surface over session-authorship accounting. A full-session baseline is useful later,
but need not block a useful review experience.

## Sources and limits

1. [Official code review documentation](https://developers.openai.com/codex/app/review)
   — full page fetched; currently presents combined ChatGPT/Codex documentation. Local review-pane,
   automated `/review`, and pull-request features must not be conflated.
2. [Official troubleshooting](https://developers.openai.com/codex/app/troubleshooting)
   — search-extracted FAQ confirms repository-wide changes and Last turn scope.
3. [Official changelog](https://developers.openai.com/codex/changelog)
   — search-extracted entries report preserved diff/search state, scroll-jump fixes, consistent
   file-tree/diff ordering, expand/collapse controls, and large-review performance work.

This is documentation research, not a hands-on Codex app audit. No claim about proprietary snapshot
implementation, exact Last turn capture semantics, or undocumented mobile behavior is established.
Search page dates are not treated as feature release dates. Research was performed directly because
this harness exposes no background-agent tool.

## What Codex documents

| Behavior | Evidence |
| --- | --- |
| A review pane accompanies the conversation; it supports reading changes and line-specific feedback. | Source 1, Review in the app |
| Repository state is the default truth, including edits not made by Codex. Default scope is Unstaged. | Source 1, What changes it shows; source 2 |
| Scope choices include Unstaged, Staged, Commit, Branch, and Last turn. Last turn is the most recent assistant turn. | Source 1, What changes it shows |
| File-header backgrounds expand/collapse diffs; file names typically open an external editor. | Source 1, Navigating the review pane |
| Inline comments attach to specific diff lines. Users then explicitly ask the agent to address the feedback. | Source 1, Inline comments for feedback |
| Stage, unstage, and revert operate on the entire diff, a file, or a hunk. | Source 1, Staging and reverting files |
| Automated `/review` is separate from simply viewing the diff. Its uncommitted preset includes staged, unstaged, and untracked files; its base-branch preset finds the merge base. | Source 1, Choose a review scope |
| Pull-request Changes supports Mark as viewed, scoped to the displayed revision. This is not established as a local-pane feature. | Source 1, Inspect changed files and related pull requests |
| Navigation stability and large-review performance receive repeated improvements. | Source 3 |

Important distinction: the docs do not establish that Last turn uses a complete checkout snapshot,
or that Branch's visual pane includes uncommitted files. Do not infer those implementations from
scope labels or from the separate automated-review presets.

## Recommendation for Piano (design judgment)

### Entry and layout

- Footer control: **Changes**, optionally a file count. Add the same action to the View group in
  the command palette. Do not label repository observations as agent-authored changes.
- Desktop: conversation plus review panel, with file navigation and collapsible diffs in the same
  order. Selecting a file scrolls to its diff rather than launching an external editor.
- Mobile: full-screen review, a compact file picker and previous/next file controls, unified diff,
  Back restoring conversation position. Avoid a permanent file tree consuming narrow-screen space.
- Show file paths, change type, additions/deletions, line numbers, syntax highlighting, and enough
  unchanged context to understand each hunk. Allow expanding context and viewing the complete file.
- Preserve position, expanded files, and feedback while switching between conversation and review.
  Support search and expand/collapse all. Do not reflow the review underneath someone reading it.
- Render binaries and large files honestly with explicit fallbacks; do not silently omit them.

### Scopes: choose by the review question

| Piano scope | Question | Proposed semantics |
| --- | --- | --- |
| Uncommitted | What is not committed yet? | HEAD to current checkout content, including relevant untracked files. Combined staged/unstaged for reading, not a staging interface. |
| Last turn | What did the latest response change? | Persisted before/after content snapshots around a defined execution turn. Include committed work; exclude later edits. |
| Branch | What does this branch propose? | Selected target merge-base to captured current checkout, explicitly including uncommitted content. Show target in selector. |
| Since session start (defer) | What accumulated during this session? | Durable initial content snapshot to captured current state; shared-checkout edits are not agent attribution. |

Start with Uncommitted plus a selected-commit scope if shipping before turn capture. A committed
turn must not silently appear as “nothing changed”: a commit scope provides a manual inspection
route, but do not guess that the latest commit belongs to the session. Add Last turn as the preferred
scope when entering from a completed response; preserve a user's explicit scope while reviewing.
Branch scope is useful for dedicated worktrees, but can be noisy in a shared long-lived checkout.
Missing baselines should be unavailable, not reconstructed from transcript claims.

This revises the earlier recommendation to prioritize Since session start. For review ease,
Last turn is the smaller, more actionable unit, while Branch provides the overall result.

### Feedback is more valuable than Git buttons

Next priority after readable diffs: select lines, choose **Ask for a change**, and compose feedback
with file, old/new side, line range, and inspected revision attached. Let the user collect comments
and explicitly send them to the session; selection must not automatically run the agent.
Keep comments anchored to inspected content, detecting stale anchors after changes.

A per-file Viewed marker is useful for longer reviews (inspired by Codex's PR feature). Bind it to
the compared file content and clear it when that content changes. It means read, not verified.
Defer stage/revert controls, automated reviewer orchestration, and authorship accounting.

### Shared file viewer

Markdown transcript links can open the same workspace-bound viewer in Preview mode. Changed Markdown
files offer Diff / Preview; unchanged linked documents can still be read. Sanitize rendered content
and constrain backend file access to the intended project/worktree.

## Architecture and verification consequences

Follow [INV-01, INV-07–08, INV-11](../development-invariants.md): Git/filesystem observations own code
facts; every diff identifies its checkout and compared content; race detection or stable capture
prevents mismatched file lists and hunks; rendered code and Markdown remain untrusted content.
Keep Git comparisons and safe reads behind a deep module separate from Pi protocol translation.
Store durable captures outside registry config. Define turn capture lifecycle before promising Last
turn, including queued work, aborts, restart, and concurrent external edits. A snapshot identifies a
content interval, not exclusive authorship.

Smallest acceptance journey for implementation: finish a short change, open Changes on mobile,
find a relevant hunk, inspect surrounding context, request a line-specific correction, return to
conversation without losing place, and review the correction. Also verify already-committed work,
new untracked files, deleted/renamed files, concurrent edits, and missing historical baselines.

Documentation-only verification: checked source/scope distinctions and local invariant link;
no application changes, model calls, tests, or deployment required.
