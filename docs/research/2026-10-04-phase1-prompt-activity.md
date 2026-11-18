# Phase 1 — prompt disposition and activity

Date: October 4, 2026. Implements the bounded Phase 1 journey in
[the vertical-slice plan](../vertical-slice-plan.md#phase-1--submit-a-prompt-and-explain-its-dispositionactivity).
Affected contracts: **INV-02, INV-03, INV-12**. This is not certification of Phase 0 or the full runtime milestone.

## Claim and implementation

Submit input once and explain its handling separately from current session execution. Accepted input
reports `started`, `queued` or `handled`; rejection and acknowledgement uncertainty are distinct.
`handled` neither implies command success nor creates a finalized user message. `agent_end` does not
settle work; `agent_settled` remains the session-level completion boundary.

- Ordinary submissions use RPC `prompt` with explicit `streamingBehavior: "followUp"`, including
  while busy. Pi, not a cached streaming flag, decides whether to handle, queue, start or reject.
- The host retains the last input's disposition in its snapshot and publishes handling updates.
  Submission IDs order observations within one child, not deduplicate retries or identify generations.
- Requests have a 30-second acknowledgement deadline. Unrecognized disposition, deadline or process
  failure does not trigger resubmission. The browser invites inspection when delivery is uncertain.
  A caller disconnect does not cancel the host's acknowledgement tracking; late responses cannot
  overwrite newer handling or model facts.
- Retry and compaction facts are retained independently; the browser explains these alongside waiting
  dialogs, authoritative queues and process exit. Already-read output is drained before publishing exit.
  Ordinary input may be rejected during compaction.
- Command-controlled model/effort/name facts are read back from Pi. Version guards prevent delayed
  observations from replacing newer facts. Browser attachment observes its snapshot before first input.
- Idle retirement excludes compaction, retry and pending/uncertain acknowledgement as well as existing
  active runs, queues and dialogs. This is conservative retention, not the complete Phase 4 lifecycle policy.

## Evidence

Base revision: `adee7e2a11dd6b28b8a5c129486eb72203aac964`, plus uncommitted implementation changes.
The local evidence packet is `/tmp/piano-phase1-evidence/` (outside the registry). It contains the
implementation patch, input hashes, environment, full command output, browser command output,
accessibility snapshots and screenshots. It is VM-local evidence, not a durable exported artifact store.

Environment: Node `v24.21.0`, Effect/platform `4.0.0-rc.118`, locked Pi `1.0.2`, Worktrunk `0.80.0`
(not exercised by this phase), agent-browser `0.38.2`, Vite `8.3.1`.

| Check | Observed result | Artifact |
| --- | --- | --- |
| Focused regression before implementation | Failed: started disposition was absent; handled input never published handling and timed out at the check's bound. | `red.log` |
| `npm test` | Passed, 18 tests. Fake Pi covers immediate completion, handled-without-run, busy extension command, queue, retry/compaction after agent_end, rejection, missing acknowledgement, caller interruption, delayed state observation and existing crash/release paths. | `tests.log` |
| Locked real Pi through PiSessions (part of `npm test`) | Passed: started, queued and a busy handled extension command; abort retains queue and native restoration adds no model request. One local, held OpenAI-compatible stream; no paid calls. | `tests.log`, `test/RealPiQueue.test.ts` |
| `npm run typecheck` | Passed for server/shared and web. | `typecheck.log` |
| `git diff --check` | Passed. | `diff-check.log` |
| `node test/browser-phase1.mjs /tmp/piano-phase1-evidence/browser` | Passed all assertions with retained output. | `browser-run.log`, `browser/result.json`, `browser/browser-commands.json` |

The real-Pi check uses the repository CLI through a shim that isolates HOME/agent storage and removes
inherited credentials, with a scratch model endpoint and explicit fixture extension. Effective args
include `--mode rpc --session-id real-queue --model piano-test/local`, `--extension <scratch>/handled.ts`,
`--no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files --no-approve --offline`.
The extension disables cache warming. This validates the changed prompt protocol, not normal project
resource discovery or built-in MCP loading.

The browser check used loopback backend/UI ports 7171/7172, a scratch registry/repository and fake-Pi
CLI override. Observations include:

- Handled input returns to Ready with an enabled composer and no invented transcript row.
- Immediate completion retains Started as input handling without making the session Working again.
- A retained dialog shows Waiting for input; answering it returns the session to Ready.
- Expanded queued text appears outside finalized history and survives reload.
- A busy extension command is Handled while independent work remains Working; model facts reconcile.
- Retrying remains active after agent_end; overlapping compaction/retry are both visible.
- Ordinary input during compaction is Rejected with Pi's explanation and does not settle activity.
- Reload while awaiting acknowledgement eventually shows Delivery uncertain, still Working, without
  replaying input. Another reload retains the uncertainty; a released old acknowledgement cannot
  replace newer handling. Process failure shows Exited and its reason.

Browser attempts 1 and 2 are retained separately: pointer clicks were obstructed by the existing
bottom-right toast placement; hovering paused expiry. The passing fixture moves the pointer away
and observes toast expiry before subsequent actions. Earlier passing runs predate the added
caller-ownership/reload-before-ack check and the exit-output drain guard; they are retained separately.
The final run was repeated after these changes. Its runtime inputs and the final test inputs are
recorded in `browser-inputs.sha256` and `inputs.sha256`.

## Limits and cleanup

- This Phase 1 journey does not itself establish project-MCP/trust-loading or broader dialog/abort
  compatibility. See the [Phase 0 checkpoint](2026-10-04-phase0-compatibility.md) for the observed
  MCP/trust controls and [Phase 2 follow-up](2026-10-04-phase2-dialog-lifecycle.md) for dialog lifecycle
  fixes. Startup dialogs remain unsupported; fake retry/compaction does not prove provider recovery.
- Dialog timeout/claim/abort races, faithful transcript projection and ordered host generations
  remain phases 2–5. The view retains the **last** input outcome, not a complete submission audit.
- Uncertain delivery conservatively prevents idle retirement until subsequent input or explicit
  release; a bounded host recovery policy remains lifecycle work. No automatic retry was added.
- Existing Vite/React script-tag and WebSocket proxy reset diagnostics appear in browser logs; this
  check is not a claim of a warning-free application. Toast placement remains an ergonomics issue.
- No dependency, production bundling or deployment change was made; no production rebuild was run.
  The user's backend, built UI and real registry were untouched.
- Scratch processes were stopped by their own PIDs; scratch repositories and isolated session storage
  were removed. Ports 7171/7172 were no longer listening. No worktrees were created.
