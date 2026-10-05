# Session actions and quick-glance information — October 5, 2026

User request: a top-right hamburger for single-session actions, with session information for a quick
glance. Claim: the selected session's actions and facts stay together without crowding the header or
relabeling another session's information. **INV-03, INV-07**; existing retention contracts unchanged.

## Change

- A single top-right **Session menu** replaces the separate Changes and transcript-view buttons.
  It shows title/status, project/branch/cwd, recorded session model/effort, context, available session
  token totals, cost and session ID. Unknown values remain unavailable/not recorded; catalog defaults
  are not presented as session facts. The title uses Pi's session name, then the registry title.
- Actions are Changes, End-of-turn messages only, Archive session and Delete session. Archive/delete
  use the existing server commands; deletion still requires confirmation. Retention actions are
  disabled when disconnected/resynchronizing. Composer model/effort, Send and Stop are unchanged.
- The menu is keyed to checkout/session identity. Selection changes close old menus and confirmations.
  Changes and delete confirmation are separate dialogs; closing them returns focus to the hamburger.
  The new-session page keeps its ordinary Changes button and now also restores its focus explicitly.
- Existing responsive header layout is preserved. The menu wraps long names/paths, constrains itself
  to available viewport space and scrolls on short screens. Menu info is selectable text; UI values
  are ordinary escaped React text, not executable markup. No backend/wire/dependency changes.

## Verification

Tested base: `d17b86b687a8e78e408e0a676af31e1e8a627dcf` plus
`/tmp/piano-session-menu-evidence/tested.patch`, SHA-256
`509b16a394429578f54188c10a143e365b20d077575ebf0bee2cdbee85b4be68`.
This report was added after testing. Node 24.21.0, Effect 4.0.0-rc.118, Git 2.43.0,
Worktrunk 0.80.0, Vite 8.3.1; locked dependencies unchanged.

| Command | Result |
| --- | --- |
| `node test/browser-phase7.mjs /tmp/piano-session-menu-evidence/menu-long --menu-only --long-labels` | Pass; command output, snapshots, screenshots and result in `menu-long/`, log in `menu-long.log`. |
| `node test/browser-phase7.mjs /tmp/piano-session-menu-evidence/full` | Pass; existing workspace/diff/failure journey plus header geometry/actions at 320/390/430/768/1280px, `full/` and `full.log`. |
| `npm test` | 52/52 pass, `tests.log`. |
| `npm run typecheck` | Pass, `typecheck.log`. |
| `npm --prefix web run build -- --outDir /tmp/piano-session-menu-evidence/build` | Pass, `build.log`; existing large-chunk warning. |
| `git diff --cached --check` | Pass. |

The new caller-facing browser check exercises the real menu, not class strings/private helpers:

1. An unstarted saved session shows its own title/path/ID, unknown model and unavailable usage even
   after the cwd catalog discovers its default. No false zero cost or guessed model.
2. Menu bounds pass at 320×568, 390×844, 768×320 and 1280×844, including long project/branch/path
   labels. Changes remains reachable by pointer even when scrolling is required in landscape.
3. Enter/Escape opens/closes the menu; Changes close and deletion cancel restore hamburger focus.
   Cancelling deletion leaves both registry references intact.
4. Session B's menu names B; browser Back to A closes B's menu. A short fake-Pi prompt then updates
   A's facts to `fake/alpha`, `medium`, 2k context tokens and $0.02, read back from the menu.
5. Archive B retains only B as archived; deleting A after confirmation removes only A. Between these
   actions the new-session Changes button opens B's diff and restores focus correctly.
6. The full existing journey still captures the correct revisions, reports capture failure instead
   of a clean diff, reloads, and toggles the transcript preference via its new menu location.

Verification used scratch loopback backend/UI on 7171/7172, isolated registry/HOME/Pi storage and
throwaway Git worktrees. Effective browser Pi override: `test/fake-pi.mjs` through Node in RPC mode;
no model credits used. The first short-label menu pass is also retained under `menu-initial/`.
Fixtures removed their processes, worktree/branch and state. No physical-device, Safari or independent
review was performed. Source review covered session scoping, authoritative/unknown values, retention
routing, Radix focus ownership and keyboard behavior. Existing server tests cover retention semantics;
the browser regression is the appropriate boundary for this changed interaction.

## Activation

**Not deployed.** Only a scratch-output build was performed. To activate, build the hosted UI and
reload browsers; an explicitly requested deployment also restarts **`piano.service`** per project
preference. Proxy services need no restart. No hosted build, restart or user-browser reload was
performed for this change. The preceding mobile-header revision's successful deployment does not
activate this later menu work.
