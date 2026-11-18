# Bounded live Changes

Tested checkout: `1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b` plus the uncommitted changes in this assignment. Environment: macOS, Node v24.19.0, Git 2.54.0. Reference: [T3 limits inspection](t3-changes-limits.md), including cached GitVcsDriverCore and useReviewFilePatches source.

## Contract and implementation

- `server/WorkspaceChanges.ts` is independent of strict `WorkspaceRevisions`; the latter and its endpoint are unchanged. INV-01/07/08/09: Git owns facts, every response names its workspace, live browsing never claims immutable evidence.
- Initial patch budget is 120,000 bytes; a fresh per-file read allows 1,048,576 bytes. Patch overflow is explicit; incomplete trailing lines are discarded. The browser discards the potentially incomplete last file of an initial preview and offers lazy expansion.
- Complete NUL-delimited numstat and untracked inventories are independently bounded at 16 MiB. Overflow/malformed/non-UTF-8 metadata errors instead of publishing a partial list. No total tracked-path or untracked-count ceiling. No repository-content snapshot.
- A private temporary copy of the Git index adds untracked paths with intent-to-add. It is removed in `finally`; the user's index is never written. Configured clean/process filters, hooks, textconv, external diff and fsmonitor are disabled. Up to four reads run concurrently, each with a 30-second deadline after admission. An unborn checkout uses the empty tree (Git may write that empty tree object).
- HTTP addressing uses registered workspace IDs; lazy file paths travel only in POST JSON. Git pathspecs are literal. Renames display as deletion/addition.
- Refresh supersedes old requests while retaining the displayed observation and lazy-file state until a new observation arrives. Failed refreshes retain the old view with a concise notice; workspace/close transitions clear it. A new observation drops old lazy-file state. Aborted/unmounted file responses cannot repopulate a newer view. Ask is enabled only for an open loaded file and attaches that displayed patch with live/partial wording, not a captured revision.

## Observed checks

- Initial implementation `npm test`: 101 tests passed, none skipped. Review-revision full-suite failures are recorded below; that earlier pass is not a clean gate for this revision. New `test/WorkspaceChanges.test.ts` exercises >10k tracked paths with a tiny edit, unchanged user index, unborn HEAD, quoted/non-ASCII/control-character paths, binary/ignored/untracked files, aggregate and per-file bounds, fresh lazy reads, >5,000 untracked paths, metadata overflow, and non-execution of filter/diff programs.
- `npm run typecheck`: passed (an initial test-only narrowing error was corrected).
- `npm run lint`: passed.
- `node test/browser-changes.mjs /tmp/piano-live-changes-evidence`: PASS. Uses agent-browser, isolated scratch registry/repos, fake Pi, no model calls. Scratch processes and files are removed at completion.
- Browser observations: 10,013 tracked paths plus one tiny edit opens; complete three-file list survives aggregate overflow; lazy read sees an edit made after the initial preview; oversized per-file patch visibly says partial; Ask uses the fresh displayed text. Also desktop/mobile, empty state, focus refresh, collapse/expand, menu/palette entry, late aggregate response, and late lazy response after refresh.

Retained local output:

- `/tmp/piano-live-npm-test.log`, `/tmp/piano-live-typecheck.log`, `/tmp/piano-live-lint.log`, `/tmp/piano-live-browser.log`
- `/tmp/piano-live-changes-evidence/commands.json`, `processes.log`, `result.json`
- Screenshots there: `large-repo-tiny-edit.png`, `bounded-lazy-patch.png`, `refresh-race.png`, `lazy-refresh-race.png`, plus desktop/mobile/empty/Ask screenshots.

## Review revisions

All supplied fixable findings were addressed, without changing `WorkspaceRevisions`:

1. File row totals and binary status now use initial numstat metadata or metadata from the same lazy response, not parsed patch totals. The browser observes the oversized fixture at 75,000 additions before loading, edits it to 100,000 additions, then asserts the loaded partial-patch row still says 100,000 additions (not the truncated hunk count).
2. Held focus refresh retains the existing file DOM node and a nonzero viewport scroll position (600px). A simulated network failure retains that same node and scroll position and shows “Refresh failed. Showing previous changes.” Subsequent successful refresh and both existing late-response race checks pass. This verifies retention while pending/failed for this fixture, not general scroll anchoring after replacement content arrives.
3. The hook and UI state use live-observation names (`useWorkspaceChanges`, `observation`, `ready`). Diff parser comments describe supplied, possibly partial patches rather than guaranteed complete captured diffs.
4. Optional limit deduplication is included: `shared/wire.ts` exports live patch byte budgets consumed by the server and UI labels. Exact-capture limits remain independent; no Git plumbing extraction.

Revision check outcomes:

- Typecheck, lint, and the complete scratch browser harness passed. Browser evidence additionally includes `held-refresh-retained.png` and `failed-refresh-retained.png`, with assertions/output retained in `commands.json`.
- First `npm test`: 100/101 passed; unchanged `PiSessions.test.ts` image-only prompt test found no user message in its first snapshot (`undefined !== ''`). Retained in `/tmp/piano-live-npm-test-first-revision-run.log`.
- Focused image-only rerun passed, output in `/tmp/piano-live-image-test-rerun.log`.
- Second `npm test`, without concurrent browser/typecheck/lint: 100/101 passed; unchanged `WorkspaceRevisions.test.ts` exact-manifest test received `inconclusive` with “Workspace changed during capture” at its untracked-file step. Retained in `/tmp/piano-live-npm-test-second-revision-run.log` (also `/tmp/piano-live-npm-test.log`).
- Focused live Changes and strict WorkspaceRevisions suites then passed all 9 tests, retained in `/tmp/piano-live-workspace-tests-rerun.log`.

No assertions were weakened and neither failing test nor its implementation was changed. Those initial focused reruns did not establish a clean full-suite gate. The bounded diagnosis and subsequent fixture revision below supersede that gate status; the image-only failure remains undiagnosed.

## Bounded capture diagnosis and fixture revision

Environment remains macOS / Node v24.19.0, HEAD `1f6ccd74339a1b49f5fd82a6cad1a54fcbc3ec8b` plus the uncommitted feature changes. No strict capture implementation or strict tests were edited.

- One isolated detached-HEAD `npm test` passed 96/96 (6.2s); its worktree was removed. One current-tree serial full suite (`node --test --test-concurrency=1 --import ./test/setup.ts 'test/**/*.test.ts'`) failed 100/101 (35.6s), at the exact-manifest test's initial capture. All five new live Changes tests and image-only PiSessions passed. Logs: `/tmp/piano-suite-baseline.E8rJPa/{baseline-npm-test,current-serial-test}.log`.
- A temporary copy instrumented watcher startup, event arrival/file timestamps and rejection stacks. One serial live Changes + strict revisions run reproduced the exact-manifest failure (8/9), this time after staging (`WorkspaceRevisions.test.ts:80`). The rejection was specifically `if (changes) raced()`, after content and inventory equality checks. Index rename events arrived at `1791517732253`, 69ms after watcher startup (`1791517732184`), while index mtime/ctime were `1791517732171.167` / `1791517732171.269`, about 13ms **before** startup. Removed `index.lock` events arrived in the same batch. This identifies delayed pre-watch filesystem events, consistent with macOS FSEvents batching, not an observed content/inventory mutation during capture.
- One instrumented strict-only control passed 4/4. That supports, but does not prove, amplification by filesystem churn from the large live Changes fixtures. It does not establish that churn is necessary or sufficient, or that the existing watcher timing hazard is fixed.
- Changed only `test/WorkspaceChanges.test.ts`: retain 5,001 actual untracked files with short paths, but create the 28,000 long-path overflow entries through `hash-object` / `update-index --index-info` and commit without materializing them. Their deleted-file numstat exceeds 16 MiB, exercising the metadata rejection without 28,000 physical files. The overflow check now also asserts the existing user index remains byte-identical. The 10,010 actual tracked-file tiny-edit test is unchanged. The overflow fixture now covers numstat overflow rather than untracked-inventory overflow; the >5k untracked inventory contract remains covered.
- One instrumented post-change paired run passed 9/9. One uninstrumented current-tree **full `npm test` passed 101/101** (8.24s), including all five live Changes tests, image-only PiSessions and all strict revision tests. `npm run typecheck` and `npm run lint` passed. No retries-until-green, sleeps, watcher suppression or weakened assertions were added. This test-fixture-only change does not alter application behavior; the earlier browser observations remain applicable and were not rerun.

Diagnosis and post-change logs: `/tmp/piano-capture-diagnosis.MLpDWK/{before-focused,control-strict-only,after-focused,after-full-npm-test,typecheck,lint}.log`. Temporary diagnostic source instrumentation was confined to the copy and removed with it; its patch is retained as `instrumentation.patch` alongside the logs. Changes are intentionally uncommitted. The single passing full run is an observed gate, not proof that intermittent platform watcher or PiSessions timing failures cannot recur.

## Upstream integration

Rebased without conflicts onto `7271e1c` (concurrent provider/settings work) after the initial push was rejected. The rebased Changes browser journey passed again, with evidence in `/tmp/piano-changes-rebased-browser/` and `/tmp/piano-changes-rebased-browser.log`. Typecheck and lint passed (`/tmp/piano-changes-rebased-{typecheck,lint}.log`). The full suite passed 100/101: the unchanged strict-capture test again rejected delayed filesystem events, this time at its symlink step (`/tmp/piano-changes-rebased-tests.log`). No further retry or weakened assertion: the documented macOS strict-capture timing risk remains, so the integrated revision does not have a clean full-suite gate. Live Changes behavior is browser-verified independently.

## Limits and non-claims

This is a moving working-tree observation, not a consistent multi-file snapshot, review approval, or passing check. Metadata and patches can differ if an external writer runs between Git commands; lazy expansion intentionally reads fresh state. Details disclose this. Ignored files are excluded, binary payloads are not displayed, non-UTF-8 output and unresolved conflicts return explicit errors. Patches over 1 MiB require local inspection of the remainder. Lazy loading is user-driven expansion, not T3's scroll-triggered batching. No real registry, deployment, paid model behavior, or immutable-evidence behavior was changed or claimed as newly verified.
