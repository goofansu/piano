# Changes as the session's review surface — October 27, 2026

Design proposal for [PIN-107](https://linear.app/goofansu/issue/PIN-107). Source reviewed at
`b5d1775f` on `main`: `server/WorkspaceChanges.ts`, `server/SessionPullRequests.ts`,
`server/GitHubPullRequests.ts`, `server/SessionStatus.ts`, `server/FolderWorktrees.ts`,
`server/Registry.ts`, `web/src/components/{Changes,ChangesHeader,SessionPullRequest,SessionHeader,SurfaceArea,SessionPanel}.tsx`,
`web/src/lib/{changesView,sessionPullRequest,pullRequestView,sessionContext}.ts`, plus the earlier
notes on [Codex's review pane](2026-10-07-codex-changes-review.md), [T3's session PRs](2026-10-08-t3code-settlement-and-session-prs.md)
and [the PR display](2026-10-08-session-pull-request-display.md). Source inspection only; no
browser run. Terms follow [the glossary](../glossary.md).

## Claim

**Changes reviews the work of this session.** It stays useful before a commit, after a commit, after
a push and after a pull request exists, and it is the one place the pull request is shown. Three
decisions make that true, each resolved for the checkout Changes inspects:

1. **Where:** which checkout Changes inspects (the session's, or one the user picks).
2. **Against what:** the comparison base (a scope the user can see and change).
3. **Published as:** the pull request for that work, folded into Changes.

The header's pull request popover goes. Nothing here commits, pushes, creates or merges anything,
settles a session or cleans up worktrees.

## What the code does today

- `WorkspaceChanges.preview` diffs the working tree (plus non-ignored untracked files, through a
  private index) against `HEAD`. A commit empties the view. The observation names the workspace,
  `head` and `branch`, nothing about a base.
- Changes reads the session's own workspace (`sessionContext.changesWorkspace`), so a session on
  `main` whose agent works in another worktree shows an empty diff.
- The pull request is a session-owned link `{url, source, apiHost}` in the registry, discovered
  from the session checkout's branch and head repository, read live through `gh`, shown in the
  header as `#123` with a popover (title, state, author, time, head → base, GitHub's diffstat,
  checks, review, Change link, Remove link). Unlinked sessions get a link dialog with
  **Find from branch** from the session menu.
- The registry knows the worktrees Piano created (`{folder, path, branch}`) but not which
  session created them, and not the base branch Worktrunk reported (`WorktreeResult.creation.baseBranch`
  carries it to the browser and is dropped).
- `SessionStatus` reports `changes.files` as the uncommitted count; `docs/session-dispatch.md`
  documents that meaning.

## The design in one picture

Desktop, side by side, a worktree session with a pull request:

```
≡  Piano / Fix login redirect ⋯        piano ⑂ fix-login            [⧉ host] [⑂ #123] [≣]
───────────────────────────────────────┬──────────────────────────────────────────────────
                                       │ Changes ×
  transcript                           │ Branch · main ▾   7 files · +214 −38   Expand all  Wrap  ↻  ⓘ
                                       │ ⑂ #123 Fix login redirect ↗   Open · ✓ Checks · ◌ Review required · 2 commits not pushed   ⋯
                                       │ ▸ server/Auth.ts                                   +120 −10
                                       │ ▸ web/src/components/Login.tsx                      +84 −28
```

The same session on a phone, one area at a time:

```
≡  Fix login redirect            [⑂ #123] [⋯]
  Agent | Changes
Branch · main ▾   7 files · +214 −38      ↻ ⓘ ×
⑂ #123 Fix login redirect ↗  Open · ✓ · ◌ · 2 not pushed   ⋯
```

What changed against today: the toolbar's status gains the scope menu at its start; a pull
request row sits under the toolbar (where the stale note sits) only while a pull request is
linked; the header has one review control instead of a PR control and a Changes toggle.

## 1. Against what: the comparison

Three scopes, each named by the question it answers. The toolbar shows the chosen one as the
first words of its status, so the comparison is never implicit.

| Scope | Compares | Answers | Available when |
| --- | --- | --- | --- |
| **Branch** | merge-base(target, HEAD) → working tree, untracked non-ignored files included | What does this branch propose? | The inspected checkout is on a branch, a target resolves (below), the branch is not the target, and one merge-base exists. |
| **Since start** | the commit HEAD pointed to when Piano started the session in this checkout → working tree | What changed since this session started here? | Piano recorded that commit (sessions it started in a Git checkout), it still exists, and the inspected checkout is the session's own. |
| **Uncommitted** | HEAD → working tree | What is not committed yet? | Always; an unborn HEAD uses the empty tree, as today. |

A content-preserving commit never changes the Branch or Since start patch; a push never changes
any of them. Committed work on `main` keeps showing under Since start, which is the answer to the
issue's continuity question for the default branch. The remote default (`origin/main`) is not a
scope: it answers "what is unpublished?", which empties on push, and the pull request row already
says what is published.

**Automatic choice:** Branch when available, else Since start, else Uncommitted. An explicit choice
is saved per session in Piano's database (so desktop and phone agree, and returning later resumes
it). A saved choice that becomes unavailable is not replaced silently: the body says why
("Branch unavailable: origin/main not found") and the menu offers the other scopes; the user picks.

**Target resolution for Branch**, first that resolves to an existing ref, each labelled in the
status and in Details, no fetch ever:

| Order | Target | Label |
| --- | --- | --- |
| 1 | The pull request's base, when the linked or discovered PR's head is the inspected branch in the checkout's GitHub repository: `refs/remotes/<remote>/<base>` (`<remote>` is the branch's tracking remote, else `origin`). | `main` · pull request base |
| 2 | The base branch Worktrunk reported when Piano created this worktree, saved on the worktree entry. | `main` · worktree base |
| 3 | The remote's default branch as Git holds it locally: `refs/remotes/<remote>/HEAD`. | `main` |
| 4 | A local `main` or `master`, when nothing above exists (a repository without a remote). | `main` · assumed |
| — | None. | Branch unavailable: no base branch known |

A PR base is used only when the PR's head matches the inspected branch; a manually linked PR for
another branch never retargets the comparison. The PR's head and base names are saved on the link
when GitHub answers, so the comparison needs no GitHub call; a retarget shows after the next PR
read. Rule 4 is the one assumption; it is labelled, and it is the open question at the end.

**Edge cases, each an explicit unavailable state, never a quiet fallback to another comparison:**

| Case | Branch scope |
| --- | --- |
| Detached HEAD | Unavailable ("Detached HEAD"); Since start and Uncommitted work. |
| Unborn HEAD | Unavailable; Uncommitted against the empty tree, as today. |
| Target ref missing (branch deleted, never fetched) | Unavailable, naming the ref. |
| Shallow or unrelated history (no merge-base) | Unavailable with Git's reason. |
| Several merge-bases (criss-cross) | Unavailable ("Ambiguous merge base"); not `--all` guessing. |
| Branch is the target (`main` on `main`) | Unavailable; Since start is the automatic choice. |
| Unresolved conflicts | Every scope fails as today ("resolve them before browsing"). |
| Stacked branch | Rule 1 or 2 gives the parent branch when the PR or Worktrunk targeted it; else the default branch, labelled, which shows the stack's whole diff. Honest, not clever. |
| Fork | Discovery already matches the head repository; the base ref lives on the fork's upstream remote only if fetched; otherwise unavailable, named. |

**Identity across reads (INV-07):** the observation carries `comparison: {scope, base, target?}`
with `base` as a commit (or the empty tree); a lazy per-file read sends the base it expects and the
server answers the current one; a mismatch drops the file read with "Changes moved. Refresh.", as
`checkWorkspaceResponse` drops another workspace's answer today.

## 2. Where: the inspected checkout

What Piano can trust about a session's work: the session's own checkout (`cwd`), and the
worktrees Piano itself created, which always get their own session (the New page's worktree
option; dispatch `start` with `worktree`). A worktree the agent created from a shell inside a
session on `main` has no trustworthy link to that session: not its branch name, not its
modification time, not the transcript's commands. So the issue's four-step policy collapses to two:

1. The user's explicit choice, saved per session in Piano's database.
2. Otherwise the session's checkout.

The choice is offered where the comparison is: the scope menu's second group, **Inspect**, lists
the folder's worktrees as the sidebar already discovers them (`name ⑂ branch`), with the session's
own checkout first and checked. Picking another one changes only what Changes reads; the header
still says where the session runs, and the toolbar's status then starts with the inspected branch
(`⑂ fix-login · Branch · main`), the one fact the header does not already show. Discovery, the pull
request row and the target resolve for the inspected checkout; Since start is unavailable there.

The shell-created-worktree journey gets a workflow answer, not an inference: an agent that wants a
branch starts a session in a worktree through the dispatch tools, and the user who did it by hand
picks the worktree once. If evidence later shows this picker is used often, that is the signal to
revisit automatic association, with real data.

## 3. Published as: the pull request, folded into Changes

**Header:** one review control replaces today's `#123` control and the Changes toggle. Its name is
`Changes` / `Hide changes` as the toggle's is; its face is the diff icon until a pull request is
linked, then the PR state icon in its colour and `#123` (icon only on phones), with the state in
`aria-description`. Side by side it toggles the Changes tab; one area at a time it goes to the
Changes area. It is the one control that is also a state, like the preview control beside it.

**Pull request row**, under the toolbar, only while a pull request is linked for the session:

```
⑂ #123 Fix login redirect ↗   Open · ✓ Checks · ◌ Review required · 2 commits not pushed   ⋯
```

- `#123 Title` is the link to GitHub (new tab, external-link icon inline-end), today's trigger and
  title in one place.
- Facts are today's signals (icon, colour and label): state badge, checks, review. GitHub's own
  diffstat is dropped: the toolbar already counts the local change, and a second count would fail
  Once.
- **What remains local**, two values shown only when nonzero, read from Git without a fetch:
  `N commits not pushed` (`<remote>/<branch>..HEAD`) and `Edits not committed`. This is the local
  versus published distinction the issue asks for, without prose.
- `head → base` appears only when the PR's head is not the inspected branch, so a manually linked
  PR for another branch is visibly another branch's.
- `⋯` menu: **Open pull request** (external), **Change link…**, **Find from branch**, separator,
  **Remove link**. Change link opens the existing dialog with the URL field.
- GitHub unreadable: the row keeps `#123 Title ↗` and shows `Status unavailable` as today; the
  reason sits in Details. Merged and closed keep their badges and change nothing else: Branch still
  shows what the branch holds (an empty Branch diff after a merge commit is Git's answer, a full one
  after a squash merge is too), and nothing infers a clean checkout or a finished task.

**Unlinked:** no row. The session menu's **Pull request** command and the palette row open the
link dialog as today (URL field, **Find from branch**). Once linked, that command opens Changes.

**Discovery edges**, bounded: a never-searched session is searched once when its work stops
(today) and once when Changes opens or is refreshed for it; a removed link stays removed until
**Find from branch**. No GitHub call per transcript event, none for an unlinked session's
selection, none from the comparison (it reads the saved head and base).

## Journey walk-through

Worktree session on `fix-login`, created from `main`:

| Step | Changes shows | PR row | Header face |
| --- | --- | --- | --- |
| Agent edits | Branch · main (worktree base): the edits and new files | none | diff icon |
| Agent commits | same patch | none | same |
| Agent pushes | same patch | none; work stopping searches once: nothing | same |
| Agent runs `gh pr create` | same patch; target becomes the PR base after the first read | `#123 … Open · ◌ Checks` after the next edge (work stops, Changes opens, refresh) | `⑂ #123` green |
| Agent edits again | same scope, grows; `Edits not committed` in the row | same | same |
| User retargets the PR to `release` | Branch · release (pull request base) after the next PR read | same | same |
| PR merged | Branch as Git says; Uncommitted still works | `Merged` | purple |
| PR closed | unchanged | `Closed` | red |
| User returns a week later | the saved scope and inspected checkout | same | same |

Session on `main` in the folder's root: Since start from the first edit; a commit and a push keep
the patch; the row appears only if a PR is linked by hand.

## Strings and controls added, against quiet UI

| Item | Kind | Once | Same names / shape | Feedback |
| --- | --- | --- | --- | --- |
| `Branch · main ▾`, `Since start ▾`, `Uncommitted ▾` (scope menu button; name "Comparison") | control's name = current value | the comparison appears here only; Details repeats the commit | a `ghost` `xs` button, as Expand all | the status and list change on pick |
| Menu items `Branch`, `Since start`, `Uncommitted` with their availability as `disabled` + detail | control names | — | `PianoDropdownMenu` items; unavailable ones disabled, their reason the item's detail, as the palette does for Changes | — |
| Menu group `Inspect`: `<worktree> ⑂ <branch>` rows, checked | control names | the inspected branch shows in the status only when it differs from the header's | `DropdownMenuCheckboxItem`, as the session menu's display toggle | status restarts with `⑂ branch` |
| `Branch unavailable: …`, `No base branch known` | state (failed body) | — | the existing failed body (`Alert`) | — |
| `· pull request base`, `· worktree base`, `· assumed` | value suffix on the target | once, in the status; Details names the ref | — | — |
| PR row: `#123 Title ↗`, state badge, `Checks …`, `Review …`, `N commits not pushed`, `Edits not committed`, `head → base` | values | the only place these words appear; the header face is the control's name | today's `StatusBadge` and signal icons | — |
| PR row `⋯`: `Open pull request`, `Change link…`, `Find from branch`, `Remove link` | control names | moved from the popover and the dialog's secondary button | `PianoDropdownMenu`; Remove last after a separator | toasts: `Pull request linked`, `Pull request link removed`, `No open PR found for this branch.` |
| Details rows `Compared with`, `Base`, `Target`, `Since` (start commit) | values' field names | only in Details | `dl` rows as `Checkout`, `Branch`, `HEAD` today; the "Working tree against HEAD" line goes | — |
| Header control `Changes` / `Hide changes`, face `⑂ #123` | control name; the face a state | the PR state appears in words only in the row | `IconButton size="header"`, pressed while shown, as today's toggle | opens or hides Changes |

Removed: the header's `#123` control and popover, `Change link` / `Remove link` ghost buttons,
the popover's diffstat and author line (author and time are on GitHub, one click away), the
"Working tree against HEAD" sentence.

## Module contract

One new deep module composes the three decisions; nothing else learns Git's or GitHub's phrasing.

- `server/SessionChanges.ts`: `read(session, {scope?, path?})` and `summary(session)`. It
  resolves the inspected workspace (saved choice or `cwd`), the comparison (saved scope or the
  automatic rule) and its base, calls `WorkspaceChanges` with that base, and attaches the session's
  pull request link facts. Errors are the unavailable states above, named.
- `server/WorkspaceChanges.ts`: `preview`/`summary` take `{base: commit | "head"}`; the diff
  mechanics (private index, intent-to-add, bounds) stay as they are. Target and merge-base
  resolution is a pure Git read beside it (`server/ComparisonBase.ts`), under `observeCheckout`'s
  hardening (INV-06), so `GitCheckout` stays the one Git reader.
- `server/SessionPullRequests.ts`: unchanged policy; the link gains `head` and `base` as last read.
- Registry (identity and preference only, INV-01): session `review: {scope?, workspaceId?}`;
  session `startHead` recorded when Piano starts a session in a Git checkout; worktree entry
  `baseBranch` from Worktrunk. No GitHub state is persisted.
- Wire: `WorkspaceChanges.result` gains `comparison`; a `SessionChanges` response adds the
  inspected `workspace`, `pullRequest` and `local: {commitsNotPushed, uncommitted}`. Route:
  `GET /api/session/changes?workspaceId&sessionId&scope`, per-file reads by POST JSON as today.
  Paths stay out of URLs.
- `SessionStatus`: `changes.files` keeps its documented meaning (uncommitted). A `review` field
  with the session's scope and its file count is a later addition, so no consumer's number changes
  meaning silently.

## Slices

1. **Comparison.** Branch and Uncommitted scopes, the scope menu, target rules 1–4 with labels,
   `comparison` on the wire, race guard on per-file reads, Details rows, worktree `baseBranch`
   recorded at creation, PR `head`/`base` saved on the link. The header is untouched.
2. **Pull request fold.** The PR row and its menu, the one header control, popover removal,
   discovery on Changes open and refresh, `commits not pushed` and `Edits not committed`.
3. **Continuity and choice.** `startHead` at session start and the Since start scope; the
   Inspect group and the saved inspected checkout.

Each slice is shippable alone and leaves today's behaviour as the fallback.

## Verification expected

- Module tests through `SessionChanges` on temporary repositories: commit and push preserve the
  Branch patch; advancing only the target adds nothing; staged, unstaged and untracked content;
  detached, unborn, missing target, shallow, criss-cross and conflicted checkouts each name their
  state; a PR base is used only for a matching head; rules 2–4 in order; per-file reads after a
  base change are refused.
- PR fixtures through the controlled `gh`: non-default base, fork collision, external creation
  found on open, retarget, removal stickiness, GitHub unavailable with the row kept.
- Scratch-browser journey (`verify-piano`): the walk-through table above on desktop, 390px and
  320px with a long title and branch and a running preview; every new control taken once and its
  answer screenshotted; `test/browser/style-shots.mjs` before and after the header change.
- `npm run typecheck`, `npm run lint`, `npm test`.

## Prototype of slice 1 (2026-10-27)

Built on the `changes/comparison` worktree from `b5d1775f`. What it adds:

- `server/ComparisonBase.ts` resolves every scope for a checkout (target rules 1–4, merge base,
  the named unavailable states); `WorkspaceChanges.preview` takes `{scope, hints, path}` and
  answers `comparison` and `scopes`, or an `unavailable` result; `server/SessionChanges.ts`
  composes the session's saved scope, its worktree's recorded base and its pull request's recorded
  branches. Routes: `POST`/`PUT /api/session/changes` and `POST /api/session/changes/file`.
- The registry (schema 11) records a worktree's `baseBranch` from Worktrunk, a pull request link's
  `head` and `base` as GitHub last reported them (kept current on every read), and the session's
  `changesScope`. `SessionStatus` keeps `changes.files` as the uncommitted count.
- The toolbar's status starts with the comparison menu (`Branch · main ▾` / `Uncommitted ▾`,
  accessible name `Comparison: …`); each item says what it compares with or why it cannot be
  picked; Details gains Compared with, Base and Target rows. A per-file read names the comparison
  it was asked under and the browser refuses one that moved (`CHANGES_MOVED`).

Two small departures from the proposal above, to validate: the target's provenance ("the
worktree's base", "assumed") is in the menu item and Details, and the status face carries only
`(assumed)`; and on a phone the face shortens to `Branch ▾` with the count on a second toolbar
line, because `Collapse all`, `Wrap`, Refresh, Details and Close leave no room for more. At 320px
the face still crowds `Collapse all` by a few pixels; the fold slice, which reworks the toolbar
for the pull request row, should move the view controls to make room.

Observed on a seeded scratch instance (fake Pi, real Git and Worktrunk, macOS, Node 24), evidence
under `verify-piano-evidence/20261027-213956-54199/changes-comparison/`:

| Step | Seen |
| --- | --- |
| Root session on `main` with edits (`01`, `02`) | `Uncommitted ▾ · 2 files · +2 −1`; the menu offers Branch disabled with "main is the base branch." |
| Worktree session started by dispatch `--worktree pin-107-demo`, edits in it (`03`) | `Branch · main ▾ · 2 files · +2 −1`, both files listed. |
| Commit in the worktree, Refresh (`04`) | Same two files and hunks; `Uncommitted` would show "No changes". |
| Pick Uncommitted (`05`), reload (`06`) | "No changes"; after the reload the face is still `Uncommitted`: saved in Piano's database (`sessions.changes_scope`). |
| Back to Branch, Details (`07`) | Compared with "Merge base with main", Base, Target "refs/heads/main at …, the worktree's base" (`worktrees.base_branch` = main). |
| 390px and 320px (`17`, `16`) | `Branch ▾` with the count beneath; the 320px crowding noted above. |
| HTTP | `POST /api/session/changes` answers `comparison.target.from: "worktree"`; a per-file read answers the current comparison; dispatch `status` still reports `files: 0` after the commit. |

Gates: `npm run typecheck`, `npm run lint`, `npm test` (1168 tests, 0 failed). New module tests
cover the commit-preserving patch, the target rules in order, every named unavailable state
including criss-cross and orphan histories, the saved scope, the recorded pull request branches,
and the per-file refusal; `test/SessionChanges.test.ts` and the browser journey above are the
evidence for the session-level contract. Not exercised: a pull request base read from a live
GitHub (the link's branches came from the controlled `gh`), and a checkout whose remote default
is set (rule 3 is covered by a module test only).

## Prototype of slice 2 (2026-10-27)

Built on the same worktree after slice 1. What it adds:

- The header's Changes control is the review control: the diff icon, or, once a pull request is
  linked, the state's icon and `#123` with the pull request and state as its description. It
  shows on every layout where Changes can open; one area at a time it shows the Changes area.
  The `#123` popover is gone with its trigger, diffstat and author line.
- The pull request row under the Changes toolbar, while linked: `#123 Title ↗`, the state badge,
  checks and review, `N commits not pushed` and `Edits not committed` (read by Git with the same
  observation, no fetch), and `head → base` only when the head is not the inspected branch; its
  menu is Open pull request, Change link…, Find from branch, Remove link. Linking and removing
  answer with a toast.
- The link dialog serves linking (URL, Link, Find from branch) and changing a link (prefilled,
  Save link, Cancel). "Pull request" in the session menu and the palette opens Changes for a
  linked session, else the dialog.
- Polling and discovery follow the row: a linked session's facts poll while Changes shows; a
  never-searched session is searched once when Changes first shows for it, as when its work
  stops; a link removed elsewhere takes the row with it.
- `PIANO_GH_CLI` points a scratch instance at a stand-in forge; `VERIFY_GH_CLI` passes it
  through the verification launch.

Observed on a seeded scratch instance with the stand-in `gh` answering `#222` as open with
passing checks and review required, evidence under
`verify-piano-evidence/20261027-221352-58247/pull-request-fold/`:

| Step | Seen |
| --- | --- |
| Linked session, Changes closed (`01`) | Header control `#222`, green, description "Pull request #222, Open"; no popover. |
| Changes open (`12`, `13`, `14`) | Row: `#222 Plan the verification ↗ · Open · Checks passed · Review required · Edits not committed · verify-plan → main` (the session is on `main`, so the pair shows); wraps whole facts at 390px and 320px. |
| Row menu (`03`), Change link… (`04`) | Four items with Remove link last after a separator; the dialog "Change link" prefilled with the URL. |
| Unlinked session, Changes open (`06`) | No row; the diff icon in the header. |
| Session menu → Pull request (`07`, `08`) | The link dialog; Find from branch answers "No open PR found for this branch." |
| Link by hand (`09`), Remove link (`10`) | "Pull request linked", the row and `#222` appear; "Pull request link removed", both go. |
| Session menu → Pull request on a linked session (`11`) | Changes opens, the control reads "Hide changes", pressed. |

Gates: `npm run typecheck`, `npm run lint`, `npm test` (1170 tests, 0 failed). New module tests
cover the review control's face, the row's facts (including the branch pair only for another
head, and nothing local saying nothing), and the state machine's `reveal` (search once, show a
linked session's details, hide with Changes, a link removed elsewhere closing the row). Not
exercised: a merged or closed pull request through the browser (the fixture answered open; the
badges and colours are the ones the popover had), and `N commits not pushed` through the browser
(the scratch repository has no remote; the count is covered by its Git read in module tests
only through the wire type, so it is the one fact of the row with no observation yet).

## Rejected alternatives

- **Keep the popover and enrich Changes too.** Two places for one pull request fails Once, and
  the popover's facts are review facts.
- **Automatic worktree selection** by branch name, modification time or shell commands: the issue
  rules it out and nothing trustworthy exists; the explicit picker costs one click.
- **`origin/<default>` as the default-branch base:** empties on push; answers a different question.
- **A free-form base picker (any ref):** useful later; the labelled target rules cover the
  common cases and keep the menu to three names.
- **Last turn** snapshots, inline line comments beyond Ask, stage/revert, create PR, settle: out
  of scope, as the issue bounds.

## Open questions for the user

1. **Decided 2026-10-27:** rule 4 stays. A repository without a remote compares with its local
   `main` or `master`, labelled "assumed".
2. **Decided 2026-10-27:** the saved scope and inspected checkout live in Piano's database, so
   phone and desktop agree and the choice survives a browser's data.
3. **Decided 2026-10-27:** slices land in the order above: comparison, then the pull request
   fold, then continuity and choice. Since start follows the comparison soon, because sessions
   started before it ships never get a start commit.

Invariants touched: INV-01 (Git owns facts; the registry holds identity and preference), INV-06
(unavailable, not a fallback), INV-07 (every observation names its workspace and comparison),
INV-08 (the base is a commit), INV-09 (live browsing, not evidence), INV-11 (no paths in URLs).
