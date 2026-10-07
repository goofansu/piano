# Claude Code diff mod: implementation and review lessons

Date: 2026-10-07. Research only; no Piano behavior changed.

## Scope and evidence

Investigated the built-in `cc-plugin-diff`, not automated code review or the separate desktop Git UI.
Used official docs and inspected public source at revision
`765f236fe1bfcc678e0ec59af9170fb7d6771a3a` of `anthropics/claude-code`.
Checkout: `~/.cache/checkouts/github.com/anthropics/claude-code`.
No live Claude session or upstream test suite was run. Research was direct because this harness has
no background-agent tool. Source inspection establishes implementation at this revision, not behavior
of every shipped Claude version.

## Sources

- [Interactive mode: /diff](https://code.claude.com/docs/en/interactive-mode#review-changes-with-%2Fdiff)
- [Built-in mods and public source](https://code.claude.com/docs/en/plugins/mods/overview#mods-built-into-claude-code)
- [Mod README](https://github.com/anthropics/claude-code/blob/765f236fe1bfcc678e0ec59af9170fb7d6771a3a/mods/diff/README.md)
- [Event orchestration](https://github.com/anthropics/claude-code/blob/765f236fe1bfcc678e0ec59af9170fb7d6771a3a/mods/diff/hooks/register.ts)
- [Git backend](https://github.com/anthropics/claude-code/blob/765f236fe1bfcc678e0ec59af9170fb7d6771a3a/mods/diff/hooks/git/git-backend-of.ts)
- [Pre-session classification](https://github.com/anthropics/claude-code/blob/765f236fe1bfcc678e0ec59af9170fb7d6771a3a/mods/diff/hooks/git/probes/tag-pre-session.ts)
- [Turn assembly](https://github.com/anthropics/claude-code/blob/765f236fe1bfcc678e0ec59af9170fb7d6771a3a/mods/diff/hooks/turns/turn-of/turn-of.ts)
- [Edit-result extraction](https://github.com/anthropics/claude-code/blob/765f236fe1bfcc678e0ec59af9170fb7d6771a3a/mods/diff/hooks/turns/turn-of/file-edit-of/file-edit-of.ts)
- [Hunk fetching](https://github.com/anthropics/claude-code/blob/765f236fe1bfcc678e0ec59af9170fb7d6771a3a/mods/diff/hooks/git/fetch-hunks/fetch-hunks.ts)

## User experience

The current docs say the mod takes over `/diff`; disabling it restores the older built-in UI.
In fullscreen terminals it draws a docked pane beside the conversation. Classic rendering uses an
inline dialog above the prompt. The documented mod-based terminal experience requires v2.1.287+;
earlier articles about the original live pane describe an older implementation.

The docked pane has a pinned header and file list, with additions/deletions per file and scrolling
hunks below. Clicking a file jumps to its hunks. The list scrolls independently when too long.
The classic dialog instead navigates list → one file → back. These are useful desktop and mobile
layout analogies, but this research did not establish a mobile Claude diff UI. [Interactive docs; README]

The pane can auto-open on the first main-agent edit at 144 columns, or 110 if the user previously
kept it open. Explicit close is remembered. Manual opening needs 110 columns in fullscreen mode.
It refreshes after edits and shell commands, and polls HEAD while open to detect external commits
or checkouts. This is not evidence of comprehensive live watching of external file edits. [README; register]

The file list initially folds test/generated files and earlier changes behind expandable counts.
An `ask` button attaches one file's displayed hunks to the next prompt; `asked ✓` indicates it is
armed. Choosing another file replaces the attachment. Sending consumes it once; a context budget
can truncate it or cause it to be dropped with a status message. This is file-level feedback,
not the line-selection workflow described for earlier panel versions. [Interactive docs; register]

## The important distinction: two sources, three comparison modes

### Current: Git state

The three Git comparison modes are:

1. **Session grouping (default):** working tree against HEAD, with pre-session files folded.
2. **All uncommitted:** working tree against HEAD without that session split.
3. **Branch:** working tree against the merge-base with the default branch.

The selected mode persists per repository. Git discovery is lazy, pinned to the session's checkout;
the mod does not snapshot all file contents at session start. [README; Git backend]

**Session grouping is a heuristic, not an exact session diff.** At the first Git fetch it records
the set of dirty paths. A file can be tagged pre-session when its timestamp precedes session start
and it is in that initial dirty set. Paths it cannot date remain visible. A resumed session retains
its original session start. [Git backend; pre-session classification; README]

Consequences inferred from this code:

- Editing a previously dirty file can expose its entire HEAD-to-current diff, including older edits.
- Committing work can remove it from HEAD-based views; this is not a durable session result.
- Timestamp grouping does not establish authorship or exact before/after content.

Untracked files are listed, but the inspected implementation does not load patch bodies for them.
Hunk fetching also skips binaries, renames, and certain stale paths. Therefore a listed file does not
promise a complete inline review. The docs also say submodules appear only when their pointed-to
commit changes, not for edits inside the submodule. [Hunk fetching; README; interactive docs]

### T1, T2, …: recorded editing activity

A separate source picker chooses `Current` or a numbered turn. The mod reads session messages,
splits them at user prompts, and extracts file changes from structured tool results:

- `filePath` plus `structuredPatch`, or
- a created file's `content`, converted to an all-added hunk.

When a file was edited repeatedly, the turn assembler concatenates its patches and sums their line
counts. It does **not** compute one net before/after diff. A change followed by its reversal can thus
appear as activity even though the final file is unchanged. Turn data comes from history, not the
current Git diff, so it can remain available after committing. Shell-command edits are absent from
this source, as the official docs explicitly confirm. [Turn assembly; edit-result extraction;
interactive docs]

## How the mod works internally

It is an in-process JS/TS plugin, not an LLM-generated diff:

- Session start registers `/diff` and reads restored editing history.
- UI events draw the pane, measure available space, and handle scroll/focus.
- Edit/Write/NotebookEdit tool completion refreshes; successful main-agent edits can auto-open.
- Bash/PowerShell completion refreshes even after some failures, since partial writes may exist.
- Git stats and hunk bodies are loaded separately; refreshes are debounced, overlapping refreshes
  coalesced, and obsolete body results rejected using generation/base stamps.
- Prompt submission adds the armed diff as context once.

These are source-observed mechanisms, not proof of an atomic checkout snapshot. [register]

## What Piano should borrow

Design judgment, consistent with [INV-01, INV-07–08 and INV-11](../development-invariants.md):

1. **One Changes entry, one review surface.** A stable file list and easy jump-to-hunk matter more
   than exposing every Git command. Use a full-screen file detail flow on mobile.
2. **Ask about this change.** Start with a per-file attachment to the composer; line selection can
   follow. Explicit send, not automatic execution. This is simpler than a full comment system.
3. **Separate current code from edit history.** If Piano reconstructs patches from tool output,
   call it recorded edits, not a complete net turn diff. Shell edits and repeated edits make this
   distinction material.
4. **Do not copy timestamp attribution as a correctness contract.** It can prioritize files, but
   cannot justify “exact changes in this session.” Exact net scopes need content captures.
5. **Show tests normally.** They are essential to review. Collapse generated/lockfile bodies if
   useful, but retain visible entries and counts rather than silently omitting them.
6. **Review new files fully.** Piano should support untracked text content and renamed-and-edited
   files rather than inherit the source revision's hunk omissions.
7. **Keep the review stable while reading.** Live updates are useful during work; preserve selected
   files/scroll and inspected context during feedback. Do not silently change what a draft refers to.

Compared with the [Codex research](2026-10-07-codex-changes-review.md), Claude makes an inexpensive
first release clearer: Git-backed Current + file-level Ask, with optional recorded turn edits.
A true net Last turn remains valuable, but requires a separate capture design; neither concatenated
tool patches nor mtime filtering is a substitute.

Verification: reviewed documentation/source distinctions and relative links; documentation-only,
so no application tests or deployment. Source tests were located but not executed.
