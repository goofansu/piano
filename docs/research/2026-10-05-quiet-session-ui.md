# Quiet session UI — Codex and T3 Code references

Date: October 5, 2026. User feedback: accuracy belongs in the implementation, not permanent
provenance disclaimers throughout the UI. This corrects Phase 3's presentation, not its state
contracts. Preserves **INV-01, INV-03, INV-11–12**.

## Primary-source observations

- [OpenAI's model documentation](https://developers.openai.com/codex/models) places model and
  reasoning selection beneath the composer. The
  [official changelog](https://developers.openai.com/codex/changelog) also describes the Codex app's
  composer model selector. These are first-party documentation observations, not a fresh Codex
  desktop-app run or proof that no version ever displays diagnostic information.
- T3 Code was inspected directly at **`efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448`**, using the
  read-only reference checkout `/home/exedev/.cache/checkouts/github.com/pingdotgg/t3code`:
  - [`ChatHeader.tsx`](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/apps/web/src/components/chat/ChatHeader.tsx#L235-L334)
    renders project/conversation breadcrumbs and title actions, rather than runtime provenance copy.
  - [`ChatComposer.tsx`](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/apps/web/src/components/chat/ChatComposer.tsx#L5375-L5488)
    owns the provider/model picker and related controls.
  - [`ContextWindowMeter.tsx`](https://github.com/pingdotgg/t3code/blob/efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448/apps/web/src/components/chat/ContextWindowMeter.tsx)
    uses a small meter trigger and a popover for usage, total processed tokens, cost and compaction
    information. It does expose detail, but on demand—not as a persistent transcript disclaimer.

Research was performed directly; no background-agent tool was available. No reference application's
code or install scripts were executed. The useful pattern is placement and progressive disclosure,
not a claim that either product hides all metadata or a requirement to clone either application.

## Piano decision and changes

- Remove the permanent **Current Pi context / Recorded selection / Full-session usage** strip.
- Keep the model/effort picker where it already belongs: the composer. Add session totals and the
  latest displayed response's physical model/effort to the existing **Context usage** popover.
- Remove repeated per-response model/token footers and tool accounting/protocol explanations.
  Nest child tool output under its parent visually, with ordinary running/done/error/incomplete
  status instead of printing internal parent IDs. Missing output remains honestly unavailable.
- Let the existing activity status and queue communicate started/queued input instead of duplicating
  them in a receipt paragraph. Handled input gets a short confirmation. Rejection and uncertain
  delivery remain visible; no automatic resubmission behavior changes.
- Replace the editor-request disclaimer with **Suggested message**. The opt-in append action and
  no-automatic-send contract are unchanged.
- Show an actual context-refresh failure as a concise warning, with technical details collapsed.
  Recovery removes it. Do not hide real failures along with routine caveats.

There are **no production server, wire, model-loading, projection, redaction or persistence changes**.
The current-context scope and recorded-versus-running distinction remain documented in README and
protected by the existing module suite. The vertical-slice plan now explicitly separates the
correctness contract from presentation; its former fixed label placement was not a product need.
`AGENTS.md` records the user's quiet-UI preference so later phases do not repeat this mistake.

## Verification

Tested base **`dd3580a` plus dirty changes**. Packet: `/tmp/piano-quiet-ui-evidence/`, outside the
registry. It includes `implementation.patch`, `input-sha256.txt`, `environment.txt`, command outcomes,
browser commands, screenshots and snapshots. These are VM-local artifacts; fixtures are committed.

Environment: Node `v24.21.0`, locked Pi `1.0.2`, Effect/platform-node `4.0.0-rc.118`, agent-browser
`0.38.2`, Vite `8.3.1`; Worktrunk `0.80.0` not exercised. Scratch backend/UI used loopback 7171/7172,
created repos/registry and isolated agent/session storage. **No paid model calls.**

| Check | Observed result |
| --- | --- |
| `npm test` | 31 passed, unchanged module assertions for authoritative text, usage, model/effort, context edits, redaction and lifecycle. `tests.txt`. |
| `npm run typecheck` | Server/shared/tests and browser passed. `typecheck.txt`. |
| `node test/browser-phase3.mjs …/browser-final` | Passed saved-file, live, partial/final reload and mobile presentation; no routine diagnostic strip/footers; model picker stays correct; physical model/effort and usage available through a pointer-opened popover. Existing correction, compaction, nested-output, extension state, redaction and inert-markup assertions remain. Added actual refresh failure/recovery. `browser-final-run.txt`, nine screenshot/snapshot pairs and command log. |
| `node test/browser-phase1.mjs …/prompt-browser` | Passed handled input/usable composer, immediate completion, queue/reload, busy command model readback, retry/compaction, rejection, uncertain delivery, no replay and exit with the quieter feedback. `prompt-browser-run.txt`. |
| Diff and local document links | Passed. `document-check.txt`, `diff-check.txt`. |

Browser assertions were deliberately changed from permanent labels to the relevant controls,
on-demand inspection and accessible tool grouping. This is a reviewed presentation change, not
removal of the underlying correctness assertions. No new module test was warranted for copying or
hiding metadata; the existing module contracts plus the updated affected browser journeys cover the
risk. The Phase 2 browser fixture's one handled-input text expectation was updated for consistency;
its full dialog journey was not rerun because no dialog behavior changed and the module suite passes.

Review: implementation and contract review by the implementing assistant, not independent review.
The production code diff is confined to three UI modules; data authority and security checks remain
unchanged. No unresolved blocker found for this presentation change. This does not certify later
host-ownership or transport-ordering phases.

## Cleanup and rollout

Only owned scratch processes were stopped, by PID. Scratch repositories and isolated Pi session
storage were removed; no worktrees were created. Ports 7171/7172 are free. The user's registry,
running services and built UI were untouched.

**Not deployed.** No backend restart is technically needed for this UI-only change; activation needs
a frontend build and browser reload. On an explicit deploy request, the user's preference still
requires a prompt **`piano.service`** restart, with active-session cutoff preapproved. No proxy restart
is needed. Build, production restart and browser reload were not performed for this change.
