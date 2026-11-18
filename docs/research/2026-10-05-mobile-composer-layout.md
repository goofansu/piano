# Mobile composer layout implementation

October 5, 2026. Implements the user's agreement with the
[mobile composer recommendation](2026-10-05-mobile-composer-references.md): restrict the **available
label width**, not the model name, and keep the action row stable on both composer pages.

## Acceptance claim

At supported phone widths, both composer toolbars occupy one row. The model name can ellipsize,
while effort, context usage and the primary action remain visible. Opening settings exposes the
full model name; choosing settings must not send a prompt, lose the draft/selection, or change
queue/abort semantics. Preserve **INV-01–03, INV-05, INV-07 and INV-11–12**.

## Changes

- Shared non-wrapping toolbar and input styles for New and existing sessions. A flexible
  `min-width: 0` model trigger takes remaining space; only the model-name span truncates. Effort
  and chevron cannot shrink. Context usage and the 44px Send/Queue/Stop control retain their slots.
- One model/effort popup at all viewport sizes, rather than duplicate desktop/mobile controls.
  Full model names wrap inside the list; the trigger's accessible name includes the full reference
  and effort. The popup stays open after model selection so effort can be adjusted. Native radio
  controls show only catalog-supported levels; existing Pi readback and new-session clamping remain.
- A close button and Escape dismiss settings and return focus to the trigger. Coarse-pointer
  opening focuses the popup, not search; desktop opening focuses search. Search is still available
  by explicitly tapping it. Directory selection follows the same focus policy.
- New-session project/worktree selection, observed Git status and Changes move above the message
  card. Its composer is bottom-docked on narrow screens; desktop keeps a centered welcome layout.
  The large mark/subtitle do not occupy the narrow-screen welcome area. Short windows/landscape
  also drop decorative welcome content and reduce the input minimum.
- Input starts compact on phones and grows within a viewport-relative cap. New no longer
  auto-focuses on a coarse pointer. The starting-state announcement does not move the toolbar.

No server, wire, registry, dependency or Pi-loading changes. The setting controls still call the
same existing parent callbacks; no second model/effort state store was introduced.

## Verification and evidence

Base **`a6d6546` plus the recorded implementation patch**. VM-local evidence:
`/tmp/piano-mobile-composer-evidence/`, outside the registry. Includes input hashes, patch,
environment, logs, geometry JSON, before/after screenshots and scratch build output.

Environment: Node `24.21.0`, React `19.3.0`, Vite `8.3.1`, agent-browser `0.38.2`, locked Pi `1.0.2`,
Effect/platform-node `4.0.0-rc.118`. Fake Pi browser fixtures; no paid model calls. Backend/UI on
loopback 7171/7172 with separate scratch repositories/registry/agent/session storage. Independent
reconnect check on 7181/7182.

| Check | Observed outcome |
| --- | --- |
| Extended `test/browser-composer.mjs --layout-only` before the fix | Failed at 320px and 390px: wrapping toolbar and primary touch target below 44px. `red.txt`, `red/`. |
| Same focused check after the change | Passed for both saved-session and new-session composers. `layout.txt`, `layout/`. |
| `node test/browser-composer.mjs …/final` | Passed nine viewports (320/375/390/430px phones, 390×400 reduced viewport, 844×390 landscape, and 768/1024/1280px). Single-row controls, readable/accessible truncation, fixed action position on model/effort changes, popup bounds and full names, supported effort choices, no mobile input/search autofocus, desktop search/radio keyboard interaction, draft/selection/editor identity and focus retention. Existing context/queue/reload/pause/restore/peer-tab/keyboard/reconnect assertions retained and passed. |
| `PIANO_TEST_PORT=7181 node test/browser-reconnect.mjs …/reconnect` | Passed retained conversation, partial reply, draft, scroll and editor lifecycle with delayed snapshot attachment; no prompt replay. |
| `npm test` | 54 module tests passed; unchanged authoritative model/effort and queue contracts. `tests.txt`. |
| `npm run typecheck` | Passed server/shared/browser. `typecheck.txt`. |
| `npm run build -- -- --outDir /tmp/piano-mobile-composer-evidence/build` | Passed into scratch output; production `web/dist` untouched. Vite's >500kB chunk warning remains. `build.txt`. |

At 390px with the same long-label fixture, the new-session footer went from **118px / three rows**
to **54px / one row**; the existing-session footer went from **82px / two rows** to **54px / one row**.
The new card contains a deliberate two-line draft in these measurements, not a large fixed empty input.
A 24-line existing-session draft scrolls inside the input at 390×400 and 844×390, capped at 30% of
viewport height without displacing the controls (`multiline-*.json` / PNGs).
The long model name remains in the DOM and accessible name; no character-count limit or altered model
identifier is sent to Pi.

Regression coverage extends the existing browser journey rather than adding a second fixture or
unit tests for CSS. Phase 0/1/3 browser selectors were updated for the full accessible model name;
Phase 0's picker interaction now uses the grouped settings. Those broader compatibility journeys
were not rerun: no loading/protocol changes, and this slice's actual selection/readback journey plus
the module suite covers the changed controls. Review was implementation/contract self-review and
screenshot inspection, not independent review.

**Limits:** Chromium coarse-pointer/device emulation is not actual iOS Safari or Android soft-keyboard
verification. Reduced viewport geometry does not establish OS keyboard, browser chrome or physical
safe-area behavior. User feedback on the new layout is still needed before calling the mobile UX done.

## Cleanup and activation

Only owned scratch processes were stopped by PID. Browser fixtures removed their scratch repositories,
registries and isolated session stores; no worktrees were created by these browser checks. Module
checks clean their own fixtures. Evidence/build output is retained outside the registry.

**Not deployed.** Frontend-only: no backend restart technically needed. Activation requires a
production build and browser reload; explicit deployment also restarts **`piano.service`** under the
user's policy. No proxy restart needed. Only a scratch build was performed; no production build,
service restart or hosted-browser reload was performed for this change.
