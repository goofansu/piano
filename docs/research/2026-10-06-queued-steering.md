# Queued input and steering

## Claim and contracts

Requested behavior: omit repeated Follow-up labels when every pending message is a follow-up;
provide distinct steering on desktop and mobile. Preserves INV-01–03, INV-05 and INV-12:
Pi owns queue text, ordering, prompt expansion, extension command handling and dispositions.
The browser does not fabricate pending history or replay input.

- Desktop Enter sends a follow-up during a run; Alt+Enter steers; Shift+Enter inserts a newline.
- Coarse-pointer/mobile Enter still inserts a newline. The normal arrow queues a follow-up;
  an explicit Steer button beside the draft sends steering when running with nonblank input,
  except during compaction. Keeping it above the footer preserves model readability at 320px.
- Follow-up-only queues omit kind labels; queues containing steering retain kind labels.
- New `SessionAction.steer` uses Pi's `prompt` with `streamingBehavior: "steer"`, through the
  same acknowledgement/lifecycle path as follow-up input. Extension commands remain supported;
  if Pi has already settled, native prompt handling starts the input normally.

## Verification

Tested on Node v24.21.0, locked Pi 1.0.2, branch `queued-messages`, base `e26343d` plus the
implementation/test diff SHA-256 `a36b64a92f13c88e688eab5be8f54ccba3e7565609f98c1de73b850f126177f2`
(before this report). Review: inspected production/test diffs, `git diff --check`, and mobile
screenshots. Extended existing regression journeys rather than duplicating coverage.

| Check | Outcome / retained output |
| --- | --- |
| `npm test` | 54 passed; `/tmp/piano-queued-tests-final.log`. Fake and real Pi queues cover steering/follow-up, handled/rejected input, abort/pause and native restoration. Real Pi uses a held loopback provider stream: no paid calls. |
| `npm run typecheck` | Passed after final layout change; `/tmp/piano-queued-typecheck-pass.log`. |
| `PIANO_TEST_BACKEND_PORT=7271 PIANO_TEST_FRONTEND_PORT=7272 node test/browser-composer.mjs /tmp/piano-queued-evidence-pass` | Passed. Desktop keyboard, mobile buttons/newline, all-follow-up and mixed labels, reload, abort, restoration, peer-tab draft isolation and reconnect. Nine viewports from 320×640 to 1280×800, including reduced-height layouts. Commands, screenshots, geometry and server output retained in that directory. |

The first browser attempt collided with another scratch process on 7171/7172; those processes
were left alone. The browser script now accepts isolated ports and checks both app endpoints.
Two later browser runs exposed a 320px model-label regression when Steer shared the footer;
placing Steer beside the draft fixed it without relaxing the model-width assertion.
All processes/session storage created by the checks were cleaned up.

Limitations: mobile checks use Chromium device/coarse-pointer emulation, not a physical phone or
OS keyboard. Native steering delivery timing remains Pi's responsibility; the real-runtime check
proves queue kind and abort/restoration, not tool-boundary timing. No deployment performed.
Activation requires a UI build, `piano.service` backend restart and browser reload; none performed.

## Main integration

Merged `3aaa9e4` into main at `c6030bb` without conflicts, retaining the newer sans-serif input,
literal model-search/order behavior and working-timer removal. Verified the combined tree before
committing: `npm test` (54 passed), `npm run typecheck` (passed) and the same scratch browser
command on 7271/7272 (passed). Output: `/tmp/piano-queued-merge-{tests,typecheck,browser}.log`;
full browser artifacts: `/tmp/piano-queued-merge-evidence`. No build, deploy or service restart.
