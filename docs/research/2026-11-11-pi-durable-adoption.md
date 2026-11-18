# Pi Durable reassessment: recover work, not just conversations

## Recommendation

**Keep normal Pi RPC for Piano sessions. First measure a persisted dispatch/job-record baseline;
consider Durable only for a bounded, restart-safe reviewer. Do not build on p2.** Durable has gained
useful orchestration primitives since [October 11](2026-10-11-pi-durable-adoption.md), but the old
experimental Coding Agent host was deleted and its newer sibling explicitly warns against depending
on it. This is research, not authorization to implement, upgrade, or change the ADR/roadmap.

The strongest potential improvement is a parent resuming a known dependency after a process crash,
with a child result attributed to the original request—not more agents or a different chat transport.
Approval pauses and review/check loops are plausible later uses, not reasons to migrate all sessions.

## Evidence boundary

Inspected on **2026-11-11**, using a refreshed librarian checkout and first-party npm tarballs:

| Evidence | Exact revision/version |
| --- | --- |
| Upstream `main` | `6e11a00a01a568ef0ae0df5074acf02fc107c34b` |
| Latest published Durable and Coding Agent | npm `1.5.2`, Durable published November 10; `v1.5.2` resolves to `b4afdddf44e059c67ccf5097e5317d913521b470` |
| Historical comparison | `ea448f454af474f3e2fe9733b331e17b0662f5d6`, October 11 note / npm `1.1.0` |
| Piano | `9c14c94b8739aca0d44c2d5ceb769fd4943c9e79`; package range `^1.5.2`, lockfile `1.5.2` |

**Observed:** repository contents/history, npm metadata, downloaded package manifests, declaration
exports and compiled admission code. **Not observed:** executing Durable, recovery under actual
SIGKILL, model quality/spend, or compatibility with a user's configuration. Upstream test cases below
are inspected evidence of intended contracts, not tests run here. No credentials/models, user
backend/database, deployment, or application changes were involved.

The `1.5.2` Durable tarball contains compiled library exports for tools, Code Mode, tool search,
environments and storage (SQLite, JSONL, IndexedDB, Chord Store); it has no CLI. Coding Agent's tarball
exports the normal package and `./rpc-entry`, with the `pi` executable. Neither contains p2 or the
removed experimental host. npm metadata did not supply `gitHead`; the release tag and tarball were
inspected separately, not assumed byte-identical. Durable's verified tarball integrity is
`sha512-zDB3anbI/yD0IG+VVY+g5tU+c5XOVqQAFwLkXRMiqZb4p/afWro0voZtLNoRAWcDA2r73kvmH6kKin9Ka8l55g==`.
Durable still labels its API experimental, with changes without notice between releases. [S1–S3]

## What changed since October 11

| Area | Revalidated current finding | Consequence for Piano |
| --- | --- | --- |
| Distribution/host | npm advanced from 1.1.0 to 1.5.2. Commit `7472cda0d6e51dfbf53c03f46b47aa42ac64bf64` deleted the experimental Coding Agent server/client/services stack on October 12. `apps/p2` is a private source app, not the supported replacement API. | The old recommendation to track that host as the likely migration path is obsolete. Track library contracts and patterns, not p2 integration. |
| Code Mode | Published since 1.2.0: deterministic script replay, journaled nested results, stable nested-call keys, divergence/fingerprint/deadline failures. | Scripts can recover orchestration without redoing completed nested calls; arbitrary external tool effects still need reconciliation. |
| Recovery/budgets | Published durable sleeps/wake scheduling; 1.5.0 charges a crashed in-flight model request to retry policy and terminates restart loops visibly. Turn limits, continue submissions, transactional admission and `afterRun` tasks are available. | Stronger bounded workflows, but loop-wide budgets and failed-run policy remain host work. |
| Live state/history | 1.5.0 introduced windowed transcript views/paging and deferred progress persistence; removed `viewState()`, `taskGraph()` and `watchEvents()`. | The old claim that all visible progress is already on disk is no longer correct. Adapter/API churn is material. |
| Suspendable work | **Main only**, commit `473515f9c297c75cf2c3ebb3ba027049ed836d27` on November 11: typed signals, parked tools, gates, settlement notification, task-returning `onYield`/`afterTools` hooks. | Direct building blocks for approval waits and parent/child coordination, but not yet npm 1.5.2 capabilities. |
| Host ecosystem | p2 now has subagents, one-shot structured agents, Code Mode, MCP/OAuth, prompt resources and history/tree UI. Its README says “It will be gone soon” and “Do not build on it”. Its waiting-work host integration is still a design draft. | More proof of architectural possibilities, **not** normal Pi environment compatibility or a stable distribution. |

Sources: published changelog/package [S1–S3], deletion [S4], unreleased change [S5], p2 [S9–S12].
The downloaded 1.5.2 root declarations export `RunEndTask`/`runEndTask`, not
`defineSignal`, `ToolPark`, or `HookTask`; main renames the former to `HookTask`/`hookTask`.
Main also raises built-in task versions; opening its data with an older Harness is not a supported
rollback. Published 1.4.0 already introduced a SQLite schema migration incompatible with 1.3.0. [S2, S5]

## What the runtime actually guarantees

### Execution and ownership

```text
host owns one storage writer + definitions + scheduler lifetime
  → atomic submission admission / persisted inbox
  → generation task → tool tasks → next generation / terminal result
  → reopen storage, reinstall definitions, resume checkpoints
```

A Harness owns an open storage; its storage Session can contain several Durable conversations.
These are not interchangeable with Piano sessions. A task is an explicit checkpointed state machine,
not a serialized JavaScript stack. A phase can rerun from its beginning after a crash. Owned child
tasks/conversations participate in waits and cancellation; background tasks deliberately escape
parent abort/idle waits. Cancelling an observer's wait does not cancel execution. Custom definitions
need stable names, versions and migrations; missing/incompatible definitions can block work. [S1, S6]

On **unreleased main**, a typed signal delivered to a task/key returns `delivered`, `duplicate`,
`invalid`, `closed` or `not_found`; early delivery is retained until the task waits, and a key serves
one wait. A parked tool releases its invocation, then runs again with a checkpoint/wake reason.
Submission settlement can signal its waiting parent in the settling commit. This persists the
coordination, not the host process: routing, timers and waking a stopped worker remain host duties.
[S5, S6, S14]

There is **one writer per storage**, with no core cross-process ownership lock. A host must enforce
that ownership and supervise reopening/wake deadlines. SQLite WAL with `synchronous=NORMAL` protects
process-crash recovery, not loss of the newest commits after power/host failure. A JSONL viewer must
open storage read-only as well as the Harness: a writable open repairs/truncates files. A storage
failure ends the Harness and its waits; it is not transparently retried. Keep failure isolation per
worker, backup/migration policy and storage errors explicit. [S1, S2]

### Identity is useful, but narrower than “exactly once”

- Admission deduplicates **within a conversation**, by `(conversationId, requestId)`; a stored
  submission can be reacquired by ID after restart. `submit(tx, draft)` can make admission atomic
  with the workflow's own state, when both live in that Durable transaction. [S6, S7]
- **Same ID, changed payload is not rejected** when the submission type is unchanged: the existing
  submission is returned. Both compiled 1.5.2 and main implement this; the upstream test intentionally
  sends `content: "different"`. Piano would need an immutable request digest and conflict refusal at
  its boundary, not assume Durable checks equality. The ID is neither authorization nor a global
  cross-worker deduplication key. [S7]
- A persisted provider session UUID supports cache/session affinity; it is not proof that a provider
  charged or executed a model request once. A killed model stream is a failed attempt, with retry
  backoff/budget and possible new spend/output. Graceful close and crash have different recovery
  accounting. Missing unpersisted streaming usage is another reason to budget conservatively. [S1, S2]
- Interrupted tools rerun only if **stored intent and current definition** both say `replay: "safe"`.
  Built-in file/shell tools do not opt in. Unsafe interrupted calls produce errors, not automatic
  reexecution. Code Mode replay reuses journaled results, but a nested call interrupted before its
  result follows its own policy. Divergence or sandbox/version changes end the script. [S6, S8]
- No local transaction can atomically cover Git push/merge, PR creation, CI launch or a remote
  service. Persist an operation key before acting, use external idempotency where available, and
  reconcile ambiguous outcomes. A model can issue a *new* unsafe call after an interrupted error;
  tool replay policy alone does not prevent that semantic retry. Cleanup/cancel must also tolerate
  repeated invocation. [S1, S5, S8]

### State is authoritative, but not every displayed byte is durable

The published README introduction still says nothing is shown before storage; its detailed deferred
commit section and changelog qualify that. Streamed answer/tool progress can be visible before it is
stored, normally for up to about **1 second** (`progress.persistWithinMs`; zero requests immediate
persistence). Entries, task changes and submissions are not such deferred-only commits. Treat live
progress as provisional; never certify evidence from an unpersisted view. [S1, S2]

Conversation watches now expose bounded windows (default newest 50, trimming above 100), with
`ConversationTranscript`/entry paging for older history. Slow observers get folded changes/root
replacement, not an unbounded historical event stream. A host still owns transport, authorization,
client generation/gap recovery and the distinction between a settled submission and completed work.
In particular, `afterRun` checks begin **after** the input settles; idle waits include those tasks,
but `Submission.wait()` does not certify that tests passed. [S1, S6]

## Compatibility: more pieces exist, no drop-in normal Pi host

| Normal Pi concern | Current source/distribution evidence |
| --- | --- |
| Models, settings, credentials | Durable consumes host-supplied pi-ai models/settings. p2 has its own models/settings/auth in `P2_DATA_DIR`, default `~/.pi/p2`; this is not automatic use of normal Pi configuration. |
| AGENTS.md, skills, prompt templates | p2 implements ancestor AGENTS.md and skill/template loading/expansion, with global resources in its own data directory and project `.pi/skills` / `.pi/prompts`. It copies/adapts Coding Agent logic; discovery/trust equivalence must be tested, not inferred from file format. |
| Normal Pi extensions/packages | Durable extensions are named tools/sections/hooks/tasks, a different interface. p2 uses Chord plugin facets; global/package/project plugin loading remains a design. No normal `ExtensionAPI`/resource-loader compatibility layer was found in inspected p2 runtime/plugins. Piano's bundled dispatch/question/preview tools do not transfer automatically. |
| MCP/project overrides | p2 implements a server-owned MCP manager, OAuth and worker tool bridge using pi-mcp. It reads its own `mcp.json` and constrained project overrides (e.g. project stdio only, no project HTTP/auth/env substitution). MCP tools are explicitly not replay-safe. This is functionality, not compatibility with normal Pi's full configuration/trust lifecycle. |
| Code Mode | A real published Durable extension, supplied a sandbox by its host. p2 installs it. Similar script surface does not imply equal tool names/results/capabilities; sandbox fingerprint changes can prevent recovery. |
| Dialogs/approval | Core signals/gates are on main, not an implementation of normal RPC `extension_ui_request`. p2's wait records, question/approval UI and wake handoff are documented as unbuilt design. Piano would still own authenticated response routing, stale decisions and single resolution. |
| History, forks, images | Durable supports fork-aware history/paging; p2 has tree/history and image flows. These are Durable storage, not a normal Coding Agent JSONL session reader/migration. No normal-session import/parity path was demonstrated. |

Sources: [S1, S6, S9–S12]. p2's worker opens Durable over Chord `StoreStorage` after installing model
and plugin contributions; it is not `pi --mode rpc`. Its persistent subagent reporter submits parent
follow-ups using stable IDs; one-shot agents can produce schema-validated results with bounded parse
retries. Those are useful examples to study. Do not read “exactly-once reporter” in host notes as
exactly-once shell/service execution, or “read-only conversation” as a read-only filesystem sandbox.
The latter prevents direct chat mutation; granted tools may still write. [S10, S13]

## Practical options for Piano

Piano's current baseline is stronger than the October note: normal RPC is locked to 1.5.2, and a
persisted creation `attemptId`/request digest prevents duplicate session creation/first-input replay
across restart. But dispatch wait attribution remains generation-bound, with process-keyed evidence;
handles in Pi history are **not** durable jobs or per-turn receipts. Restart can leave an old wait
unattributable; status reads do not resume work or prove which earlier dispatch produced an answer.
Child completion does not wake a parent whose turn ended. [P1–P3]

| Opportunity | Cheapest adequate approach | When Durable adds something material |
| --- | --- | --- |
| Recover delegation/parent-child coordination | Persist job ID, request digest, parent/child session references, revision, expected result identity, budget and explicit state; reconcile existing creation claims and history, surface unknown. Keep ordinary RPC. | Checkpointed parent waits/reporting and intra-runtime admission/result transitions across crashes, **if the workflow really runs in Durable**. Wrapping RPC in a Durable task alone cannot make the RPC send/receipt atomic. |
| Review/check loops | Separate ordinary Pi reviewer on an immutable candidate; persist each check/result and explicitly bound rounds. | Durable task ownership, run-end tasks and deterministic Code Mode can preserve completed steps. New task-returning `onYield` hooks can hold input settlement for a review, but are unreleased. |
| Human approval pause | Persist a pending decision in Piano, bound to exact candidate/action/policy; resume an explicit step after revalidation. | Signals and parked gates release the invocation while waiting and survive reopen. Host answer routing and policy still have to be built; this alone is not worth replacing the session runtime. |

The RPC/job-record option is **proposed**, not already implemented. It recovers coordination, not an
interrupted model/tool execution. An uncertain follow-up to normal RPC must remain unknown unless
Pi supplies attributable durable receipt evidence; do not blindly replay it or parse “latest answer”
as a receipt. Start with a durable result available for the user/next parent turn, not automatic
parent prompting. Automatic notification needs an outbox plus receiver deduplication or explicit
uncertainty handling. [P2, P3]

For approval gates, bind the decision to workspace, content revision, target, action arguments,
policy version and expiry; revalidate immediately before executing. Main reruns the gate chain on
wake, registry change and reopen, but later hooks can still rewrite approved arguments: order
transforms before checks and freeze the approved intent. Removing the gate extension must fail closed
at Piano's action boundary. These are INV-04/07–11 duties, not properties of a boolean signal. [S5, S6]

## Smallest useful prototype—conditional, not implementation approval

**Question:** does checkpointed execution recover a bounded review dependency substantially better
than a persisted RPC job record? First collect actual lost-work/reattribution incidents; if there is
no recurring pain, stop at this research, as the roadmap requires.

Use one immutable candidate and one parent → reviewer → local result workflow, at most two review
rounds, no repository writes, shell/MCP/network tools, worktree lifecycle, automatic parent prompt,
PR creation or integration. Use a dedicated scratch worker/storage and explicit read-only tools;
separate sessions remain ordinary RPC. Fake provider/tools first, with stable IDs and a parent
checkpoint waiting for the child's attributed result. Compare two arms:

1. **RPC + tiny job record:** preserve orchestration/result references; process death may require
   an explicit fresh reviewer attempt. Do not pretend unknown RPC admission is safely retryable.
2. **Published Durable 1.5.2:** reuse owned conversations, submissions, child tasks and checkpointed
   waits. Pin the full dependency/runtime set. Do not make unreleased signals/p2 a prerequisite.

Only if an actual approval-wait requirement emerges, add a **separate main-pinned experiment** of
signals/gates; label its storage non-downgradable and disposable. Keep workflow/evidence contracts
behind a narrow Piano boundary. Pi remains history owner; the job record stores references, not a
second transcript, and check outputs belong to the evidence boundary (INV-01/07–09/12–13). [P4]

### Failure-injection acceptance gates

All are **proposed checks**, not results of this research:

1. Kill before admission, after admission/before acknowledgement, and after child answer/before
   parent receipt. Reopen and retry the *same* ID: one logical child/request/result; changed digest
   is refused. For RPC ambiguity, report unknown without a second send.
2. Kill during model streaming, a safe read and a nested call. Verify stored results are reused,
   permitted retries spend the remaining persistent budget, unsafe calls are not rerun, and every
   job reaches a bounded terminal/needs-input/unknown state. Repeated crashes cannot loop forever.
3. Simulate an external effect succeeding before its receipt is stored. Reconcile by operation key;
   ambiguous non-idempotent effects stop for inspection, never “retry to be safe”. This uses a fake
   effect ledger, not GitHub/CI or real credentials.
4. Kill/restart the owner while waiting; attempt a second writer; remove a task definition and inject
   storage failure. Ownership is exclusive, failures visible, missing definitions blocked, no false
   completion. Reattach two/slow clients: results agree; display-only progress loss is not lost proof.
5. Parent stop, child stop, observer cancellation and background ownership have documented distinct
   outcomes. No automatic parent wake/send unless separately authorized and deduplicated.
6. Change revision/requirements after review. Result remains historical, never current verification.
   Submission `done` is not check pass: test pending/failed `afterRun` work. For a main-only yield
   experiment, test abort/restart-limit paths too—upstream can settle inputs with the answer when
   ending a yield wait; do not encode approval as “submission done”. [S14]
7. Optional gate arm: answer before park, duplicate/two-tab answer, timeout/abort race, late answer,
   reopen, changed arguments/candidate/policy and removed gate. Exactly one accepted decision for
   the exact intent; no invocation during parking; no unapproved action after wake.

**Decision thresholds to agree before building:** cap the first experiment at five engineering days;
require zero duplicate effects, false verification or lost approvals in repeated fault cases, and
100% explicit outcomes (unknown is acceptable, silent success is not). Only proceed beyond the fake
harness if Durable eliminates at least one important failure the cheaper arm cannot, without a
normal-Pi compatibility layer. Subsequent separately authorized matched real-task trials should
show at least 50% lower median human recovery time, no review-quality regression, and at most 25%
extra model cost against the baseline. These are proposed stop/go targets, **not measured results**;
if cheaper job persistence solves the observed pain, choose it.

## Costs and unresolved questions

- Two runtimes mean two storage/lifecycle/upgrade/debug paths. Recent schema, hook, Chord and watch
  changes make maintenance cost concrete. Backups, forward migration and blocked-task recovery need
  an owner; a semver range is insufficient for long-lived checkpoints.
- Retry spend may rise; crashed requests can be billed without complete local usage. `maxTurns` is
  not a workflow-wide budget: yield continuations reset the turn count and fix follow-ups begin new
  runs. Persist total attempts/rounds/time/spend ceilings across all children and restarts. [S2, S6]
- How often do real Piano users lose useful work to backend/process death rather than merely need
  better result visibility? No frequency or recovery-cost measurement exists in this investigation.
- Can the job-record approach meet attribution needs without a new upstream normal-RPC receipt
  contract? Durable does not solve a transaction spanning its store and normal RPC.
- Is there a supported upstream host successor with normal resource/extension/dialog/history
  compatibility? Current p2 explicitly is not that commitment. Avoid recreating normal Pi's loader
  in Piano to close the gap (INV-12).

The existing [ADR](../adr/0001-pi-rpc-workspace-workbench.md) and
[roadmap §5](../roadmap.md#5-independent-review-and-bounded-orchestration) remain appropriate:
prove review value, then bounded recovery, then consider an adoption ADR. This research changes
neither runtime ownership nor managed-preview lifetime.

## Sources and verification

All upstream source links below pin the inspected commits. Local Piano links describe the revision
in the provenance table, not a promise that current behavior satisfies every target invariant.

- **S1 — Published runtime contract:** [v1.5.2 Durable README](https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/durable/README.md).
- **S2 — Published changes/recovery/migrations:** [v1.5.2 changelog](https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/durable/CHANGELOG.md).
- **S3 — npm metadata/artifacts:** [Durable 1.5.2 metadata](https://registry.npmjs.org/@earendil-works/pi-durable/1.5.2), [tarball](https://registry.npmjs.org/@earendil-works/pi-durable/-/pi-durable-1.5.2.tgz); [Coding Agent metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent/1.5.2), [tarball](https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.5.2.tgz).
- **S4 — Removed host:** [deletion commit](https://github.com/earendil-works/pi/commit/7472cda0d6e51dfbf53c03f46b47aa42ac64bf64).
- **S5 — Unreleased suspendable work:** [commit](https://github.com/earendil-works/pi/commit/473515f9c297c75cf2c3ebb3ba027049ed836d27), [main changelog](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/CHANGELOG.md).
- **S6 — Current core API/examples:** [main README](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/README.md), [generation implementation](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/src/harness/generation.ts).
- **S7 — Submission identity:** [admission](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/src/harness/submissions.ts#L217-L238), [different-payload test](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/test/harness-submissions.test.ts#L83-L105).
- **S8 — Tool recovery:** [stored/current replay check](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/src/harness/tool.ts#L234-L256), [built-in tools](https://github.com/earendil-works/pi/tree/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/src/tools).
- **S9 — p2 warning/distribution:** [README](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/README.md), [private package](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/package.json).
- **S10 — p2 architecture/integrations:** [notes](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/docs/p2-notes.md), [worker](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/src/runtime/worker.ts), [MCP tool replay policy](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/plugins/mcp/tools.ts#L142-L163).
- **S11 — Resource/plugin differences:** [prompt resources](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/plugins/prompt/context-files.ts), [plugin-loading design status](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/docs/plugin-loading.md).
- **S12 — Unbuilt host waits:** [waiting-work design](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/docs/waiting.md).
- **S13 — Subagent/reporting implementation:** [tools](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/plugins/subagents/tools.ts), [one-shot workflows](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/apps/p2/docs/workflows.md).
- **S14 — Upstream failure-contract tests (not run):** [signals](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/test/harness-signals.test.ts), [tool parks](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/test/harness-tool-parks.test.ts), [gates](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/test/harness-tool-gates.test.ts), [hook tasks](https://github.com/earendil-works/pi/blob/6e11a00a01a568ef0ae0df5074acf02fc107c34b/packages/durable/test/harness-hook-tasks.test.ts).
- **P1 — Runtime/dependency:** [package](../../package.json), [lockfile](../../package-lock.json), [PiSessions](../../server/PiSessions.ts).
- **P2 — Creation/ownership:** [runtime ownership](../runtime-ownership.md#failed-creation-and-reconnect), [SessionHosts](../../server/SessionHosts.ts), [RegistryDatabase](../../server/RegistryDatabase.ts).
- **P3 — Dispatch attribution/lifetime:** [session dispatch](../session-dispatch.md), [wire handle](../../shared/dispatch.ts).
- **P4 — Policy:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md), [invariants](../development-invariants.md), [roadmap](../roadmap.md), [glossary](../glossary.md).

Documentation-only verification: reviewed claims against the pinned sources and package contents;
checked local links, pinned upstream paths/line anchors and diff whitespace. No application suite or
scratch journey is required for this note; no runtime behavior is claimed as experimentally verified.
