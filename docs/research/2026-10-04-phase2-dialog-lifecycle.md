# Phase 2 — supported dialog lifecycle and direction review

Date: October 4, 2026. Implements [Phase 2](../vertical-slice-plan.md#phase-2--resolve-a-supported-dialog-exactly-once).
Affected contracts: **INV-02–04, INV-12**. This closes the supported, post-readiness dialog slice, not
the full runtime milestone. No dependency upgrade, registry migration or deployment is included.

## Claim and implementation

Competing answers, host deadlines, cancellation and abort claim a dialog before yielding to transport.
At most one `extension_ui_response` is sent for a supported dialog in one child incarnation. Late
attachment cannot reopen a locally resolved dialog; a stale tab cannot answer a replacement child.

- `PiSessions` retains the child generation, dialog ID, host receipt time, advertised timeout and
  estimated deadline. Receipt is stamped on stdout ingestion, not when a browser attaches.
- Pi owns its advertised timeout. At the host estimate, Piano removes the retained dialog and rejects
  late answers; it does **not** invent a Pi closure acknowledgement or send an answer on expiry.
- All dialogs have a **10-minute host recovery cap**, including dialogs without a Pi timeout. At that
  deadline Piano claims and sends cancellation. This is explicit host policy, not an inferred native
  timeout. It bounds stale UI after invisible extension-owned signal cancellation and attempts to
  release the extension; failed transport remains explicit and may require restart. The modal labels
  which deadline applies. An earlier manual
  cancel/abort remains available; editor dialogs also use this policy.
- Resolution is separate from transport: locally claimed/pending, written but consumption unconfirmed,
  uncertain, or not sent. The last resolution is retained in session snapshots and shown in the UI.
  The stdin sink now reports backpressure/write failure instead of treating queue insertion as delivery.
  Uncertain responses are never retried or reopened; inspect the session and restart a blocked host.
- **Abort current**, not cancel-all: dispatch native abort before releasing waiting extensions, then
  cancel supported dialogs without waiting for the native acknowledgement. Dialogs arriving during
  abort are cancelled too. The abort window includes pre-existing pending prompt handlers; explicit
  new input supersedes it. An old acknowledgement cannot clear a newer turn/dialog. Uncorrelated late
  dialogs and invisible extension cancellation still have the host recovery bound.
- Native abort does not call `clear_queue`. The real 1.0.2 fixture preserves paused queued text, even
  with a blocking extension command dialog, and native queue restoration starts no extra model call.
  RPC documentation says remaining queued messages can continue: the UI promises **not cleared**,
  rather than universal pause/cancel-all behavior.
- Answer and abort tracking belongs to the session scope, not a browser connection. Answering a dialog
  no longer invalidates the originating command's model/effort readback.

Protocol changes remain inside `PiSessions` and `shared/wire.ts`. Browser/server wire versions must
match when eventually deploying: answers now require a generation. Pi history and registry data are
unchanged. No full event-generation/sequence protocol or transcript replay was added.

## Verification and provenance

Base: `e001a782605a5f36cfac3c315588e4e78713db50` **plus the dirty implementation**. Evidence packet:
`/tmp/piano-phase2-evidence/`, outside the registry. It retains the implementation patch including new
files, file hashes, environment, command output, browser commands, snapshots and screenshots. These
are VM-local artifacts, not a durable product evidence store.

Environment: Node `v24.21.0`, Pi `1.0.2`, Effect/platform-node `4.0.0-rc.118`, Worktrunk `0.80.0`
(not exercised), agent-browser `0.38.2`, Vite `8.3.1`. Real fixtures import the locked repository CLI
through the existing credential-stripping shim, with scratch HOME/agent/session storage and
`--mode rpc --session-id <fixture-id> --offline --approve`. Approval is scratch-only. Normal CLI
resource loading and built-in MCP remain enabled in the compatibility/browser fixture. All endpoints
are local and cache warming is disabled; **no paid model calls** were made.

| Check | Observed result | Packet artifact |
| --- | --- | --- |
| First race regression before implementation | Failed: both competing answers succeeded (`2 !== 1`). | `red.log` |
| Model readback issue found during review | Failed: dialog completion left `fake/alpha` instead of the command's `fake/beta`; fixed and protected by the same boundary test. | `review-state-red.log`, `tests.log` |
| `npm test` | Passed, 26 tests. All four dialog methods, concurrent answers, controlled-clock expiry/recovery, original deadline, abort/answer/arrival/new-turn race, stale generation, child exit and broken stdin; existing prompt/activity and real-Pi queue gates also pass. | `tests.log` |
| `npm run typecheck` | Passed, server/shared/tests and browser. | `typecheck.log` |
| `git diff --check` | Passed. | `diff-check.log` |
| `node test/phase0-checkpoint.ts …/runtime` | Exit **2**, eleven pass / zero fail / two blocked startup observations, including cleanup. The former idle-dialog-abort failure now passes. This is still **incomplete runtime compatibility**, not a pass for startup dialogs. | `runtime.log`, `runtime/checkpoint.json`, `runtime/events.json` |
| `node test/browser-phase2.mjs …/browser` | Passed: real Pi two-tab answer, stale answer rejection, original deadline across reload, actual Pi timeout, timeout absent on both tabs/reload, idle-command abort releasing the extension, no automatic resubmission. | `browser-run.log`, `browser/result.json`, browser snapshots/screenshots |
| `node test/browser-phase2.mjs …/browser-fake fake` | Passed: cancellation of a dialog arriving during abort, then a new turn/dialog surviving the old abort acknowledgement and reload. | `browser-fake-run.log`, `browser-fake/result.json` |

The real-Pi queue test was extended rather than replacing the existing queue assertions. Its local
provider remains held until native abort; a real extension dialog is now also pending. One provider
request, retained queue contents and successful dialog-command completion are all asserted.
The fake-process audit counts actual received JSONL UI responses, not helper calls or event counts.
Effect TestClock controls deadline races; observers attach before actions. The touched legacy dialog
test's arbitrary sleeps were replaced with subscription barriers.

The initial queue check exposed that cancellation could reach stdin before the forked native abort.
The implementation now observes a dispatch barrier, preserving the distinction between dispatch and
acknowledgement. The fake's post-abort cancellation path also no longer fabricates a reply/queue drain.
The first fake browser attempt failed because its catalog had no model, disabling session creation;
that fixture error and its output are retained separately. Both browser journeys were rerun after the
review fix. Existing React script-tag and Vite WebSocket-reset diagnostics remain in browser logs.
No build was needed for dependency/bundling changes; none were made, and the served built UI was not
rewritten.

## Review of Phases 0–2

Review baseline: `adee7e2` → Phase 0/1 commit `e001a78` → this dirty Phase 2 implementation, including
new files. Standards: `AGENTS.md`, testing policy, glossary, ADR 0001 and invariants. Spec: the checked-in
vertical-slice plan. This was two manual review passes by the implementing assistant, **not an
independent sub-agent review**. No delegation tool was available. The optional issue-tracker workflow
is not configured (`/setup-matt-pocock-skills` would set it up); the repository plan supplies the spec.

### Standards

No remaining changed-scope standard violation found. Pi retains history/configuration authority;
protocol translation stays behind the deep module; no registry evidence database, duplicate config
loader, browser-owned execution, public listener or unrelated abstraction was introduced. Checks use
public interfaces and real process/CLI boundaries, with scratch isolation and retained failures.
The larger `PiSessions` implementation still hides one coherent lifecycle responsibility behind the
existing interface; file size alone is not a reason to split that contract into forwarding modules.

### Spec

One actionable cross-phase finding was reproduced and **fixed**: every action advanced the metadata
operation version, so an answer suppressed the command's post-dialog model/effort reconciliation.
Only prompt/model/effort operations now supersede that observation; existing delayed-state protection
still passes. No remaining blocker found for the supported Phase 2 slice.

The overall direction is correct: finish bounded runtime correctness before building the observable
workspace/evidence loop. The next work is **Phase 3's faithful/safe projection**, not full TUI parity,
agent orchestration or another runtime migration. This review does not certify future invariants:

- Awaited startup dialogs remain unsupported, with explicit spawn/timeout failure. Terminal-only
  `custom()` UI remains unsupported. Pi provides neither UI-response consumption acknowledgement nor
  ordinary signal/timeout closure events; local outcomes must stay labeled as such.
- Phase 3 still owes authoritative final text/tool/model projection and consistent secret redaction.
- Phase 4 still owes canonical/concurrent host acquisition, release/reopen serialization and the
  complete retirement/recovery policy. Phase 0's premature Starting indicator is also still backlog.
- Phase 5 still owes session/generation/sequence envelopes, ordered switching and bounded client
  delivery; the dialog generation added here is not that protocol. Retained per-child dialog IDs
  and existing queues remain subject to that bounded-delivery/lifecycle work.
- Worktrunk discovery compatibility, revision capture, processes, evidence and guarded integration
  remain their later phases. No successful session or passing module test is task acceptance.

Summary: Standards **0 remaining findings**; Spec **1 fixed finding, 0 remaining Phase 2 blockers**.
Broader runtime gaps remain explicitly staged, not waived.

## Cleanup

Only scratch directories were registered. Browser/backend/Vite processes were stopped by their own
PIDs; the fixture confirmed Pi/MCP children exited before removing isolated session storage and repos.
No worktrees were created. Ports 7171/7172 are free. The user's services, registry, credentials and
built UI were untouched; no deployment was performed.
