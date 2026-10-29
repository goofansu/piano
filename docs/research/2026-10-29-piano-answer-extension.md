# Using agent-stuff's answer.ts for piano-answer

## Recommendation

**Yes: adapt its question-extraction core, not its terminal UI or the whole package.**
A small `extensions/piano-answer/index.ts` can use Pi's existing dialog APIs and the inline
question surface merged in [PR #354][pr]. No new `ask_user` tool, browser-side model call,
transcript scraper, or RPC message type is needed for a basic version.

This is a proposal, not an implemented or runtime-verified extension.

Inspected on 2026-10-29:

- agent-stuff commit `0865c849befd2021490679f96a8dee58c84ac857`, especially
  [`extensions/answer.ts`][answer] and its [Apache-2.0 license][license].
- Piano commit `9de374b145415b388212abc9f46166a6043df292`, the final head of merged PR #354.
  The PR body describes an earlier tested revision; the final source also includes a live
  last-answer receipt, so the source is the authority for current behavior.
- Installed `@earendil-works/pi-coding-agent` **1.4.0**, including its RPC implementation,
  extension declarations, model-registry declarations, and Q&A example. [P1–P4]

## What upstream actually does

`/answer` (or terminal shortcut Ctrl+.) searches the current session branch for the latest
assistant message with text, rejects an incomplete assistant response, and makes a separate
model request to extract `{ questions: [{ question, context? }] }`. It then opens a custom
terminal questionnaire, collects free-text answers, asks for confirmation, and sends one
custom `answers` message with `triggerTurn: true`. It is **user-invoked extraction after an
assistant response**, not an agent-callable question tool or automatic question detector. [A1]

Useful pieces to adapt:

- Branch-aware message selection, rather than parsing Piano's rendered transcript.
- The extraction prompt and ordered question/context representation.
- Defensive JSON parsing: fenced JSON, whole response, or an object substring, followed by
  `parseJsonWithRepair` and runtime shape validation.
- Explicit no-questions, extraction-error, and cancellation outcomes.
- Compiling the final answers into one message and starting only one agent continuation. [A1]

The schema does **not** extract multiple-choice options, defaults, required/optional flags,
question IDs, or input kinds. All answers are text, and unanswered items become `(no answer)`.
Using #354's radio groups would require an intentional schema/prompt extension; it is not
behavior we obtain by copying this file. [A1]

## Why it cannot run unchanged in Piano

| Upstream behavior | Consequence in Piano | Adaptation |
| --- | --- | --- |
| Guards only with `ctx.hasUI` | RPC reports `hasUI: true`, so this does not reject Piano. | Use supported dialog methods; guard any retained terminal UI with `ctx.mode === "tui"`. |
| Both extraction loader and questionnaire use `ctx.ui.custom()` | RPC returns `undefined` without running the component factory. On the normal path with an assistant message/model, extraction does not run and `extractionOutcome.status` would dereference `undefined`. | Move extraction outside UI factories; replace both custom components. |
| `QnAComponent` owns ANSI drawing, editor keys, navigation, answer state and confirmation | None of that component is transferable through the RPC dialog protocol. | Use `ctx.ui.editor`/`input` and optionally `select`; Piano owns rendering. |
| Registers Ctrl+. | A Pi terminal shortcut is not a Piano browser shortcut. | Start with the slash command; do not add another global shortcut. |
| Calls standalone `pi-ai.complete` with manually resolved key/headers | Copies provider/auth plumbing; resolved auth can also include `baseUrl` and `env`, which this call does not forward. | Prefer `ctx.modelRegistry.complete`, as the installed Pi Q&A example does, or its provider-neutral `streamSimple` API. |
| Sends a custom `answers` message | Piano maps custom messages to a context row, not an ordinary user reply. | Prefer `pi.sendUserMessage(compiledAnswers)` for human answers, unless custom-message semantics are intentional. |

The RPC failure is a source-level deduction, not an executed compatibility test. The relevant
RPC contract explicitly documents `custom()` returning `undefined`; the installed implementation
matches it. [A1, P1–P4, L1]

## What PR #354 gives us

The selected session's pending `input`, `editor`, or `select` request appears above the composer;
`confirm` stays modal. Only the queue head is interactive. Selection alone does not submit:
**Send answer** uses the existing answer controller. The composer draft stays separate. [L2]

Piano already owns request IDs/generations, competing answer/cancel/timeout/abort claims,
reconnect snapshots, stale-answer rejection and uncertain transport delivery. Reuse these;
do not create an independent answer endpoint or browser-owned questionnaire queue. The last
accepted answer is retained in live host state, **not added to Pi history**. A dialog response
is not itself a user message or an automatic agent continuation. The extension must submit the
compiled result through Pi to make it durable conversation content. [L3–L5]

There are two important presentation limits:

1. Standard `input`/`editor` requests do not carry a separate context/description field, even
   though Piano's generic dialog shape has `message`. `input`'s placeholder appears under
   Details, not as the visible input placeholder. Put essential context in the question title
   or in the full answer-sheet text; do not silently hide information needed to answer. [P1, L2]
2. There is no structured multi-question wizard API. Sequential dialogs do not provide
   upstream's Back/Next navigation, editable prior answers, or all-question progress. A faithful
   rich wizard is a separate browser/protocol design, not something #354 already implements. [P1, L2]

## Suggested first version

Keep the module named `piano-answer`. A `/piano-answer` command avoids colliding with an installed
upstream `/answer`; use `/answer` only if we deliberately settle that coexistence policy.
Load the bundled extension by installation-resolved path, following `server/PiCli.ts`, not from
the session's arbitrary working directory. [L6]

Recommended minimal flow:

```text
/piano-answer
  → require idle session; reject a second concurrent extraction
  → capture current branch/source assistant entry
  → extract and validate questions through Pi's model registry
  → ctx.ui.editor("Answer questions", formatted Q:/context/A: sheet)
  → cancel: send nothing
  → Send answer: pi.sendUserMessage(editedSheet), once
```

This is one inline multiline answer sheet: all questions remain visible/editable, one explicit
submit, and no extra modal confirmation. It sacrifices separate fields but fits the existing
protocol with the least machinery. Validate blank/unchanged sheets rather than accidentally
sending unanswered `A:` placeholders. The installed Pi `qna.ts` demonstrates extraction into an
answer sheet, but uses terminal-only loading and `setEditorText`; copy neither part into Piano,
where preserving the composer draft matters. [P3, L2]

If separate questions are the product requirement, replace the single sheet with sequential
`ctx.ui.editor(questionTitle)` calls, collect results inside the extension, and send one compiled
user message only after the last answer. Use `input` only for deliberately single-line answers.
Cancel at any step should end the entire flow without sending partial answers. Decide whether
final review is worth an additional editor; do not pretend a per-question **Send answer** already
sent the aggregate to the model. No structured options should be invented without extending and
validating the extraction schema.

Further implementation requirements:

- **Model policy:** upstream tries configured Codex models in a hard-coded order, then Haiku,
  then the current model. This is auth-based selection, not retry/fallback after a failed
  extraction. It can send conversation text to a different provider and incurs an extra call.
  Default to the current model; make a cheaper extraction model an explicit future preference.
  Do not copy dated model IDs as Piano policy. [A1]
- **Cancellation:** upstream cancellation belongs to `BorderedLoader.signal`. Idle extension
  commands often have no `ctx.signal`, and ordinary native abort is not a general cancellation
  hook for their auxiliary model calls. Give extraction an owned controller, a bounded deadline,
  shutdown cleanup, and a defined user-cancel path. A status/notification alone is not a cancel
  control. Do not claim composer Stop cancels extraction without proving it. `editor()` also
  has no signal/timeout options in the inspected API; rely on the existing host dialog
  cancellation path rather than passing unsupported options. [P1–P3, L3]
- **Staleness/concurrency:** one active flow per session; invalidate late extraction/results
  after shutdown or a changed conversation. Revalidate the source before submitting so answers
  to an old assistant response do not unexpectedly steer a newer run. Reconnect must not rerun
  extraction or resubmit answers. [I1]
- **Validation:** treat extraction as untrusted model output. Bound question count/text/output,
  reject blank questions and incomplete model output, preserve essential context, and keep
  errors separate from an empty question list. Upstream checks types but does not impose these
  bounds or reject blank strings. [A1]
- **History/cost:** let Pi record the final user message; do not store a competing transcript in
  Piano's database. Upstream does not append the extraction response or its usage to history;
  do not assume this auxiliary request appears in ordinary session usage totals. [A1, I1]

This keeps INV-01 (Pi owns history), INV-02/05 (browser lifecycle does not duplicate work),
INV-04 (one dialog resolution), and INV-12 (supported Pi APIs behind the existing boundary).
A session menu/header action, if added later, also needs its corresponding command-palette row;
the initial slash-command-only version need not add a new global keyboard binding. [I1, I2]

## License and packaging

The upstream repository is Apache-2.0; Piano is MIT. Adapting and distributing this source is
permitted under Apache-2.0's conditions, but the copied material does not become MIT-only.
Include the Apache license, retain applicable notices, identify upstream provenance/revision,
and prominently mark modifications in adapted files. Preserve applicable NOTICE attribution
if supplied; no root NOTICE file was present in the inspected checkout. [A2, L7]

Vendor only the useful source, with attribution, rather than taking the whole `agent-stuff`
package and its unrelated extensions. Alternatively, implement the small RPC-native flow from
Pi's APIs and the MIT-licensed Pi example; that example is not itself RPC-ready. [A1, P3, P5]

## Evidence required before shipping

Research establishes feasibility, not runtime compatibility. The smallest useful proof is an
actual Pi 1.4.0 RPC roundtrip with deterministic synthetic extraction output: request the editor,
answer it, and observe exactly one user message/continuation. Then verify in a scratch Piano:

- Empty extraction and malformed output; cancellation during extraction and during answering.
- Multiline answers and a preserved composer draft.
- Reload/two-tab competition without duplicate answer writes or continuation.
- A late extraction after cancellation or a changed source cannot open a question or send a reply.
- Submitted answers survive reopening via Pi's history, not just the live last-answer receipt.

Run typecheck, lint, module tests, and the affected scratch-browser journey for implementation.
Do not treat PR #354's fake-Pi browser evidence as proof that this extension works with real Pi.
No application code was changed, no model calls were made, and no app was started or deployed
for this research. Inspection ran on Linux / Node 24.22.1. Documentation/link review is the check
for this note; runtime and browser verification remain outstanding.

## Sources

- **A1:** [agent-stuff answer.ts at the inspected commit][answer].
- **A2:** [agent-stuff Apache-2.0 license][license], especially sections 2 and 4.
- **P1:** [Pi 1.4.0 RPC extension UI][rpc-ui]; inspected installed
  `dist/modes/rpc/rpc-mode.js` as well as the documentation.
- **P2:** [Pi extension declarations][pi-types] and [model registry][pi-models]; inspected
  installed `dist/core/extensions/types.d.ts` and `dist/core/model-registry.d.ts`.
- **P3:** [Pi 1.4.0 Q&A example][qna].
- **P4:** [Pi extension lifecycle and UI/modes guide][pi-extensions].
- **P5:** [Pi MIT license][pi-license].
- **L1:** [Piano message projection](../../server/PiRecords.ts), custom-message branch.
- **L2:** [InlineQuestion](../../web/src/components/InlineQuestion.tsx),
  [answer controller](../../web/src/lib/useDialogAnswer.ts), and [PR #354][pr].
- **L3:** [SessionDialogs](../../server/SessionDialogs.ts),
  [PiSessions](../../server/PiSessions.ts), and [runtime ownership](../runtime-ownership.md).
- **L4:** [Dialog/DialogResolution wire contracts](../../shared/wire.ts).
- **L5:** [AnsweredQuestion](../../web/src/components/AnsweredQuestion.tsx).
- **L6:** [Bundled extension loading](../../server/PiCli.ts).
- **L7:** [Piano MIT license](../../LICENSE).
- **I1:** [Development invariants](../development-invariants.md),
  [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), and [roadmap](../roadmap.md).
- **I2:** [Project UI and command conventions](../../AGENTS.md).

[answer]: https://github.com/mitsuhiko/agent-stuff/blob/0865c849befd2021490679f96a8dee58c84ac857/extensions/answer.ts
[license]: https://github.com/mitsuhiko/agent-stuff/blob/0865c849befd2021490679f96a8dee58c84ac857/LICENSE
[pr]: https://github.com/goofansu/piano/pull/354
[rpc-ui]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-extension-ui.md
[pi-types]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/extensions/types.ts
[pi-models]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/model-registry.ts
[qna]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/examples/extensions/qna.ts
[pi-extensions]: https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md
[pi-license]: https://github.com/earendil-works/pi/blob/v1.4.0/LICENSE
