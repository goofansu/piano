# Phase 0 — real Pi compatibility checkpoint

Date: October 4, 2026. Implements the fixture/evidence checkpoint in
[the vertical-slice plan](../vertical-slice-plan.md#phase-0--compatibility-checkpoint-not-another-dependency-upgrade).
Relevant contracts: **INV-01, INV-11, INV-12**, with a reproduced **INV-04 / Phase 2** failure.

**Checkpoint implemented and exercised; compatibility remains incomplete.** The final runtime report
has ten passing checks, one failing check and two blocked startup-support observations. No dependency
upgrade, production trust policy or deployment change was made. This is not runtime-milestone acceptance.

## What was added

- [`test/phase0-checkpoint.ts`](../../test/phase0-checkpoint.ts) observes the locked normal CLI through
  `PiSessions.open/events/act/state`, with an isolated agent/session directory and scratch Git projects.
  It records every result, including failures, outside the registry. Exit codes: **0** all pass,
  **2** known compatibility gaps, **1** unexpected check/fixture/cleanup failure.
- [`test/fixtures/PiCompatibility.ts`](../../test/fixtures/PiCompatibility.ts) creates disposable Pi inputs,
  user/project extensions, model settings and a local stdio MCP sentinel. These are fixture inputs,
  not a second production settings/MCP loader. Pi itself reports effective trust, settings, model,
  effort, tools and command identities; `/mcp` supplies built-in connection status.
- [`test/browser-phase0.mjs`](../../test/browser-phase0.mjs) drives the real runtime through a separate
  loopback backend/dev UI. It answers a supported dialog after reload, reads selected-checkout facts,
  aborts a local synthetic provider wait, observes explicit exit/read-only reload, and observes a
  bounded startup failure without resubmission.
- Fixed a readiness deadline bug in [`server/PiSessions.ts`](../../server/PiSessions.ts): `open` and
  `probe` now use `Effect.raceFirst`, not `Effect.race`. On pinned Effect v4, `race` waits for the first
  **successful** result; it suppresses a readiness timeout while the other branch waits for a live
  child's exit. `raceFirst` returns the first completion, including a typed timeout. The regression
  exercises both public operations with a real fake-Pi subprocess that stays alive without responding.

## Observed runtime results

| Contract | Observation |
| --- | --- |
| Effective CLI | Repository `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`, version **1.0.2**; invoked through a credential/environment-isolating shim, not a global `pi`. |
| Connecting MCP control | With scratch-only `--approve` and no project MCP override, `/mcp` reports `piano-sentinel: connected, 1 tools (direct)`; Pi registers `mcp__piano_sentinel__identity`. The sentinel records initialization and tool discovery in the selected cwd. |
| Trusted project override | Project `.pi/mcp.json` containing only `{ "enabled": false }` for the global sentinel reports Disabled, registers no sentinel tool and starts no sentinel in that cwd. Project model/effort defaults and the project extension marker load. |
| Headless untrusted control | With no approval flag or saved trust decision and global `defaultProjectTrust: "ask"`, project settings/extensions/MCP override are skipped. Pi reports trust false, global model/effort defaults, no project marker, and a connected global sentinel. |
| False-positive controls | The connecting assertion rejects both a globally disabled sentinel and a sentinel whose initialization returns an explicit error. A healthy-looking project override cannot substitute for a working connecting control. |
| Model/effort state | Trusted project starts with `piano-phase0/project`, high. Requested low is observed; switching to non-reasoning `plain` and requesting high is correctly read back as off from Pi and Piano. No model request is needed. |
| Supported dialog after readiness | A command-triggered input dialog arrives before its originating prompt acknowledgement, without an agent run. A late snapshot retains it. Answering returns `CHECKPOINT0`, removes the modal, and reports Handled without inventing transcript history. |
| Native run abort | `/phase0-wait` starts one loopback synthetic OpenAI-compatible stream. Native abort closes the actual HTTP response, reaches `agent_settled`, and clears activity. No hosted model or credential is involved. |
| Explicit exit/reload | `/phase0-exit` requests native shutdown. Pi exits with code 0; the browser shows Exited. Reload reads persisted history as Not running, without starting a new stream or replaying input. |
| **Idle supported-dialog abort — FAIL** | Pi acknowledges `abort`, but the retained input dialog and originating command acknowledgement remain pending. Explicit dialog cancellation is required to release the extension. Assigned to **Phase 2 / INV-04**; not hidden by a passing supported-answer check. |
| **Awaited startup dialog — BLOCKED** | The extension reaches `session_start` and awaits input before RPC's stdin reader is attached. With no other live handle, the observed child exits with code 0 before readiness (reported as spawn failure). With a fixture keepalive representing an extension watcher/socket, it never reaches readiness and receives a typed timeout. No startup-dialog support is claimed. |

The live-handle startup check uses a 4,000ms acknowledgement deadline plus the existing 3,000ms
shutdown grace; the final observed operation and cleanup took **7,024ms**. The no-other-handles case
failed explicitly in **1,111ms**. These are separate failure modes, not evidence that an input dialog
can be answered during arbitrary startup. The browser separately exercised the unchanged production
**30,000ms** deadline against a trusted project-local startup-dialog extension and displayed the actual
readiness error, not Ready or an answerable modal. Production startup-dialog support remains blocked.

### Small red/green readiness fix

`node --test --test-name-pattern='typed readiness timeout' test/PiSessions.test.ts` failed before the
fix with the check's outer two-second `TimeoutError`, rather than the requested 200ms typed readiness
error. After changing only the two readiness races, both open and probe return `PiSessionError` with
reason timeout. The original real live-handle startup fixture then reaches its configured error bound
instead of the checkpoint's outer 20-second bound. No production diagnostic logging was added.

## Verification and provenance

Tested base: `adee7e2a11dd6b28b8a5c129486eb72203aac964`, **plus the uncommitted Phase 1 work and Phase 0
changes**. Full dirty patch/input hashes and the exact fixture/browser runtime inputs are retained in
`/tmp/piano-phase0-evidence/`. That packet is VM-local and ephemeral, not a durable product evidence store.

Environment: Node **v24.21.0**, Pi **1.0.2**, Effect/platform-node **4.0.0-rc.118**, Worktrunk **0.80.0**
(not exercised), agent-browser **0.38.2**, Vite **8.3.1**. The effective CLI override is a generated shim
importing the repository CLI. It rejects non-fixture cwd, removes inherited environment except PATH,
sets scratch HOME/agent/session storage and disables automatic network/version/telemetry activity.
It uses `--offline --approve` only in scratch approved controls; the untrusted control omits approval.
Built-in MCP and normal extension/resource loading remain enabled: **no `--no-extensions` flag**.
Cache warming is off and independently disabled by the fixture extension. All configured endpoints
are local; offline mode is not treated as a network/security sandbox. MCP tools are discovered, not invoked.

| Command/check | Result | Retained output |
| --- | --- | --- |
| Focused readiness regression, before/after | Failed before, passed after. | `readiness-red.log`, `readiness-green.log` |
| `node test/phase0-checkpoint.ts /tmp/piano-phase0-evidence/runtime` | **Exit 2 — incomplete**, ten pass / one fail / two blocked, no unexpected fixture/cleanup failure. | `checkpoint-run.log`, `runtime/checkpoint.json`, `runtime/events.json`, `runtime/fixture-observations.json` |
| `node test/browser-phase0.mjs /tmp/piano-phase0-evidence/browser` | Passed the supported journey and bounded-error assertions. This does **not** make blocked startup dialogs supported. | `browser-run.log`, `browser/result.json`, `browser/browser-commands.json`, snapshots/screenshots, `browser/pi-facts.json` |
| `npm test` | Passed, **19 tests**, including the new readiness regression and the existing real-Pi queue/prompt check. | `tests.log` |
| `npm run typecheck` | Passed, server/shared/tests and web. | `typecheck.log` |
| `git diff --check` | Passed. | `diff-check.log` |

Earlier attempts are retained separately. The first fixture rejected Pi's array-form user text, causing
its own wait check to time out; that fixture error was corrected rather than claimed as a runtime defect.
The live-handle startup fixture subsequently exposed the real readiness-race bug; its before-fix output
is retained. Earlier browser output predates that fix; the final browser run includes the production
startup deadline. Existing toast placement requires moving the pointer away and observing expiry
before subsequent clicks. Vite/React script-tag and proxy-reset diagnostics remain in browser logs;
this is not a claim of a warning-free application.

No new paid call was made. The [earlier upgrade report](2026-10-04-pi-update-effort.md#evidence-and-limits)
remains historical prompt/reload/hosted-effort evidence for the unchanged CLI spawn/resource-loading path,
not proof that today's broader runtime contracts all pass. The synthetic stream checks transport and
abort mechanics, not model quality or current hosted credentials.

## Handoff and limits

1. **Phase 2:** fix supported dialog cancellation/claims/deadlines, starting with the reproduced idle
   command-dialog abort failure. Rerun the checkpoint and its real supported-dialog fixture after the fix.
2. **Startup limitation:** awaited arbitrary `session_start` dialogs cannot be supported through this
   Pi 1.0.2 readiness path. Preserve explicit bounded failure unless the upstream startup contract or
   a separately designed host boundary changes; command-triggered dialog success cannot waive it.
3. This checkpoint does not prove two-tab ownership, dialog races, ordered reconnect, faithful/redacted
   transcript projection or Worktrunk compatibility. Those retain their phase-specific gates.
4. The New page's existing 15-second “Starting Pi” indicator ends before the 30-second host deadline;
   the final host error is visible and this check observed no automatic resubmission. It is not a
   complete pending-start/retry policy; retain that UX/lifecycle gap for Phase 4.

Only scratch projects were registered. All started browser/backend/UI processes were stopped by their
own PIDs, the local endpoint closed, and recorded Pi/MCP children were confirmed exited before scratch
repositories/session storage were removed. No worktrees were created. Ports 7171/7172 were no longer
listening. The user's real registry, services, credentials and built UI were untouched; no production
rebuild/deploy was run.
