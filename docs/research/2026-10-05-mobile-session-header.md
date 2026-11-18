# Mobile session header correction — October 5, 2026

Claim: the session header keeps status, workspace identity and controls readable/usable on mobile.
Supports **INV-07** (workspace identity); preserves **INV-03** (status remains a Pi projection).

## Reproduction and cause

`node test/browser-phase7.mjs /tmp/piano-mobile-header-evidence/before --header-only`
failed on the unmodified UI: status wrapped at 320/390/430px; at 320px only **5.375px** of the project
and **0px** of the branch were visible. At 390px “Not running” occupied **40.59px** vertically despite
its **20.3px** line height. Screenshots confirm the broken layout, not merely document overflow.

The single-row flex header gave fixed-width controls their space while wrapping status and clipping
the entire workspace group. Isolated 390px browser style probes retained in `probe/probes.json` showed:

- `white-space: nowrap` alone fixed status but reduced workspace width from 81.4px to 56.9px;
- removing Changes relieved pressure, but removed a useful action;
- putting workspace context on its own row restored 358px of context and one-line status.

The fix uses two rows below the existing desktop breakpoint: status/actions, then workspace identity.
Project, branch and optional session name truncate independently; status cannot wrap. Action controls
stay grouped and non-shrinking. Desktop retains its single 48px row. No session semantics, data or
backend behavior changed. Temporary probe instrumentation was removed.

## Evidence

Tested base: `b5e83515fbe17478abebe58aa792ee7e927844d5` plus
`/tmp/piano-mobile-header-evidence/tested.patch`, SHA-256
`786f8b53b398d60955f7c3db01aa97c49d2cc1ed3c5b7726e023b270351fe28a`.
This evidence document was added afterward. Node 24.21.0, Effect 4.0.0-rc.118, Git 2.43.0,
Worktrunk 0.80.0, Vite 8.3.1; dependencies unchanged.

- Focused header journey: **pass** at 320/390/430/768/1280px (`after/`).
- The same journey with `--long-labels`: **pass**, independently truncated project/branch names
  (`long-labels/`). Changes opens the correct diff, the message-view toggle updates, and the sidebar
  opens through pointer actions at 320px.
- Full `node test/browser-phase7.mjs /tmp/piano-mobile-header-evidence/full`: **pass**, including
  the existing workspace capture/failure/reload journey plus the new header regression.
- `npm test`: **52/52 pass**, `tests.log`; `npm run typecheck`: **pass**, `typecheck.log`.
- `npm --prefix web run build -- --outDir /tmp/piano-mobile-header-evidence/build`: **pass**,
  `build.log` (existing large-chunk warning). `git diff --cached --check`: **pass**.

Commands, geometry, snapshots and screenshots are under the directories above. Verification used only
scratch loopback 7171/7172, isolated registry/HOME/Pi storage, real scratch Git checkouts and
`test/fake-pi.mjs` catalog probing (`--mode rpc --no-session`); no model calls. Scratch processes,
worktree/branch and state were cleaned up. This is browser viewport verification, not a physical-device
or mobile-Safari test. Review checked the responsive layout, preserved actions and source-only scope.

The earlier Phase 7 mobile gate inspected the Changes dialog and document width, so it missed clipping
inside the header. The added browser geometry assertions protect that uncovered failure; a unit test
for class strings would not. The default Phase 7 browser check now includes them, and `--header-only`
provides the focused loop.

## Activation

This fix is committed source, **not deployed**. The preceding Phase 7 revision was successfully
built/restarted at 07:09:53Z; that does not activate this later correction. A hosted UI build and browser
reload are required. On an explicitly requested deployment, also restart **`piano.service`** per the
project's deploy preference; proxy units need no restart. Only a scratch-output build was performed
for this fix; no hosted build, service restart or user-browser reload was performed.
