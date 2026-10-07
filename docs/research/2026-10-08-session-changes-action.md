# A Changes action for the session page

Date: 2026-10-08. Research and recommendation only; no Piano behavior changed.

## Question

The session page needs a **Changes** action (session menu or footer) that opens something useful
for review. How do Codex, T3 Code and the Claude Code diff mod do it, and what should Piano build?

## Sources

- T3 Code at `d2c9281b8112dc3b2991642c4bdb985e4b08b9bb`, `~/.cache/checkouts/github.com/pingdotgg/t3code`.
- Codex at `c248f6d48b97eb4a2aa56147a0b11b7d763278b9`, `~/.cache/checkouts/github.com/openai/codex`
  (TUI, core and app-server protocol; the desktop review pane is closed source).
- The earlier notes on the [Codex review pane](2026-10-07-codex-changes-review.md) and the
  [Claude Code diff mod](2026-10-07-claude-diff-mod.md); their findings are summarized, not repeated.
- Piano: `server/WorkspaceRevisions.ts`, `POST /api/workspace/capture`, the removed
  `WorkspaceChanges` dialog (`git show 7158dfb^:web/src/components/WorkspaceChanges.tsx`), and the
  installed Pi edit tool (`dist/core/tools/edit.d.ts`: results carry `details.patch`, a unified patch).

Source inspection establishes implementation at those revisions, not behavior of every shipped build.

## How the three apps answer "what changed"

| | Claude Code diff mod | Codex | T3 Code |
| --- | --- | --- | --- |
| Entry | `/diff`; auto-opens on first edit in wide terminals | TUI `/diff`; desktop review pane | Right-panel **Diff** tab, `mod+d`, per-turn "Changed files" card in the timeline; auto-opens after a turn touching ≥3 files or ≥50 lines |
| Surface | Docked pane beside the conversation; classic inline dialog | Full-screen pager with git's own colors | Embedded panel; sheet overlay under 980px; maximize |
| Scopes | Session grouping (mtime heuristic), all uncommitted, branch; separate T1/T2 turn source | TUI: working tree vs index plus untracked. Desktop: Unstaged, Staged, Commit, Branch, Last turn | Working tree (HEAD vs worktree, untracked via `add --intent-to-add` in a temp index), Branch changes (merge-base..HEAD, committed only), Latest turn / Turn N |
| Turn diff source | Tool results (`structuredPatch`), concatenated per file, not net; shell edits absent | `TurnDiffTracker`: net diff from apply_patch deltas only; shell edits absent; `turn/diff/updated` notification | Git snapshots: `refs/t3/checkpoints/<thread>/turn/<n>` written at turn start and end with a temp index, `write-tree`, `commit-tree`; turn diff is `git diff A B`, so shell edits are included |
| Refresh | After Edit/Write/Bash tools; polls HEAD while open | On demand only | Window focus, manual button, and after a completed file-change or command tool |
| Actions | `ask` attaches one file's hunks to the next prompt | Desktop: inline line comments the user sends explicitly; stage/revert | Line comments inserted into the composer draft with path, range and snippet; open file; copy path. No stage/revert/viewed in the panel |
| Rendering | Pinned header and file list, hunks below | Git ANSI output; apply_patch cells show `Edited <path> (+N -M)` with numbered, highlighted lines | `@pierre/diffs` + `shiki-wasm`, stacked or split, collapse all, ignore whitespace, 120 KB cap then per-file lazy fetch |

Two lessons stand out:

1. **Git state is the default truth everywhere.** Each app opens on the working tree, not on an
   agent-attributed set. Attribution is a secondary scope and each app admits its limits.
2. **Only T3's snapshot refs give an exact per-turn diff.** Reconstructing from tool results
   (Claude, Codex) misses shell edits and, in Claude's case, is not even a net diff. Piano's own
   earlier notes reached the same conclusion; T3 shows the cheap way to do it with Git plumbing.

## What Piano already has

- `WorkspaceRevisions.capture` returns `stagedDiff`, `unstagedDiff` (untracked included), the
  revision ID, base HEAD, branch and limitations, with race detection (INV-07/08). The old dialog
  rendered these as two raw `<pre>` blocks and was retired with the hamburger menu in `7158dfb`.
  The endpoint and tests survived.
- Pi edit results carry `details.patch`; Piano's projection drops `details`, and the write tool
  reports none. Bash edits leave no record. So "recorded edits" are available cheaply but incomplete.
- `SessionView` already receives `onDraftAppend` (a `draft_appended` store action), which is the
  hook an "Ask about this" action needs.
- No diff renderer is installed; shadcn's registry has none. T3 uses `@pierre/diffs` (React 19
  peer dependency) with `shiki-wasm`.

## Recommendation

### Entry

- **Session menu item "Changes"** in `SessionHeader`, and a matching **Session commands** row in
  the command palette as AGENTS.md requires. Skip the footer: the composer toolbar is already full
  on phone widths, and Changes is a view, not a send-time option.
- Later, a per-turn line in the transcript ("Edited 3 files · +41 −7", from Pi's `details.patch`)
  that opens the same surface. Label it recorded edits; it is not a net diff.
- Auto-open after a large turn, as T3 does, is a desktop-only nicety for a later pass.

### Surface

A right **Sheet** (`npx shadcn@latest add sheet`): wide beside the transcript on desktop, full
screen on mobile. Header: scope picker, +/− totals, refresh, collapse/expand all. Body: one list of
files with sticky headers, per-file collapse, unified diff with syntax highlighting. A details
disclosure names the checkout path, branch, HEAD and capture revision; nothing else inline (quiet UI).

### Scopes, in delivery order

| Scope | Semantics | Source |
| --- | --- | --- |
| Working tree (default) | HEAD to checkout content, staged plus unstaged plus untracked, read as one diff | Existing capture, or a T3-style `--intent-to-add` temp index for `--numstat` and `--patch` |
| Branch | Merge-base with the default branch to checkout content, uncommitted included | New Git read behind the same module |
| Turn N / Latest turn | Snapshot before the turn to snapshot after it | Needs a checkpoint design (below) |

Ship Working tree first. It alone restores what the retired dialog did, in a readable form.

### Actions

1. **Ask about this file:** append path and the file's shown hunks to the composer draft through
   `onDraftAppend`. Explicit send only.
2. Copy path; open the file in the viewer when one exists.
3. Later: line-range comments collected into the draft, as T3 and Codex do. No stage/revert.

### Refresh

Capture on open, on window focus, and when an edit, write or bash tool completes while the sheet
is open, debounced; coalesce overlapping captures and drop stale responses (the retired dialog's
sequence guard still applies). Preserve the selected scope, collapsed files and scroll position
across refreshes so a reader is not reflowed mid-review.

### Turn checkpoints: decide before promising "Last turn"

T3's approach is a temporary `GIT_INDEX_FILE`, `add -A`, `write-tree`, `commit-tree`,
`update-ref refs/<app>/checkpoints/<session>/turn/<n>` at turn start and end, then `git diff A B`.
It is exact and includes shell edits, but it writes objects and refs into the user's repository.
Piano's capture store keeps bytes outside the repo, with a 64 MB cap and a byte copy per capture.
Either route works for Turn N; pick one in a short ADR because it touches INV-07/08 and "Git is
authoritative for repository facts". Recommended default: T3's route with a `refs/piano/` namespace,
pruned when a session is deleted, because it costs one tree write per turn and reuses Git's
object store.

### Rendering choice

Evaluate `@pierre/diffs` first (worker-pooled, handles `parsePatchFiles` of the capture's patch
text). If its bundle cost is unacceptable, a hand-rolled unified renderer over the existing capture
output is a fine v1; mark the component as hand-written per the design rule.

## Smallest verification journey

In a scratch repo registered in a scratch registry: edit a file through a short fake-Pi turn and
by hand (shell edit), open Changes from the session menu and from the palette, confirm both files
are listed with counts and the hunk is readable, use "Ask about this file" and read the draft back,
switch sessions and back and confirm the scope and collapsed state survived. Also check the empty
checkout, an untracked file, a deleted file, and a capture that reports inconclusive after a
concurrent write. Existing `test/browser-phase7.mjs` capture checks cover the HTTP boundary.

## Implementation (same day)

Shipped the first pass: the combined HEAD-to-working-tree `diff` on the capture result, a
`Changes` sheet (`web/src/components/Changes.tsx`, parser in `web/src/lib/diff.ts`), the session
menu item and palette row, refresh on open / window focus / edit, write and bash completions, and
**Ask about this file** into the composer draft. Branch, Turn N, line comments and syntax
highlighting are not in this pass. Records stored before the combined diff are still accepted.
Covers INV-01, INV-07, INV-08; UI composed from shadcn Sheet, Item, Collapsible, ScrollArea,
Empty, Alert, Button and Tooltip. The hunk table is hand-written and says so.

Tested base `652ae28` plus this change on macOS, Node 24.19.0, Git 2.54.0, fake Pi only
(no model credits):

| Check | Result |
| --- | --- |
| `node test/browser-changes.mjs <evidence>` | Pass: menu and palette entry, three-file list with counts and numbered hunks, collapse state across refresh, external edit shown after window focus, details on demand, Ask appends only the asked file's diff and closes the sheet, phone-width layout, honest empty state. Screenshots and command log in the evidence directory. |
| `node --test test/Diff.test.ts` | Pass (2). |
| `npm test` | 72/77. The 5 failures are pre-existing on this machine at the base revision: four real-Pi tests refuse a non-fixture cwd, and the capture test's newline-named file is inconclusive on macOS. |
| `npm run typecheck` | Pass after `npm install` (mermaid types were missing locally). |

Not deployed; no physical-device or Safari run; the user's instance was not touched.
