# Menu-only session header — October 5, 2026

User request: move everything in the single-session header into the hamburger. **INV-03, INV-07**:
status and workspace facts remain scoped to the selected session, but are now visible on demand.

The header now shows only the top-right hamburger, with no second metadata row or separate sidebar
button. Status/title/project/branch/path and existing session actions remain in the menu; Show sidebar
is added there. The menu closes before opening the mobile sidebar sheet, and closing that sheet
restores focus to the hamburger. Desktop sidebar navigation remains available too.

A visually hidden live status preserves announcements for assistive technology while the menu is
closed. Status explanation is available on the menu's status text. Composer controls and actionable
warnings remain visible and unchanged; this is a header presentation change, not a protocol or
retention change. The previous always-visible-header metadata assertions were intentionally replaced
with assertions for the user's new menu-only contract, not dropped without replacement.

## Evidence

Tested base `473afd90f1fd3167f57dfc9a86eb5e9a0c658ab1` plus
`/tmp/piano-menu-only-header-evidence/tested.patch`, SHA-256
`21bfdc3c5ba036241311e824ef0e76d7267ce8986bad20cf7f635e7ab0fec4c5`.
This report was added afterward. Environment unchanged: Node 24.21.0, Effect 4.0.0-rc.118,
Git 2.43.0, Worktrunk 0.80.0, Vite 8.3.1; no dependency changes.

- `node test/browser-phase7.mjs /tmp/piano-menu-only-header-evidence/header --header-only --long-labels`:
  pass. At 320/390/430/768/1280px, only the hamburger is visible and clickable in the compact header.
  The live announcer remains visually hidden. Changes, transcript preference and mobile sidebar
  opening work through the menu; Escape from the sidebar restores hamburger focus.
- `node test/browser-phase7.mjs /tmp/piano-menu-only-header-evidence/menu --menu-only --long-labels`:
  pass. Menu information, unknown/live usage, long labels, viewport bounds, landscape scrolling,
  keyboard/focus, session switching, confirmation, archive/delete and new-session Changes still work.
- `npm test`: 52/52 pass (`tests.log`); `npm run typecheck`: pass (`typecheck.log`).
- `npm --prefix web run build -- --outDir /tmp/piano-menu-only-header-evidence/build`: pass
  (`build.log`, existing large-chunk warning). `git diff --cached --check`: pass.

Command records, screenshots, snapshots and geometry are in `header/` and `menu/` under that evidence
root. Source/visual review checked the new presentation contract and focus transfer. Scratch-only
loopback 7171/7172, isolated registry/HOME/Pi storage, real scratch Git and `test/fake-pi.mjs` RPC;
no model credits used. Fixtures cleaned their processes, worktrees/branches and state. No physical
mobile device, Safari, independent review or new runtime compatibility claim is included.

## Activation

Not deployed. Only a scratch-output build was performed. Activation needs a hosted UI build and
browser reload; the project's explicit-deploy preference also requires restarting **`piano.service`**.
Proxy units need no restart. No hosted build, service restart or user-browser reload was performed
for this change. The preceding menu revision's deployment does not activate this follow-up.
