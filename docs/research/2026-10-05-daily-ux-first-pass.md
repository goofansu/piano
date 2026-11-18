# Daily UX — first polish pass

October 5, 2026. User priority: make Piano enjoyable for daily use before adding deeper workflow
features. This is an initial visual/interaction pass, not a claim that the overall UX goal is met.
Phases 9–13 are deferred in the roadmap; the architecture and dropped Phase 8 remain unchanged.

## Claim and scope

Improve hierarchy, reading comfort and interaction feedback without changing session ownership,
authoritative state, prompt delivery or the quiet header. Preserve **INV-01–03, INV-05 and INV-11**.
The smallest useful checks are browser interactions, backed by the existing runtime module suite.

The initial scratch-browser walkthrough found a nearly uniform canvas, weak navigation hierarchy
and abrupt project/tool disclosures. Changes:

- Separate the navigation shell from an inset conversation surface on desktop; keep phones edge-to-edge.
  Add a small decorative Piano mark, clearer selection and more comfortable spacing in both themes.
- Align transcript/composer columns, improve prose/code rhythm and give the composer a restrained focus
  treatment. Keep model/effort controls and session metadata in their existing locations.
- Add a short welcome entrance, animated project/tool-argument disclosures and control feedback.
  Do not animate transcript updates, remount sessions for effects, or add an animation dependency.
  Reduced-motion preference disables animations/transitions, including the streaming pseudo-element.
- Add Copy to completed text-only replies: copy the projected Markdown, show success only after the
  clipboard write, and give a selectable-text fallback message on failure. The action is revealed by
  hover/keyboard focus and stays visible with a coarse pointer.
- Keep tool output previews visible; clarify argument disclosure with a chevron. Name the mobile
  navigation sheet and expose the current session to assistive technology.
- Move dismissible notices below the header, away from Send/Stop. The browser check reproduced a
  notification covering Stop with the wider composer; the fix preserves its reachability while the
  notification remains present.

No server, wire, registry, persistence, configuration or dependency changes.

## Evidence

Tested base **`cc1250f` plus the implementation patch**. Packet:
`/tmp/piano-ui-polish-evidence/` (VM-local, outside the registry), containing the staged patch,
input digests, environment, command outcomes, browser logs, snapshots and before/after screenshots.
The committed `test/browser-ui-polish.mjs` reproduces the focused journey in isolated scratch storage.

Environment: Node `24.21.0`, React `19.3.0`, Vite `8.3.1`, agent-browser `0.38.2`, locked Pi `1.0.2`,
Effect/platform-node `4.0.0-rc.118`, Worktrunk `0.80.0`. Browser runs used fake Pi, loopback backend/UI
7171/7172, and separate repositories/registries/agent/session directories. The reconnect check ran
independently on 7181/7182. **No paid model calls or interaction with the hosted UI.**

| Check | Outcome |
| --- | --- |
| `npm test` | 54 passed. Existing module contracts retained; `tests.txt`. |
| `npm run typecheck` | Passed server/shared and browser; `typecheck.txt`. |
| `npm run build -- -- --outDir /tmp/piano-ui-polish-evidence/build` | Passed into scratch output, not `web/dist`; `build.txt`. Vite reports the main chunk exceeds 500 kB. |
| `node test/browser-ui-polish.mjs …/browser-final` | Passed real clipboard copy/paste and denied-write feedback, keyboard disclosure/focus, session draft retention, responsive light/dark layouts, reduced-motion entrance/disclosure/streaming, Stop under notifications, coarse-pointer copy visibility and mobile sidebar focus. |
| `node test/browser-composer.mjs …/composer` | Passed eight viewport sizes, picker bounds, Send/Queue/Stop, authoritative queue/reload/pause/restore, peer-tab isolation, keyboard handling and reconnect without draft loss or prompt replay. |
| `PIANO_TEST_PORT=7181 node test/browser-reconnect.mjs …/reconnect` | Passed conversation/partial reply/draft/scroll retention during delayed reattachment, disabled actions until snapshot, no document reload or prompt replay. |

The initial UX test failure is retained in `browser/` and `browser-run.txt`: a Sonner notification
covered Stop. The next run passed that interaction but exposed a **fixture** problem: switching a
launched desktop browser to a device viewport does not change its fine pointer. The final fixture
launches a separate coarse-pointer browser, asserts that media query, and passes; the intermediate
output is retained under `browser-device-fixture-failure*`. Assertions were not weakened.

Review: implementation/contract self-review plus screenshot inspection, not independent review.
New regression coverage targets copy failure, disclosure/focus, motion preference and control
occlusion; no new module test for purely visual tokens. Existing tests cover runtime and draft
contracts. Chromium emulation is not a physical-phone/Safari check, a full accessibility audit, or
proof of subjective delight. Full-day use and user feedback should choose the next UX slice.

## Cleanup and activation

Owned scratch backend/frontend processes were stopped by PID. Scratch repositories and isolated
session stores were removed; no scratch worktrees were created by the UX browser journeys. The
module suite owns and cleans its own Worktrunk fixtures. Logs/screenshots/build output are retained
in the evidence packet. The real registry, hosted processes and `web/dist` were untouched.

**Not deployed.** No backend restart is technically needed for these frontend-only changes. Activation
requires a production frontend build and browser reload; an explicitly requested deployment also
restarts **`piano.service`** per the user's policy. No proxy restart is needed. Only the scratch build
was performed; production build/restart/browser reload were not.
