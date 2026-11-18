# Pi Durable: how it works and whether Piano should adopt it

## Recommendation

**Do not replace Piano's production Pi RPC sessions now.** Pi Durable is a promising runtime for
restart-safe agent work, and upstream's experimental client/server host is particularly relevant to
Piano. Track that host rather than building a competing compatibility layer. If interrupted,
long-running review becomes a demonstrated problem, prototype one bounded reviewer workflow first.
Production adoption should follow measured recovery and compatibility evidence and a new ADR.

This is an updated assessment, not an implementation or a change to the accepted architecture.
Piano does **not** currently adopt Pi Durable: it pins Coding Agent 1.1.0 and starts normal
`pi --mode rpc` children. Its roadmap explicitly defers Durable to a bounded orchestration prototype.
[P1, P2, P3]

## Scope and provenance

- Research date: 2026-10-11.
- Piano inspected at `99c54bdae86fd18d53c9e83461770c3f5bf03b6c`.
- Upstream source inspected at `ea448f454af474f3e2fe9733b331e17b0662f5d6`
  (`v1.1.0-22-gea448f45`, latest commit dated October 10).
- `npm view @earendil-works/pi-durable version` returned `1.1.0`.
- **Source-main capabilities below are not all in the published 1.1.0 package.** The post-tag log
  includes nested tool calls, structured output, storage-failure handling changes, image reading,
  and scheduler improvements. The experimental coding host and service slices already exist in
  the v1.1.0 source tree, but the service documentation says the experimental server/client and
  package subpaths are excluded from npm packages and standalone binaries. [S1, S4, S5]
- Method: first-party source/document inspection, web discovery, npm metadata, and local Piano
  implementation/architecture inspection. No model calls, crash experiments, benchmarks, or
  application changes. Recovery statements below describe upstream contracts, not tests performed
  against Piano. No background research-agent tool was available; investigation was performed directly.

## 1. What Durable actually is

Durable is an **agent execution runtime**, not an option to make the existing Coding Agent's JSONL
session history more persistent. It is built on Pi AI for model access and Chord for state.
Its central rule is that observable agent state comes from committed storage. [S1]

```text
application submits input (optionally with stable requestId)
  → atomic admission: transcript/inbox/submission state
  → checkpointed generation task
      → model request, persisted streaming progress
      → checkpointed tool tasks, intent persisted before execution
      → persisted results and next generation
  → completed submission

storage → committed conversation view → local UI or host-provided transport
restart → open storage + install definitions + resume scheduler
```

The important pieces are:

| Piece | Responsibility |
| --- | --- |
| Harness | Owns one open storage and the task scheduler. |
| Conversation | Transcript and per-conversation model/tools/instructions/cwd. Multiple conversations can share a Harness. |
| Atomic commit | Appends immutable entries, updates typed documents, and changes tasks together. |
| Documents | Persist live progress, queue, agent configuration, usage and application-defined JSON state. |
| Tasks | Explicit checkpointed state machines, with ownership, waits, cancellation and terminal outcomes. |
| Submission | Durable input identity and outcome; a repeated `requestId` finds the existing submission. |
| Watch/view | Committed transcript and live state; late join starts from the current view. |

These are Durable's names. Its extension **registry** is an in-memory collection of code definitions,
not Piano's SQLite registry. A Durable storage Session can contain multiple conversations; it is not
a one-to-one synonym for a Piano session. Keep these distinctions inside any adapter. [S1, P4]

### Recovery is checkpoint-based, not magical continuation

- Reopen storage, reinstall the required extensions/task definitions, and start scheduling with
  `resume()` (submit/wait also starts scheduling). Pending work can continue from checkpoints.
- A recovered model request can be **resent**, not resumed at the exact lost token. The spec converts
  a committed leftover partial into an aborted assistant entry and resends the committed request
  context with pinned model/thinking/options. Expect possible additional spend and a different answer.
- Tool intent is committed before execution. An interrupted call reruns only if **both its stored
  intent and its current tool definition** declare `replay: "safe"`. The default is unsafe.
  Otherwise it produces an interrupted error result containing committed partial output.
- This is **not exactly-once external execution**. A command may have changed the world just before
  the process died and before recording success. Durable cannot atomically commit a Git push,
  deployment, PR creation or payment together with its local database. Such operations need their
  own idempotency and reconciliation. Even after an interrupted result, a model could decide to
  issue a new call: preventing unsafe semantic retries is also host/tool policy.
- Built-in file/shell tools do not declare safe replay in the inspected source. Do not interpret
  automatic run recovery as permission to rerun arbitrary `bash` commands. [S1, S2, S3]

### State synchronization and storage

`viewState()` exposes committed transcript plus live documents. `watch()` exposes that view and its
commit operations. At more than 100 undelivered frames it replaces the backlog with a current full
view; reconnect begins with current state rather than historical event replay. The default progress
commit interval is 100 ms, a batching trade-off rather than token-by-token disk writes. Transport,
authorization and browser integration remain host responsibilities. [S1]

SQLite uses WAL and `synchronous=NORMAL`: process-crash durability is not a promise that the latest
commit survives power/host failure. JSONL has an optional fsync policy; memory storage is not durable.
Current main also documents a Cloudflare Durable Object SQLite adapter. Core storage has **one owner
and no cross-process locking**; hosts must enforce ownership. Upstream's experimental hosts add
locks around session directories. This is not by itself a distributed multi-writer scheduler,
backup system, or execution sandbox. [S1, S4, S5]

## 2. Important changes since Piano's October 2 research

The earlier [harness research](2026-10-02-harness-direction.md) correctly described the inspected
1.0.0 library, but its broad compatibility conclusions need qualification now:

1. **An experimental Durable coding host now reuses Pi setup.** Its model runtime, auth, settings,
   system-prompt construction, AGENTS.md/context files and skills are reused from Coding Agent.
   Its source README explicitly excludes normal extensions, prompt templates, images, `/login`,
   a session picker and tree/fork navigation from that local host. Credentials are shared by logging
   in through normal Pi. This is meaningful progress, not complete environment compatibility. [S4]
2. **There is an experimental client/server path, not only an embedded library.** A per-session worker
   owns Durable SQLite storage; `AgentController` exposes prompting, steering, follow-ups, abort,
   compaction and waits. `Transcript` publishes the conversation view. Chord handles hydration,
   sequencing and gap detection. These are experimental services, **not normal Pi JSONL RPC**. [S5]
3. **Core tools have advanced.** Current main supports image reads and nested tool calls with separate
   tasks, structured results and replay behavior. This does not imply that the experimental coding
   host supplies full image UX, normal MCP loading, codemode or existing extension compatibility.
   Its coding registry installs CodingTools and the Pi prompt, not the normal extension ecosystem.
   Those integrations remain things to prove, not assume. [S1, S4]
4. The experimental service host still lists missing tree navigation, next-run queues, subagent
   service exposure and older transcript paging. Its active conversation view is not a complete
   history API: entries before the latest reset/compaction need separate paging. [S5]

Thus, “Durable cannot reuse Pi configuration” is now too strong. The more accurate statement is:
**upstream is building that integration, but it is source-only, experimental, and incomplete.**

## 3. What Piano has today, and what would improve

Piano's `PiSessions` spawns a normal RPC child, loads authoritative state/history, correlates requests,
tracks child exit, and projects Pi records into browser state. `PiRecords` contains that projection.
Request timeout is explicitly treated as uncertain delivery, with instructions not to resend.
Piano's registry is not the transcript owner. [P1, P2, P4]

| Concern | Current Piano | Potential Durable benefit |
| --- | --- | --- |
| Browser refresh/disconnect | Server owns the Pi child; browser reconnect must not resubmit work. | Not the main reason to migrate; Piano already targets this contract. |
| Worker/backend process dies | History can reopen, but that is not continuation of interrupted execution. | Persisted queue, task checkpoints, partial output and automatic run recovery. |
| Submission acknowledgement is lost | Delivery may be uncertain; do not automatically resend. | Stable persisted request IDs enable deduplicated retry, if carried end-to-end. |
| Live UI state | Piano projects RPC events and reconciles snapshots. | Runtime-owned committed view could remove some reconstruction logic. |
| Parallel/subagent orchestration | Requires lifecycle coordination beyond chat history. | Task ownership, wait graphs, cancellation and background tasks are first-class. |
| Workspace/evidence/integration | Piano-specific policy and Git/Worktrunk boundaries. | No substitute: Durable persists execution, not verification truth or approval validity. |

The largest gains are **crash recovery and structured orchestration**, followed by a cleaner
source of live state. We have no measurements showing lower latency, lower cost, or less total
Piano code after a migration. Persistence adds work; a storage-owner failure can affect every
conversation it hosts. Keeping worker isolation remains useful. [S1, S5, P2, P4]

## 4. Adoption options

### A. Keep ordinary Pi RPC — recommended production choice

Preserves today's configured environment, existing session files and browser behavior. Continue
improving daily use rather than maintaining two production runtimes speculatively. This matches the
current roadmap, which defers deeper orchestration while prioritizing daily UX. [P3]

### B. One bounded Durable workflow beside RPC — conditional prototype

A restart-safe reviewer is a good test because it can inspect an immutable candidate with read-only
capabilities and return a bounded report. Upstream already includes a reviewer example. [S6]

Proposed boundaries, not current implementation:

- Keep user coding sessions on normal RPC. Do not migrate existing Pi session history.
- Give the prototype a separately supervised worker and scratch-local Durable storage, outside the
  Piano registry. Establish one storage owner and coordinate worker retirement with live tasks.
- Bind each review to a captured workspace revision, requirement version and environment. Preserve
  the reviewed snapshot across restart. Persist references/results through the evidence boundary;
  do not let the Durable transcript become a second authoritative evidence database.
- Persist submission IDs and task state; only give replay-safe tools capabilities whose repeated
  execution is genuinely safe. Bound turns, time and spend across restarts.
- Expose review outcomes through Piano domain types, not Durable task internals throughout React.
- Reviewer approval remains evidence, never an automatic “verified” or “merge approved” decision.

This touches INV-01/02/05/07–12. Adopting production orchestration requires the roadmap's new ADR;
a research prototype does not authorize changing session semantics. [P3, P4]

### C. Replace the main session runtime — defer

The best long-term candidate is **Pi's own experimental worker/services architecture**, once its
compatibility and supported distribution are sufficient, rather than Piano recreating Pi on the
raw Durable library. It aligns with per-session ownership and would let Piano consume authoritative
views instead of expanding its own event reconstruction. This is an architectural recommendation,
not an upstream stability promise. [S5, P2]

A replacement would need a new adapter behind `PiSessions`, action/event mapping, a deliberate
history/session-reference migration or coexistence policy, and tested configuration parity. It is
not an npm dependency swap or a `--durable` flag. Old normal JSONL sessions and Durable storage are
different formats; no migration route was demonstrated in this research. A raw in-process embedding
would also change Piano's current process failure boundary. [S1, S4, S5, P1, P2]

## 5. What would make adoption worth it?

Run a bounded prototype only when there is a real repeated workflow whose lost work/recovery effort
justifies it. Compare it with an ordinary separate Pi reviewer or a small persisted job record—not
just with the worst case of losing all orchestration state.

Required acceptance checks:

1. Kill the worker after admission but before acknowledgement; resubmit the same request ID and
   observe one logical submission.
2. Kill during model streaming, queueing and a read-only review; reopen, retain committed progress,
   and reach an explicit final outcome against the same candidate.
3. Simulate a side effect succeeding before its receipt commits. Reconcile it; never blindly repeat
   deployment, merge, push, PR creation or cleanup. Distinguish model-request retry from tool replay.
4. Attach two clients; disconnect and slow one; final views agree and tasks are not duplicated.
5. Attempt a second storage owner and inject storage failure. Ownership and failed/reopened states
   must be unambiguous; one worker's failure must have the intended scope.
6. Before any session-runtime replacement, verify models/auth, settings, AGENTS.md, skills, installed
   extensions, MCP/project overrides, codemode, image flow, dialogs, queues, compaction, full history,
   fork/tree semantics and supported CLI overrides. Presence in upstream source is not acceptance.
7. Measure recovered useful work, human recovery time, duplicate effects, review quality, token
   spend and storage/latency overhead against the baseline. Include maintenance/API churn cost.

**Decision rule:** adopt when restart recovery or task orchestration provides observed value that
outweighs compatibility and operating two runtimes. For today's daily-use Piano priorities, it is
**worth tracking and selectively prototyping, but not worth a production migration yet**. [P3, P4]

## Sources

Upstream links are pinned to the inspected revision, not moving `main`:

- **S1 — Durable README/API/storage/watch/recovery:**
  https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/durable/README.md
- **S2 — Tool recovery implementation (stored/current replay policy):**
  https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/durable/src/harness/tool.ts#L163-L185
- **S3 — Normative spec (generation recovery), and built-in tools:**
  https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/durable/docs/spec.md#L3763-L3776
  and https://github.com/earendil-works/pi/tree/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/durable/src/tools
- **S4 — Experimental local coding host and configuration bridge:**
  https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/coding-agent/src/experimental/durable/README.md
  and adjacent `prompt.ts`, `harness-setup.ts`, `sessions.ts`.
- **S5 — Experimental worker/services, packaging limits and outstanding gaps:**
  https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/coding-agent/src/experimental/services/README.md
  and https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/coding-agent/src/experimental/session-worker.ts
- **S6 — Reviewer example:**
  https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/durable/test/examples/28-reviewer.ts
- **P1 — Current dependency and runtime:** [package.json](../../package.json),
  [package-lock.json](../../package-lock.json), [PiSessions](../../server/PiSessions.ts),
  [PiRecords](../../server/PiRecords.ts), at the Piano revision above.
- **P2 — Architecture:** [ADR 0001](../adr/0001-pi-rpc-workspace-workbench.md).
- **P3 — Priorities and adoption gate:** [roadmap](../roadmap.md), especially “Current priority” and §5.
- **P4 — Ownership, recovery, evidence and compatibility:** [development invariants](../development-invariants.md).

## Verification of this note

Documentation-only change. Reviewed source pinning, version distinctions, relative links, current
Piano runtime selection, and the distinction between promised and observed recovery. No application
test suite/browser journey is needed for this note; no runtime adoption, upgrade, or deployment occurred.
