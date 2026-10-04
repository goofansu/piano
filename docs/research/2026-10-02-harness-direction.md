# Direction for the piano harness after Pi 1.0

> Historical research, verified against Pi 1.0.0 on 2026-10-02. The
> [ADR](../adr/0001-pi-rpc-workspace-workbench.md), [development invariants](../development-invariants.md)
> and [roadmap](../roadmap.md) supersede this note's phase ordering and registry-based evidence proposal.
> Its original audit and source findings are retained; they are not a Pi 1.0.2 compatibility test.

Research note, 2026-10-02. Question: given Pi 1.0.0 (released 2026-10-01) and Pi Durable, what runtime
and workspace foundations should piano build on, and what should the product optimise for? A long
recommendation written by another model was pasted into the session the same day; this note checks its
claims against primary sources and goes further where piano's code is concerned.

Sources are primary only: the pi monorepo at tag `v1.0.0` (checkout
`~/.cache/checkouts/github.com/earendil-works/pi`), pi.dev docs (which mirror the repo docs), the
worktrunk reference docs and source (`~/.cache/checkouts/github.com/max-sixty/worktrunk`), the Herdr
v0.9.3 docs, the two reference web harnesses (`milanglacier/pi-tau-web-server` v1.1.2 and
`Epsilondelta-ai/pi-web` v1.21.4, both cached under `~/.cache/checkouts`), and the Anthropic engineering
posts. Appendix A holds the pi findings and Appendix B the workspace and reference-harness findings; every
bullet there ends with a file+line or URL+quote citation. The direction below cites those appendices.

What was verified against the running system today: piano with `@earendil-works/pi-coding-agent@1.0.0`
installed, started on a scratch registry at port 7171, registered a scratch git repo, ran one turn
("Reply with exactly: PI100") through the browser and read back "Pi said: PI100", reloaded the page and
saw the same history load from the session file. `npm test` 5/5 and `npm run typecheck` pass. The probe
returned 37 models. Screenshot kept in the session scratchpad as `pi-1.0.0-roundtrip.png`.

## 1. Direction in one paragraph

Keep one long-lived `pi --mode rpc` child per session behind `server/PiSessions.ts`; the 1.0.0 wire
protocol is compatible with what piano already does, the SDK is not documented for a long-lived
multi-session host, and Pi Durable is a different product that does not read the user's pi setup (§2).
Keep Worktrunk as the only workspace layer and stop duplicating it: read the state it already returns,
drive its activity markers from piano's own session host, and add remove and merge as first-class actions
with their documented contracts (§3). Treat Herdr as a sibling to borrow discipline from, not a
dependency (§4). Then make the product about evidence rather than chat: a session's status, the
worktree's state, checks, and browser observations shown against a specific revision, with a separate
skeptical reviewer only once the foundation is trustworthy (§5). The order of work in §6 follows from
this; the first phase is a short list of correctness fixes the research exposed in the current code.

## 2. Runtime: stay on RPC, with specific fixes

**1.0.0 is wire-compatible with piano's 0.87.1 integration.** `git diff v0.87.1 v1.0.0 -- src/modes/rpc`
touches three files and the only substantive change is `data.disposition` on `prompt`/`steer`/`follow_up`
responses (`"handled" | "queued" | "started"`). No command or event was added, removed or renamed
(Appendix A §A.1). `agent_settled` and stdin-close shutdown, which the pasted recommendation presents as
things to adopt, have existed since 0.80.4 and piano already keys on both (§A.2, §A.3;
`server/PiSessions.ts:190-198, 301`). The session file format is unchanged at version 3; the one
behaviour change is that the file now exists after the first user message rather than the first assistant
reply (§A.4). The dependency bump to `^1.0.0` is in the working tree and verified above.

**Do not swap `PiSessions` for the exported `RpcClient`.** It exists and is the documented advice, but it
spawns with `node`, pipes the child's stderr into the parent's stderr, sleeps a fixed 100 ms on start, and
stops with SIGTERM then SIGKILL without closing stdin (§A.5). Piano's Effect-native child already does
request correlation, stdin-close shutdown and a bounded kill. Import `RpcCommand`, `RpcResponse` and
`JsonAgentSessionEvent` from the package for typing instead.

**Do not move to the SDK.** The docs describe the SDK as in-process and RPC as isolated child processes
(§D); there is no statement that hosting many `AgentSession`s in one long-lived process is supported, an
extension crash or `process.exit` would take piano down, and piano would have to assemble codemode, tool
search and MCP itself (§D). Isolation is the point of the child-process seam, and the README already says
so.

**Pi Durable is not piano's session substrate.** `@earendil-works/pi-durable@1.0.0` depends only on
`pi-ai` and `chord`. It has its own extension model, builds the system prompt from extension sections
only, reads raw provider API keys rather than `/login` credentials, and knows nothing about pi's
extensions, skills, AGENTS.md, prompt templates, `mcp.json`, codemode, or `~/.pi/agent/sessions`. It is
in-process only, one process per storage with no cross-process locking, its `read` tool cannot return
images, and its README says the API changes without notice (§C). Building piano on it would make piano a
different agent from the user's `pi`. Where it fits is a later orchestration layer beside the pi children:
a restart-safe reviewer conversation per worktree (`packages/durable/test/examples/28-reviewer.ts`) or
background subagents (`23-subagent-background.ts`), with a SQLite file owned by the piano server and
browsers fed by `watchEvents()` snapshots over the existing WebSocket (§C). Gate that on a one-workflow
prototype with a kill-and-restart test, and on the "experimental" banner coming off.

**Fixes the research exposed in the current code** (all in `server/PiSessions.ts` unless noted):

- `act.prompt` discards the response payload, so `disposition: "handled"` (an extension consumed the
  input and no run will start) is invisible; the UI would wait for an `agent_start` that never comes.
  Read `data.disposition` and surface `"handled"` as a notice (§A.1, §Implications in Appendix A).
- `abort` sends the abort command and leaves retained dialogs in `dialogsRef`. Pi's RPC abort does not
  resolve pending UI requests; pi-tau-web-server hung on exactly this when an extension awaited
  `ctx.ui.confirm` with no timeout (Appendix B, pi-tau-web-server). Abort should cancel every retained
  dialog immediately, before any ack, and carry an operation revision so a late ack cannot clear
  `isStreaming` for a newer turn.
- `act.answer` checks `dialogsRef` and then writes, without claiming the dialog first; two browsers can
  both deliver an `extension_ui_response`. Claim synchronously before the write (pi-tau-web-server does
  this), then resolve.
- Dialog `timeout` is auto-resolved on the pi side and is not on the wire `Dialog`, so a timed-out dialog
  stays retained and the client shows no deadline. Add `timeout` to `shared/wire.ts` and drop the dialog
  when a later request or answer arrives for a timed-out id (§B).
- The `DIALOG_METHODS` filter drops `setStatus` and `setWidget`, and `tool_execution_update`,
  `queue_update`, `compaction_end`, `auto_retry_end` are not surfaced; `get_state` also returns
  `isCompacting` and `pendingMessageCount` which `toState` ignores (§A.10, §B). These are the cheapest
  wins for a web UI: live bash output, queued follow-ups, compaction and retry outcomes.
- `server/SessionFiles.ts` `peekSession` takes the model from the latest assistant message, which shows
  a virtual model's physical route instead of the selected model; prefer the last `model_change` entry
  (§A.8).
- `server/PiRecords.ts` does not handle `text_end` (authoritative replacement for reconstructed text),
  `thinking_delta`, `message_update.usage`, or `parentToolCallId` for nested codemode and MCP calls
  (§A.9, §A.10).

## 3. Workspace: Worktrunk is the layer, and piano under-uses it

**Piano parses `wt list` schema 2 without asserting it.** `server/Worktrees.ts` reads `items[].branch`
and `items[].worktree.{path,main}`; a user with `[list] json-schema = 1` gets a bare array, `items` is
undefined, and the fallback silently reports the project root as the only worktree (Appendix B,
Worktrunk). Assert `schema === 2`, pass `--no-progressive` since piano is not a TTY, and map `branch:
null` to a detached flag instead of `""`.

**The sidebar discards state the same call already returns.** Without `--full`, `wt list` is local-only
and returns `worktree.changes` (dirty, conflicted, diff counts), `worktree.operation` (an open rebase or
merge), `worktree.prunable`, `default_branch.{ahead,behind,integration,merge_conflicts}`, the collapsed
`display.state` (nine values from `is_main` to `would_conflict`), and `marker`. `WorktreeView` in
`shared/wire.ts` carries branch, path and main only. Extend it, and keep the documented distinction
between absent (nothing to report) and `null` (requested but undetermined), rendering the latter as the
table's `·` rather than as green (Appendix B, Worktrunk).

**`server/PullRequests.ts` reinvents `wt list --full` with a different vocabulary.** It shells out to
`gh pr view` per URL and folds checks into `none|pending|success|failure` and review into
`none|approved|changes_requested|review_required`. Worktrunk returns `checks.status`
(`passed|running|failed`, plus `stale`) and `pr.review` (`changes_requested|pending|draft|approved`), with
fetch errors, no-CI and conflicts encoded by shape, cached 30 to 60 seconds, and forge-agnostic. For a
worktree's own branch use `wt -C <project> list --full --format=json` and keep `gh` only for PR URLs
mentioned in transcripts; either way align the wire literals on worktrunk's names so one renderer serves
both.

**Drive activity markers from `SessionHosts`, not the pi plugin.** The plugin is a 43-line extension that
sets a git-config marker per branch on `agent_start` (🤖), `agent_settled` (💬) and `session_shutdown`
(clear). Piano's children are retired on idle and killed on shutdown, so a kill before
`session_shutdown` leaves a stale 🤖. `SessionHosts` already sees the state transitions; run the three
`wt config state marker` commands from there and clear on release. This is the documented plugin-free
path, and it keeps one writer per branch (Appendix B, Worktrunk).

**`createWorktree` should read the JSON it already asks for.** `wt switch --format=json` returns
`{action: created|existing|already_at, branch, path, created_branch, base_branch, from_remote}`; piano
reads `path` and `branch` and regex-matches "already exists" to retry. Use `action` and record
`base_branch` in the registry. Piano also passes `-y`, which bypasses worktrunk's hook approval gate
(`~/.config/worktrunk/approvals.toml`); when the user ticks hooks, drop `-y`, surface the exact "Cannot
prompt for approval in non-interactive environment" error, and point at `wt config approvals add`.

**Remove and merge have precise contracts and are missing.** Removal runs in the background by default
and reports `branch_outcome: deferred`; a server must pass `--foreground` to learn
`deleted|retained_unmerged|retained_*`, and must release the session host first because the pi child's
cwd is the worktree. `wt merge` runs commit, squash, rebase, pre-merge hooks (after rebase, blocking),
fast-forward merge, pre-remove, cleanup, then post hooks in the background; it never fetches; a conflict
leaves the rebase open, which the next `wt list` reports as `worktree.operation: "rebase"`, so the sidebar
state above doubles as the conflict indicator. Because pre-merge hooks run after the rebase, an approval
of the pre-rebase revision cannot authorise the post-rebase result; bind approvals to a commit (Appendix
B, Worktrunk).

## 4. Herdr: sibling, not dependency

Herdr's worktree methods call `git worktree` directly and never delete the branch, so they do not compose
with worktrunk's naming, hooks or removal. Its Pi integration is TUI-only by design (RPC reports
`hasUI: true`, so the extension gates on `ctx.mode`). Across detach, processes keep running; across a
server restart they do not, and only layout plus native agent resume (`pi --session <path>`) come back
(Appendix B, Herdr). Three things are worth copying into piano: a monotonically increasing `seq` on state
reports so a late report cannot overwrite newer state, latest-wins coalescing while a send is in flight,
and prompt-with-embedded-wait to close the race pi documents as "subscribe before sending a prompt".

## 5. Product: evidence, bound to a revision

The harness write-ups agree on a few things that piano can act on directly (Appendix B, Harness
evidence):

- Self-review does not work; a separate evaluator tuned to be skeptical does. Anthropic removed its sprint
  construct and moved the evaluator to a single end-of-run pass when the generator model improved. Add
  review as a separate fresh-context child with read-only tools and a separate checkout, bounded by rounds
  and cost, and only after §6 phase 1.
- Durable progress must live outside the model's context: a JSON feature list (JSON because models
  overwrite Markdown less readily), a progress file, an append-only session log. For piano, the registry
  is the right owner of small per-session facts: last `agent_settled`, last tool-error count, last check
  outcome and the revision it was taken at.
- "Done" means observed end-to-end in the running app, which AGENTS.md already demands of agents working
  on piano. Make it the UI's definition too: a session's status should distinguish running, waiting for
  input, settled, failed and integrated from facts piano can observe (`agent_settled`, retained dialogs,
  child exit code, worktrunk `integration`), never from the assistant's final text.
- Evaluate with pass^k, not pass@k, and read transcripts. When piano records a check or a browser run,
  store the command, exit code, revision and artifact, so repeated trials can be compared.

Everything shown as evidence should name the commit it was taken at. `wt list` already gives `head`,
`changes.diff` and `default_branch.ahead/behind` per worktree, which is enough to invalidate stale
evidence when the tree moves.

## 6. Order of work

Phase 0, correctness in the current seam (small, do first):

1. Read `disposition` in `act.prompt`; notice on `"handled"`.
2. Abort cancels retained dialogs immediately; add an operation revision; claim-before-write in `answer`;
   `timeout` on the wire `Dialog`.
3. Assert `schema === 2` and pass `--no-progressive` in `Worktrees.ts`; use `action` and `base_branch`
   from `wt switch`; drop `-y` when hooks are enabled.
4. Surface `setStatus`, `setWidget`, `tool_execution_update`, `queue_update`, `compaction_end`,
   `auto_retry_end`; add `isCompacting` and `pendingMessageCount` to `SessionState`.
5. Commit the `^1.0.0` bump and note in AGENTS.md that the RPC contract piano depends on is
   `docs/rpc.md`, `rpc-commands.md`, `json.md`, `rpc-extension-ui.md` at v1.0.0.

Phase 1, the web UI earns its place over the TUI:

6. Worktree state in the sidebar from the existing `wt list` call; align PR vocabulary on worktrunk's;
   markers driven from `SessionHosts`.
7. Remove and merge actions with `--foreground` and `-C` semantics, run off the WebSocket handler's
   critical path with output streamed as notices.
8. Per-session sequence numbers on `SessionEvent` so a reconnecting client detects a gap and asks for a
   snapshot instead of always paying for one; `get_entries{since}` as the catch-up cursor.
9. `steer` as distinct from `follow_up`, `clear_queue`, `compact`, `set_session_name`, `fork`,
   `get_commands` for a slash palette; `text_end`, usage and nested tool grouping in `PiRecords`.
10. A redaction pass on tool output before it reaches the browser (pi-web does this at its broker).

Phase 2, evidence:

11. Revision-bound diff and checks per worktree; test and browser runs recorded as actions with command,
    exit code, revision and artifact stored in the registry.
12. Observed session status (running, waiting, settled, failed, integrated) derived from facts, shown in
    the sidebar.

Phase 3, review and orchestration:

13. A reviewer as a separate pi child with read-only tools on a separate checkout, bounded rounds.
14. A Durable prototype for exactly that reviewer, with a kill-and-restart test; adopt only if it passes
    and the package is no longer marked experimental.

Exit criterion for phases 0 and 1, borrowed from the pasted recommendation and worth keeping: browser
refresh, two tabs, a child exit, and an interrupted command each produce correct and explained state,
without resubmitting a prompt.

## 7. The pasted recommendation, claim by claim

Every pi-related claim was verified against the v1.0.0 checkout; the full table is in Appendix A §E.
Nothing was refuted. Two nuances it elides: `agent_settled` and stdin-close shutdown are not 1.0.0
changes, and the only RPC wire change since 0.87.1 is `disposition`. Its "approximately 40%" codemode
figure is 5,300 to 3,300 tokens for one configuration (default tools plus codemode, GPT-5.6). Its "Pi
deliberately avoids plan mode, subagents and permission popups" comes from the pi.dev home page, not
the repo docs.

Workspace and harness claims:

| Claim | Verdict | Where |
|---|---|---|
| `wt list --format=json` defaults to a schema-2 envelope that distinguishes unavailable from absent | VERIFIED | Appendix B, Worktrunk |
| `wt merge` runs pre-merge hooks after rebasing, so an earlier approval cannot cover the result | VERIFIED | Appendix B, Worktrunk (`merge.md:62-73`, `hook.md:34`) |
| Worktrunk's pi plugin is activity tracking only; lifecycle is invoked through `wt` commands | VERIFIED | Appendix B, Worktrunk (`claude-code.md:5-14`) |
| Herdr socket API offers workspace/pane ops, agent prompt and wait, state reads, event subscriptions | VERIFIED | Appendix B, Herdr |
| Herdr: detach keeps processes; server restart does not preserve them | VERIFIED | Appendix B, Herdr (`session-state.mdx:10-15`) |
| Anthropic separates session, harness and sandbox so each can be replaced independently | VERIFIED | Appendix B, Harness evidence |
| Anthropic's app-building harness later removed orchestration rather than adding it | VERIFIED (sprint construct removed, evaluator moved to one end pass) | Appendix B, Harness evidence |
| Anthropic's eval guidance recommends roughly 20 to 50 cases | UNVERIFIED | the post was fetched; that number was not in the extract |
| Playwright MCP docs point coding-agent users to CLI-plus-skills as more token-efficient | UNVERIFIED | README fetched; the extract records the accessibility-tree and profile claims, not this one |
| OpenAI's harness-engineering post isolates app instances per worktree | UNVERIFIABLE | the page returned 403 and a Cloudflare challenge to WebFetch, curl and agent-browser |
| pi-tau-web-server is a close reference for piano's architecture | VERIFIED, with the caveats in Appendix B (global fan-out, unbounded transcript, browser-side queue) | Appendix B, pi-tau-web-server |
| pi-web is a native browser workbench with workspaces, sessions, files, git, streaming, plugins | PARTLY: it runs one pi process per prompt, fakes dialogs through a system-prompt JSON fence, binds `0.0.0.0` with no auth, and moved its chat surface to external plugins in June 2026 | Appendix B, pi-web |


## Appendix A. Pi 1.0.0 runtime findings


Checked 2026-10-02 against the pi monorepo at tag `v1.0.0` (checkout
`/Users/james/.cache/checkouts/github.com/earendil-works/pi`, `git checkout v1.0.0`). Paths below are
relative to that checkout; `CA/` = `packages/coding-agent/`, `DU/` = `packages/durable/`. Line numbers are
from the v1.0.0 tree. pi.dev pages mirror the repo docs word for word (checked `/docs/latest/rpc`,
`/docs/latest/sdk`, `/docs/latest/rpc-extension-ui`, `/changelog`, `/changelog/releases/1.0.0`).

Piano state: `git show HEAD:package.json` pins `^0.87.1`; the working tree already says `^1.0.0` and
`node_modules/@earendil-works/pi-coding-agent/package.json` is `1.0.0`. Against that install `npm test`
passes 5/5 and `tsc -p tsconfig.json` exits 0 (observed, not modified).

### A. Changes 0.87.1 → 1.0.0 that matter to an RPC supervisor

Release train after 0.87.1 (2026-09-22): 0.99.0 (09-29), 0.99.1 (09-29), 0.99.2 (09-30), 1.0.0 (10-01).
`CA/CHANGELOG.md` L3, L49, L89, L107, L186; pi.dev/changelog lists the same dates.

#### A.1 Wire-level diff of the RPC surface

- `git diff v0.87.1 v1.0.0 -- CA/src/modes/rpc` touches only `rpc-types.ts`, `rpc-client.ts`,
  `rpc-mode.ts`, and the single substantive change is **disposition data on `prompt`/`steer`/`follow_up`
  responses**. No command or event was added, removed or renamed. `CA/src/modes/rpc/rpc-types.ts`
  L116-126 (diff hunk); `CA/CHANGELOG.md` L129 (0.99.0: "Added per-input disposition to successful RPC
  `prompt`, `steer`, and `follow_up` responses ... `RpcClient.prompt()` also accepts `streamingBehavior`").
- Disposition values: `QueuedInputDisposition = "handled" | "queued"`, `PromptDisposition =
  QueuedInputDisposition | "started"`. `CA/src/core/agent-session.ts` L294-295. Meaning: `"handled"` = an
  extension command or input handler consumed it and **no run started, so don't wait for `agent_settled`**;
  `"queued"` = queued during a run; `"started"` = a run was accepted. `CA/docs/rpc.md` L60-67;
  `CA/docs/rpc-commands.md` L35-42, L61-66, L86-90.
- Prompt response is emitted from `preflightResult` before the run finishes (`CA/src/modes/rpc/rpc-mode.ts`
  L400-406 in the diff): `success: true` covers acceptance only; provider failures after acceptance arrive
  in the event stream, never as a second response. `CA/docs/rpc-commands.md` L42.
- `RpcSessionState` (`get_state` data) unchanged: `model?`, `thinkingLevel`, `isStreaming`, `isCompacting`,
  `steeringMode`, `followUpMode`, `sessionFile?`, `sessionId`, `sessionName?`, `autoCompactionEnabled`,
  `messageCount`, `pendingMessageCount`. `CA/src/modes/rpc/rpc-types.ts` L96-109.
- `RpcClient` fix: listeners that unsubscribe during dispatch no longer cause the next listener to miss the
  event. `CA/CHANGELOG.md` L159; `CA/src/modes/rpc/rpc-client.ts` L535-539.

#### A.2 `agent_settled` vs `agent_end` — not new

- `agent_settled` was added in **0.80.4** ("Added extension and RPC `agent_settled` events plus
  session-level idle waiting", `CA/CHANGELOG.md` L1147, L1163) and the 0.87.1 docs already said to wait
  for it (`git show v0.87.1:CA/docs/json.md` L45-56). 1.0.0 wording: "`agent_end` closes one low-level
  agent run. Automatic retry, overflow recovery, compaction retry, steering, or follow-up work can still
  continue. `agent_settled` means Pi has no remaining automatic work." `CA/docs/json.md` L48, L55-56.
- Extension shutdown requests complete "after the current command or after the active run emits
  `agent_settled`". `CA/docs/rpc.md` L95.

#### A.3 stdin close = orderly shutdown (unchanged, confirmed in code)

- "Close the child's stdin to request an orderly shutdown. Pi disposes the active runtime before exiting."
  `CA/docs/rpc.md` L93. Implementation: `process.stdin.on("end", onInputEnd)` → `shutdown()` →
  `runtimeHost.dispose()`, flush stdout, `process.exit`. `CA/src/modes/rpc/rpc-mode.ts` L726-741,
  L802-805. Same text existed at v0.87.1 (`git show v0.87.1:CA/docs/rpc.md` L91).
- Framing contract: strict JSONL, split only on LF, strip optional CR, do not use Node `readline`
  (splits on U+2028/U+2029), stdout reserved for protocol, honour backpressure. `CA/docs/rpc.md` L52-56;
  `CA/docs/json.md` L15-19.

#### A.4 Session file format and directory layout

- Location unchanged: `~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl`; `--session-id`
  supplies the id; `/`, `\`, `:` in cwd become `-`. `CA/docs/session-format.md` L10-14. Header version
  still 3. L22-30. `git diff v0.87.1 v1.0.0 -- CA/docs/session-format.md` adds only three sentences
  (thinkingLevel on assistant messages L95; virtual-model note on `model_change` L99; virtual-model state
  custom entry L174).
- **Behaviour change (0.99.0): the session file is created when the first user message is sent, not on
  the first assistant reply.** `CA/CHANGELOG.md` L161 (#10000); `CA/src/core/session-manager.ts`
  L1160-1171 (`_hasConversation()`), L1173-1178. Setup-only sessions (model/thinking entries, no chat)
  still leave no file.
- `SessionManager.list(cwd, sessionDir?, onProgress?, signal?)` signature unchanged.
  `CA/src/core/session-manager.ts` L1900-1911. `getAgentDir`, `SessionManager`, `SettingsManager`,
  `getSessionDir()`, `getEnabledModels()` still exported. `CA/src/index.ts` L8, L298, L315;
  `CA/src/core/settings-manager.ts` L797, L1429.
- 0.87.1 (already in piano's pinned version) made `SessionManager` canonical for provider context and
  added `context_edit` entries (exhaustive switches over `SessionEntry` must handle it).
  `CA/CHANGELOG.md` L221-222 (0.87.1: "Added `ContextEditEntry` to the
  exported `SessionEntry` union").

#### A.5 `RpcClient` export: yes, and what it is

- Exported from the package root: `RpcClient`, `RpcClientOptions`. `CA/src/index.ts` L419-420. Docs:
  "For a subprocess-based TypeScript integration, prefer the exported `RpcClient`, which starts Pi,
  correlates responses, exposes typed command methods, and delivers events to listeners."
  `CA/docs/rpc.md` L5; `CA/docs/cli-integration.md` L72-80.
- Options: `cliPath?` (default `"dist/cli.js"`), `cwd?`, `env?`, `provider?`, `model?`, `args?`.
  `CA/src/modes/rpc/rpc-client.ts` L28-41. `start()` runs `spawn("node", [cliPath, "--mode", "rpc",
  ...])`, **pipes the child's stderr straight to the parent's `process.stderr`**, then sleeps 100 ms and
  checks `exitCode`. L74-143 (stderr forward L104, sleep L133). `stop()` sends SIGTERM and SIGKILL
  after 1 s; it does not close stdin. L145-167. Typed methods for every command (L192-465),
  `onEvent()` L172, `waitForIdle(timeout=60000)` resolves on `agent_settled` L471-489, `collectEvents`
  L491, `promptAndWait` L513 (subscribes before prompting).
- Verdict for piano: the protocol is tiny and piano's Effect-native `Child` in `server/PiSessions.ts`
  already implements the same correlation; `RpcClient`'s stderr forwarding, fixed sleep and
  SIGTERM-first stop make it a poor fit inside a long-lived server. Use `rpc-types.ts` as the type
  reference instead.

#### A.6 Fullscreen-by-default TUI (irrelevant to rpc, confirmed)

- "Changed the default TUI mode to fullscreen. Set `tuiMode` to `"regular"` or pass `--tui-mode
  regular`". `CA/CHANGELOG.md` L6, L24; `CA/src/cli/args.ts` help line diff (`--tui-mode <mode> TUI mode:
  fullscreen (default) or regular`); `CA/docs/cli.md` L221-222. `--mode rpc` is unaffected.

#### A.7 CLI flag changes (diff of `CA/src/cli/args.ts` help text)

- `--provider <name>` now "Provider to search for --model (requires --model)"; `--provider` without
  `--model` is an error (was silently ignored). `CA/CHANGELOG.md` L38 ("Fixed `--provider` without
  `--model` being silently ignored"); `CA/docs/cli.md` L63-64.
- `-e/--extension` accepts `builtin:<name>`; `-ne/--no-extensions` now also disables **built-in**
  extensions (mcp, codemode, tool-search, llama.cpp). `CA/CHANGELOG.md` L150; `CA/docs/cli.md` L184-187.
- New subcommand `pi mcp <add|remove|list|login|logout>`. `CA/docs/cli.md` L16, L304-319.
- No change to `--mode rpc`, `--session-id`, `--model`, `--thinking`, `--name`, `--no-session`,
  `--session-dir` (all present with the same semantics). `CA/docs/cli.md` L43-51, L86-107.
- Spawning: piano runs `node <dist/cli.js> --mode rpc ...`; the published bin is `dist/bundle/cli.js`
  and `dist/cli.js` is what `RpcClient` defaults to. `node_modules/@earendil-works/pi-coding-agent/package.json`
  `bin.pi = dist/bundle/cli.js`; `CA/src/modes/rpc/rpc-client.ts` L81. Either entry works; no change needed.

#### A.8 Model / effort / virtual models

- Thinking levels: `off, minimal, low, medium, high, xhigh, max`; `xhigh`/`max` only when the model
  supports them; `get_available_thinking_levels` returns `["off"]` for non-reasoning models.
  `CA/docs/rpc-commands.md` L282-284, L309-327.
- Virtual models (0.99.0, "experimental"): an extension registers `provider/id` that routes each request
  to a physical model; it appears in `get_available_models`/`set_model` like any model; `model_change`
  records the selection, assistant messages record the physical model that answered.
  `CA/CHANGELOG.md` L122; `CA/docs/virtual-models.md` L3-5, L18-25; `CA/docs/session-format.md` L99.
  Impact: `SessionFiles.peekSession` already takes the model from the latest assistant message, which
  would show the physical model rather than the selected virtual one.
- 1.0.0 fixed "new sessions intermittently ignoring the saved default model" for extension-registered
  providers (0.99.2). `CA/CHANGELOG.md` L74.

#### A.9 Cache warming, transcript-aware prompts, deferred tools, codemode

- Cache warming shipped in **0.86.0** (`cacheWarming: "off"|"streaming"|"idle"`, default `"streaming"`,
  global setting, only when the model declares a cache lifetime and ≥ $0.05 estimated saving; usage is
  recorded as `usage` entries with `kind: "cache_warm"`). `CA/CHANGELOG.md` L274, L298;
  `CA/docs/settings.md` L19-21; `CA/docs/session-format.md` L113-121. Refresh usage enters session cost
  totals, so `get_session_stats.cost` includes it.
- Transcript-aware prompt/tool updates also 0.86.0: system messages persisted in the session with
  `sections` patches and `toolsAdded/toolsRemoved`. `CA/CHANGELOG.md` L276, L288;
  `CA/docs/session-format.md` L80-87. Piano's `serializeMessage` ignores `role: "system"` entries, so
  nothing breaks.
- Codemode / tool search / MCP are built-in extensions since 0.99.0: `codemode` runs model-written JS in
  a QuickJS sandbox; `tool_search` loads `deferred`-exposure tools; MCP from `mcp.json`.
  `CA/CHANGELOG.md` L119; `CA/docs/codemode.md` L1-7; `CA/docs/mcp.md` L174-206. Both tools are off
  unless `defaultTools: ["+codemode"]` or an MCP server needs them. `CA/docs/cli.md` L141-172.
  1.0.0 cut codemode prompt cost ("GPT-5.6 request shrinks from about 5,300 to 3,300 tokens").
  `CA/CHANGELOG.md` L7, L28. 1.0.0 fixed deferred MCP tools being dropped on resume. L43.
- For an RPC client these surface only as tool names in `tool_execution_*` events and larger tool
  results; the `codemode` tool's arguments are raw JS source. `CA/docs/codemode.md` L7.

#### A.10 Exact 1.0.0 RPC vocabulary (what a web client needs)

Commands (`CA/src/modes/rpc/rpc-types.ts` L20-74; docs `CA/docs/rpc-commands.md`):
`prompt{message, images?, streamingBehavior?: "steer"|"followUp"}` → `{disposition}`;
`steer{message, images?}` → `{disposition}`; `follow_up{message, images?}` → `{disposition}`;
`abort` (waits until idle); `clear_queue` → `{steering[], followUp[]}`; `new_session{parentSession?}` →
`{cancelled}`; `get_state` → `RpcSessionState`; `set_model{provider, modelId}` → full `Model`;
`cycle_model`; `get_available_models` → `{models: Model[]}`; `set_thinking_level{level}`;
`cycle_thinking_level`; `get_available_thinking_levels` → `{levels}`; `set_steering_mode{mode}`;
`set_follow_up_mode{mode}`; `compact{customInstructions?}` → `CompactionResult`;
`set_auto_compaction{enabled}`; `set_auto_retry{enabled}`; `abort_retry`; `bash{command,
excludeFromContext?}` → `BashResult` (streams `bash_execution_update{id, delta}`); `abort_bash`;
`get_session_stats` → `{sessionFile, sessionId, userMessages, assistantMessages, toolCalls, toolResults,
totalMessages, tokens{input,output,cacheRead,cacheWrite,total}, cost, contextUsage?{tokens|null,
contextWindow, percent|null}}` (L526-567); `export_html{outputPath?}`; `switch_session{sessionPath}`;
`fork{entryId}` → `{text, cancelled}`; `clone`; `get_fork_messages`; `get_entries{since?}` →
`{entries, leafId}` (durable cursor, includes abandoned branches, L689-717); `get_tree` → `{tree,
leafId}`; `get_last_assistant_text`; `set_session_name{name}`; `get_messages` → `{messages:
AgentMessage[]}`; `get_commands` → `{commands[{name, description?, source, sourceInfo}]}`.
Every command takes optional string `id`; the response repeats it. `CA/docs/rpc.md` L37-48.

Events (`CA/docs/json.md`): `agent_start`; `agent_end{messages, willRetry}`; `agent_settled`;
`turn_start`; `turn_end{message, toolResults}`; `message_start{message}`;
`message_update{usage, assistantMessageEvent}` where the nested event is `start | text_start |
text_delta{contentIndex, delta} | text_end{contentIndex, content} | thinking_start | thinking_delta |
thinking_end | toolcall_start{contentIndex, id, toolName} | toolcall_delta{contentIndex, delta} |
toolcall_end{contentIndex, toolCall} | done | error` (L74-95, delta-only, no `partial`);
`message_end{message}` (authoritative); `tool_execution_start{toolCallId, toolName, args}`;
`tool_execution_update{toolCallId, toolName, args, partialResult}`; `tool_execution_end{toolCallId,
toolName, result, isError}` (L101-115); `queue_update{steering, followUp}`; `entry_appended{entry}`;
`session_info_changed{name?}`; `thinking_level_changed{level}` (L117-126);
`compaction_start{reason}` / `compaction_end{reason, result?, aborted, willRetry, errorMessage?}`
(L128-159); `auto_retry_start{attempt, maxAttempts, delayMs, errorMessage}` / `auto_retry_end{success,
attempt, finalError?}`; `summarization_retry_scheduled | _attempt_start | _finished` (L161-180);
RPC-only `bash_execution_update{id?, delta}` and `extension_error{extensionPath, event, error}`
(L182-194). RPC emits no `session` header; use `get_state`. L29. Nested tool calls (`ctx.executeTool`,
codemode) carry `parentToolCallId`. `CA/CHANGELOG.md` L120.

### B. Extension UI over RPC

- Two categories. Dialog methods `select`, `confirm`, `input`, `editor` emit `extension_ui_request`
  and block until an `extension_ui_response` with the same `id`. Fire-and-forget methods `notify`,
  `setStatus`, `setWidget`, `setTitle`, `set_editor_text` emit a request and expect nothing.
  `CA/docs/rpc-extension-ui.md` L7-8. Request shapes: `select{title, options[], timeout?}`,
  `confirm{title, message, timeout?}`, `input{title, placeholder?, timeout?}`, `editor{title, prefill?}`,
  `notify{message, notifyType?: info|warning|error}`, `setStatus{statusKey, statusText|undefined}`,
  `setWidget{widgetKey, widgetLines|undefined, widgetPlacement?}`, `setTitle{title}`,
  `set_editor_text{text}`. `CA/src/modes/rpc/rpc-types.ts` L252-287. Responses: `{id, value}` |
  `{id, confirmed}` | `{id, cancelled: true}`; cancel yields `undefined` (select/input/editor) or
  `false` (confirm). L294-297; docs L172-194.
- `timeout` on a dialog: the agent side auto-resolves with the default; the client need not track it.
  `CA/docs/rpc-extension-ui.md` L10, L33.
- No-ops / degraded in RPC: `custom()` → `undefined`; `onTerminalInput()` → no-op unsubscribe;
  `setWorkingMessage/Visible/Indicator`, `setHiddenThinkingLabel`, `setFooter`, `setHeader`,
  `addAutocompleteProvider`, `setEditorComponent`, `setToolsExpanded` are no-ops; `getEditorText()` →
  `""`; `getToolsExpanded()` → `false`; `pasteToEditor()` → `setEditorText()`; themes: `getAllThemes()
  → []`, `getTheme() → undefined`, `setTheme()` → `{success:false, error:"Theme switching not supported
  in RPC mode"}`. L14-23.
- `ctx.mode` is `"rpc"` and `ctx.hasUI` is `true` in RPC mode; guard terminal-only features with
  `ctx.mode === "tui"`. L25; `CA/src/core/extensions/types.ts` L323-331 (`hasUI`: "Whether
  dialog-capable UI is available (true in TUI and RPC modes)"); `CA/docs/extensions.md` L247.
- Example client/extension pair: `CA/examples/rpc-extension-ui.ts`, `CA/examples/extensions/rpc-demo.ts`.
  L198.

### C. Pi Durable at v1.0.0

- Package `@earendil-works/pi-durable` 1.0.0, "Durable conversation, task, and document runtime for
  Pi", published to npm 2026-10-01T19:11:05Z (`npm view`). `DU/package.json` L2-4. Dependencies are only
  `@earendil-works/chord`, `@earendil-works/pi-ai`, `diff`, `typebox`; **no dependency on
  `pi-coding-agent` or `pi-agent-core`**. L102-107. Subpath exports: `.`, `./env`, `./env/node`,
  `./tools`, `./storage/memory`, `./storage/jsonl[/node]`, `./storage/sqlite[/node]`, `./testing`.
  L8-60.
- Status: "**Experimental.** The API changes without notice between releases." `DU/README.md` L3. Blog:
  "Pi Durable is experimental, and the API might still change" (earendil.com/posts/pi-durable, §Try it);
  "available today as an experimental package" (earendil.com/posts/pi-1-0). Spec header calls it
  "Pico5"; `watchEvents` is doubly experimental ("Its protocol may change without notice").
  `DU/docs/spec.md` L1-3, L3955-3961.
- Core rule: "A Session atomically commits immutable entries, full task records, and Chord-tracked
  documents. Only committed state is observable." `DU/docs/spec.md` L41-43. Partials and tool output
  are committed at most every 100 ms. `DU/README.md` L287.
- API surface (`DU/README.md`, `DU/src/index.ts` L1-181): `Harness.open(storage, {models, registry,
  settings?, env?, conversationCreated?}, context)` L57, L215-228; `harness.root(context, {agent?,
  init?})` L58, L72; `harness.createConversation({ownership, agent?, init?})` L391;
  `conversation.fork(entryId, {...})` L392-395; `conversation.submit({type:"input"|"write", content,
  whenBusy?: "followUp"|"steer"|"reject", requestId?})` → `Submission.wait()` L60-74, L291-306;
  `abort()` L399; `configure({model, thinkingLevel, extensions, tools, instructions, cwd})` L190-208;
  `agent()` L205; `reset()` L310-317; `compact()` + settings `compaction{enabled, reserveTokens,
  keepRecentTokens, backgroundTokens}` L319-349; `viewState()` / `watch()` L259-287;
  `watchEvents(harness, conversationId, context)` L351-365; `harness.resume()`, `submission(id)`,
  `waitForTask`, `snapshot`, `watchDoc`, `documentState`, `taskGraph`, `usage`, `close`. Extensions =
  `defineExtension({name, tools, sections, hooks, wraps, tasks})` installed in a process-owned
  `createRegistry()`; conversations store extension **names**, resolved against the registry at each
  use. L124-143, L208, L247-257.
- Storage guarantees: Memory (nothing persisted); SQLite `openNodeSqliteStorage(file)` — "WAL mode with
  `synchronous = NORMAL`: commits survive process crashes; the newest may be lost on power or host
  failure" (`DU/README.md` L524; pragmas in `DU/src/storage/sqlite/node.ts` L190-192); JSONL
  `openNodeJsonlStorage(dir, ctx)` — "Pass `{ fsync: true }` to flush before each commit marker" (L525;
  spec L4420-4433 explains the sidecar/marker protocol and that even with fsync `main.jsonl` tail
  commits may still disappear). "**One process owns a storage at a time; there is no cross-process
  locking.**" L527. Uncertain storage failure poisons the Session. Spec L76-79, L4581-4582.
- Watchers: a watch "keeps at most 100 undelivered frames. After that, the pending frames are replaced
  by one frame holding the whole newest view. A client that joins late or reconnects starts from the
  current view; nothing is replayed." `DU/README.md` L285; spec L3876-3882. Event streams likewise:
  >100 undelivered batches → one fresh `snapshot`; "Transport backpressure and disconnect policy belong
  to the consumer." Spec L4090-4095. Late join demo: `DU/test/examples/21-late-join.ts` L54-99.
- Tool replay policy: `replay?: "safe" | "unsafe"`, omitted = `unsafe` (spec L2693, L2720). "On reopen,
  a tool reruns only when both its stored intent policy and the current declaration ... say `safe`. A
  current `unsafe` declaration may veto a stored-safe replay; a current-safe declaration never upgrades
  stored unsafe. A tool that no longer resolves is treated as `unsafe`. Every other orphaned effect
  produces an interrupted result containing the durable partial output." Spec L2975-2983; README L166.
- `CodingTools` (`read`, `write`, `edit`, `bash`) "ported from the agent harness tools"; "`read` does not
  return images yet." Spec L2993-2995; README L147; `DU/src/tools/read.ts` L37-45 returns an
  `unsupported_image` error result.
- Subagents = task-owned conversations driven by a tool; background anchor tasks let them outlive the
  parent's turns and survive restarts. `DU/README.md` L397-442; `DU/test/examples/23-subagent-background.ts`
  L1-5, L56-71, L132-211. Reviewer example: separate conversation with its own cheaper model, exactly
  `[CodingTools, Reviewer]` extensions, `tools: [createReadTool()]`, `cwd: worktree` ("in practice a
  `git worktree add`"), an `onYield` review loop. `DU/test/examples/28-reviewer.ts` L1-2, L33-44,
  L48-49, L79-90. Reload/restart: `31-reload-and-restart.ts` L1-2, L62-87.
- Environments: `env: ({cwd, conversationId, ...}) => ExecutionEnv` built per tool call / section render,
  so one directory or container per conversation. `DU/README.md` L231-245; `26-coding-agent.ts` L52-54,
  L74-78.
- **Does Durable reuse the coding agent's extensions, skills, AGENTS.md, settings, auth?** No. Its
  extension model is its own (`defineExtension` with `tools/sections/hooks/wraps/tasks`), model access is
  raw `pi-ai` `createModels()` + provider constructors (e.g. `openaiProvider()` reading
  `OPENAI_API_KEY`), the system prompt is assembled from extension `sections` only, and `grep -rn
  "AGENTS.md\|skill\|pi-coding-agent" DU/src` finds nothing. `DU/README.md` L7, L54-55, L124-143,
  L178-186; `DU/package.json` L102-107. Codemode, tool search, MCP, prompt templates, `/login` OAuth
  credentials, `~/.pi/agent/sessions` JSONL are all absent. The blog says Durable "is not changing" the
  existing coding agent (earendil.com/posts/pi-durable).
- **RPC?** None. Durable is in-process only; `grep -rn "stdin\|rpc\|websocket" DU/src` matches only
  `env/node.ts` (child-process stdin for bash). Print/JSON-style consumers are shown as examples
  (`18-print.ts`, `19-json.ts`), not modes. Chord provides the replicated-state primitives a server would
  forward. `DU/README.md` L274-283, L351-365; spec L3904-3953.
- **How a web server with many browser clients would use it:** one Node process opens one storage
  (SQLite file) and one `Harness`; each piano session is a conversation (`createConversation` with
  `agent.cwd` = project or worktree); browsers connect over WebSocket and the server either forwards
  `watch()` ops (Chord deltas, client applies them) or `watchEvents()` batches (coding-agent-shaped
  events) starting from the attachment snapshot; input goes through `submit()` with `whenBusy`;
  `requestId` makes retries idempotent; restart = reopen storage + `resume()`. `DU/README.md` L103-122,
  L259-306, L351-365; `21-late-join.ts`. Many clients per conversation is explicit ("Multiplayer"
  section of the blog; README L285). Multiple server processes on one storage is **not** supported
  (L527).

### D. SDK path

- `createAgentSession()` uses cwd, discovered resources, settings and credentials like the CLI;
  `prompt()` resolves when the run finishes; `dispose()` aborts work and unbinds. `CA/docs/sdk.md` L8-20,
  L28-30, L56. Pass `cwd` explicitly when it differs from `process.cwd()`. L54.
- Not auto-configured like the CLI: "The CLI loads `codemode`, `tool_search`, and MCP as built-in
  extensions. SDK sessions do not; add `createCodemodeExtension()`, `createToolSearchExtension()`, and
  `createMcpExtension()` to the `extensionFactories` of `DefaultResourceLoader`. `codemode` and
  `tool_search` are registered inactive: enable them through the `defaultTools` setting
  (`["+codemode", "+tool_search"]`) or let the MCP extension activate them ... The MCP extension connects
  its servers on `session_start`, so call `session.bindExtensions()`." `CA/docs/sdk.md` L116;
  `CA/examples/sdk/14-codemode-mcp.ts` L26-50; exports `CA/src/index.ts` L405-410.
- `SessionManager` authoritative: "`SessionManager` is authoritative for finalized model context. Restore
  external history by constructing the session with a manager containing those entries. Assigning
  `session.agent.state.messages` does not replace persisted context." `CA/docs/sdk.md` L38-40;
  `CA/CHANGELOG.md` L222 (0.87.1).
- `steer()`/`followUp()` return `"queued"|"handled"`; `prompt()` while streaming must choose steer or
  follow-up or it rejects. L64-68. Subscribe before prompting; `agent_settled` for "will not continue".
  L74-92. `AgentSessionRuntime` for `newSession/switchSession/fork/importFromJsonl`; subscriptions must be
  rebound after replacement. L58-60.
- Long-lived server process: **UNVERIFIABLE** — `CA/docs/sdk.md`, `cli-integration.md` and
  `how-pi-works.md` contain no statement for or against hosting many `AgentSession`s in one long-lived
  process (`grep -n -i "server\|long-lived\|concurrent" CA/docs/sdk.md` → only the MCP line). The docs
  position the SDK as "in process" vs RPC as "child process ... isolated processes" (`CA/docs/rpc.md`
  L7-10; `cli-integration.md` L7, L13-16). Extensions run inside the host process with its permissions
  (`CA/docs/how-pi-works.md` L49), so an extension crash or `process.exit` takes the server down.

### E. Claim-by-claim verification of the pasted recommendation (pi claims only)

| Claim | Verdict | Source |
|---|---|---|
| Pi 1.0.0 shipped 2026-10-01 | VERIFIED | `CA/CHANGELOG.md` L3; pi.dev/changelog |
| Pi Durable introduced alongside, separate, experimental, for persistent long-running agents with multiple clients | VERIFIED | npm `pi-durable@1.0.0` 2026-10-01; `DU/README.md` L3, L5, L285; blog pi-1-0, pi-durable |
| 1.0.0 adds fullscreen-by-default TUI | VERIFIED | `CA/CHANGELOG.md` L6, L24 |
| Leaner codemode prompts, ~40% token reduction "for a particular configuration" | VERIFIED (5,300→3,300 ≈ 38%, "default tools and codemode active, GPT-5.6") | L7, L28 |
| `models.generateImages()` image generation | VERIFIED | L8, L19 |
| Radius sign-in in `/login` | VERIFIED | L10, L25 |
| Headless-friendly Anthropic login ("copy code") | VERIFIED | L11, L20 |
| MCP OAuth hardening | VERIFIED | L12, L17, L35, L36 |
| Cache warming and transcript-aware prompt updates appeared in 0.86.0 | VERIFIED | L270, L274, L276, L288, L298 |
| Interfaces: interactive, print/JSON, RPC, SDK | VERIFIED | `CA/docs/cli-integration.md` L7, L13-16; pi.dev home |
| Persistent branching JSONL sessions, tree navigation, compaction, steering, follow-up | VERIFIED | `CA/docs/sessions.md` L20-34, L46; `session-format.md` L3, L209-222; `rpc-commands.md` L46-92 |
| Extensions, skills, prompt templates, packages | VERIFIED | `CA/docs/{extensions,skills,prompt-templates,packages}.md` exist; `docs/index.md` L21 |
| Native MCP and deferred tool discovery | VERIFIED (since 0.99.0) | `CA/CHANGELOG.md` L119; `docs/mcp.md` L174-206 |
| Codemode with QuickJS sandbox | VERIFIED | L119; `docs/codemode.md` L7 |
| Virtual models | VERIFIED, flagged **experimental** | L122; `docs/virtual-models.md` |
| Cache warming and dynamic prompt/tool tracking | VERIFIED | L274-298; `settings.md` L19-21 |
| Pi deliberately avoids planning workflow, subagent organization, per-call permission popups | VERIFIED (marketing site, not repo docs) | pi.dev home: "No plan mode", "No permission popups", "Spawn Pi instances via tmux, or build your own with extensions"; root `README.md` L42 |
| RPC is JSONL over stdin/stdout | VERIFIED | `CA/docs/rpc.md` L3, L52 |
| Prefer exported `RpcClient` | VERIFIED as documented advice; see A.5 caveats for a server host | `CA/docs/rpc.md` L5; `rpc-client.ts` L104, L133, L145-167 |
| Successful prompt response = command handled, not task finished | VERIFIED | `CA/docs/rpc.md` L60 |
| Use `agent_settled` not `agent_end` | VERIFIED (exists since 0.80.4, not new) | `CA/docs/json.md` L48; `CHANGELOG.md` L1163 |
| Prompt with disposition `"handled"` may start no run | VERIFIED (new in 0.99.0) | `CA/docs/rpc.md` L67; `CHANGELOG.md` L129 |
| Subscribe before submitting | VERIFIED | `CA/docs/rpc.md` L71 |
| Closing stdin requests shutdown | VERIFIED | `CA/docs/rpc.md` L93; `rpc-mode.ts` L802-805 |
| SDK not auto-configured: codemode, tool search, MCP need extension factories and activation | VERIFIED | `CA/docs/sdk.md` L116 |
| MCP connects on `session_start`, so `session.bindExtensions()` matters | VERIFIED | L116; `examples/sdk/14-codemode-mcp.ts` L49-50 |
| Keep `SessionManager` authoritative | VERIFIED | L38-40 |
| RPC supports select/confirm/input/editor dialogs, status and notification messages | VERIFIED (+ setWidget, setTitle, set_editor_text) | `CA/docs/rpc-extension-ui.md` L7-8 |
| `custom()` and several terminal methods unsupported/no-ops | VERIFIED | L14-23 |
| `ctx.hasUI` true in RPC; terminal-only code checks `ctx.mode === "tui"` | VERIFIED | L25; `extensions/types.ts` L327-331 |
| Durable persists conversations, model/tool work, typed documents through atomic commits | VERIFIED | `DU/README.md` L5, L80-84; spec L41-43 |
| Checkpointed tasks, forks, per-conversation configurations and environments, background work, compaction, attaching clients to live state | VERIFIED | `DU/README.md` L85, L388-395, L188-208, L231-245, L437, L319-349, L259-287 |
| Experimental, APIs can change | VERIFIED | `DU/README.md` L3 |
| One process owns a storage, no cross-process locking | VERIFIED | L527 |
| SQLite WAL `synchronous=NORMAL` | VERIFIED | L524; `DU/src/storage/sqlite/node.ts` L190-191 |
| JSONL has explicit fsync option | VERIFIED | L525; spec L4420-4426 |
| Watchers can receive replacement snapshots when behind | VERIFIED | L285; spec L3876-3882, L4090-4094 |
| `CodingTools.read` does not return images | VERIFIED | L147; `DU/src/tools/read.ts` L37-45 |
| Tool replay only when stored and current policies permit, else interrupted result | VERIFIED | spec L2975-2983; README L166 |
| Reviewer example at `packages/durable/test/examples/28-reviewer.ts` with read-only tools and separate checkout | VERIFIED | `28-reviewer.ts` L1-2, L48-49, L85-86 |

Nothing in the pi-related part of the recommendation was refuted. Two nuances the recommendation
elides: `agent_settled` and stdin-close shutdown are **not** 1.0.0 changes (piano already relies on
both), and the only RPC wire change since piano's pinned 0.87.1 is the `disposition` field.

### Implications for piano

Piano's `pi --mode rpc` architecture is unaffected by 1.0.0 at the wire level; the upgrade from 0.87.1
is already installed, tests pass and the server typechecks. Concrete, file-by-file:

- `server/PiSessions.ts` `act` → `prompt` (L374-385): read `data.disposition` from the `prompt`/
  `follow_up` response (`child.request` already returns `data`). On `"handled"` nothing will stream, so
  do not expect `agent_start`; surface it as a `notice` ("handled by extension command") or return it to
  the client. The existing "rejected because streaming → retry as follow_up" fallback (L377-382) remains
  valid: 1.0.0 still errors when a `prompt` arrives mid-run without `streamingBehavior`
  (`CA/docs/rpc-commands.md` L29). Alternative: send `prompt` with `streamingBehavior: "followUp"` and
  drop the retry — not verified that the field is ignored when idle; test against `test/fake-pi.mjs`
  plus a real child before relying on it.
- `server/PiSessions.ts` `onRecord` (L296-335): piano already keys idle on `agent_settled` and
  shutdown on stdin close + 3 s kill (L190-198), matching `CA/docs/rpc.md` L69, L93. Unhandled 1.0.0
  events worth surfacing for a web UI: `tool_execution_update{partialResult}` (live bash output),
  `queue_update` (show queued follow-ups), `compaction_end`, `auto_retry_end`, `turn_*`, and the
  fire-and-forget UI methods `setStatus`/`setWidget` (currently dropped by the `DIALOG_METHODS` filter).
  Dialog `timeout` (`rpc-types.ts` L253-262) is auto-resolved on the pi side; the retained `Dialog` in
  `dialogsRef` should be dropped when a later `extension_ui_request` arrives after a timeout or when the
  answer is rejected — today nothing clears a timed-out dialog (`shared/wire.ts` `Dialog` has no
  `timeout`; add it so the client can show a countdown).
- `server/PiSessions.ts` `toState`/`RawState` (L89-105): `get_state` also returns `isCompacting`,
  `pendingMessageCount`, `messageCount`, `steeringMode`, `followUpMode`, `autoCompactionEnabled`
  (`rpc-types.ts` L96-109); `isCompacting` and `pendingMessageCount` are cheap additions to
  `SessionState`.
- `server/PiRecords.ts` `StreamAssembler` (L109-175): add `thinking_delta` (optional thinking view),
  `text_end`/`toolcall_end` authoritative replacement (docs L93 say replace reconstructed text with
  `text_end.content`), and carry `message_update.usage` so the composer can show live token counts.
  Nested codemode/MCP tool calls carry `parentToolCallId`; group them under the parent in `RenderMsg`.
- `server/SessionFiles.ts` (L21-70): unchanged API (`SessionManager.list/open/getBranch/
  getSessionName`). Since 0.99.0 a file exists after the first user message, so a session whose first
  turn crashed now appears in the sidebar with `messageCount` 1; `SessionHosts.ts` L87 (`isNew` via
  `findSessionFile`) therefore passes `--name` only for sessions that never got a prompt — correct.
  `peekSession` should keep `model_change` as the selected model and only fall back to the assistant's
  `provider/model`, otherwise a virtual model shows as its physical route (`CA/docs/virtual-models.md`
  L18-25).
- `server/PiCli.ts` (L20-24): no flag renames affect the spawn line. If piano ever passes `--provider`
  it must also pass `--model` (1.0.0 errors otherwise). `-ne` now also removes built-in MCP/codemode;
  do not add it to `PIANO_PI_ARGS` casually.
- `server/Catalog.ts` / `probe` (`PiSessions.ts` L423-442): `get_available_models` may include
  virtual models (`provider/id` registered by extensions); `get_available_thinking_levels` is the
  authoritative per-model effort list and is cheaper than reconstructing from `thinkingLevelMap`.
- `shared/wire.ts`: new `SessionAction` candidates that 1.0.0 supports with no extra pi work: `steer`
  (vs follow_up), `clear_queue`, `compact`, `set_session_name`, `fork{entryId}`, `get_entries{since}`
  for reconnect catch-up (durable cursor, `rpc-commands.md` L689-717), `get_commands` for a slash-command
  palette, `bash` with `bash_execution_update`.
- Do **not** replace `PiSessions` with `RpcClient`: it forwards child stderr to the server's stderr,
  sleeps 100 ms on start, and stops with SIGTERM/SIGKILL (`rpc-client.ts` L104, L133, L145-167).
  Import `RpcCommand`/`RpcResponse`/`JsonAgentSessionEvent` types for `PiRecord` typing instead
  (`CA/docs/json.md` L218).
- SDK in-process (`createAgentSession` per piano session) is not a documented long-lived-server
  pattern (§D) and would move extension code into the piano process; it would also require piano to
  assemble codemode/tool_search/MCP itself (`CA/docs/sdk.md` L116). Keep the child-process seam; the
  isolation is the point of `--mode rpc` (`CA/docs/rpc.md` L7-10).
- Pi Durable is not a drop-in for piano's session substrate: it does not read pi's extensions, skills,
  AGENTS.md, prompt templates, `mcp.json`, `/login` credentials or `~/.pi/agent/sessions`, has no
  codemode/MCP, cannot read images, is single-process per storage, and warns that its API changes
  without notice (§C). It would make piano a different product from the user's `pi`. Where it does fit:
  a future orchestration layer beside the pi children (e.g. a durable reviewer conversation per
  worktree as in `28-reviewer.ts`, or restart-safe background subagents as in
  `23-subagent-background.ts`) with its own SQLite file owned by the piano server, browsers fed by
  `watchEvents()` snapshots + batches over the existing WebSocket. Revisit when the package drops the
  "experimental" banner or when `watchEvents` stabilises.
- `AGENTS.md`/`package.json`: commit the `^1.0.0` bump already in the working tree; note in AGENTS.md
  that the RPC contract piano depends on is `CA/docs/rpc.md`, `rpc-commands.md`, `json.md`,
  `rpc-extension-ui.md` at v1.0.0 and that `prompt` responses now carry `disposition`.

## Appendix B. Workspace and reference-harness findings


Primary sources only. Citation keys:

- `WTREF` = `/Users/james/.claude/plugins/cache/worktrunk/worktrunk/51f9a7cb16f9/skills/worktrunk/reference/` (docs synced from worktrunk.dev; the live `https://worktrunk.dev/hooks/` URL returns 404, the page is `https://worktrunk.dev/hook/`, confirmed by fetch; `/list/`, `/merge/`, `/claude-code/` fetched live and match the synced copies).
- `WTSRC` = `/Users/james/.cache/checkouts/github.com/max-sixty/worktrunk` (HEAD `63b93c6`, 2026-10-02). Installed `wt v0.80.0`.
- `HERDR` = raw docs for the stable release, `https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/<page>.mdx` (linked from `https://herdr.dev/llms.txt`; local copies in this scratchpad as `herdr-<page>.mdx`). Installed `herdr 0.9.1`; `herdr api schema --json` reports `protocol 22`, `schema_version 1`.
- `TAU` = `/Users/james/.cache/checkouts/github.com/milanglacier/pi-tau-web-server` (HEAD `1c56059`, v1.1.2, 2026-10-01).
- `PIWEB` = `/Users/james/.cache/checkouts/github.com/Epsilondelta-ai/pi-web` (HEAD `8b8bf7b`, v1.21.4, 2026-07-20).
- `PIANO` = `/Users/james/scratch/piano` (working tree, uncommitted edits on top of `30d6347`). Installed pi: `@earendil-works/pi-coding-agent` 1.0.0 (`PIANO/node_modules/.../package.json`).

### Worktrunk

#### `wt list --format=json` (schema 2)

- Default is schema 2, an envelope: "`--format=json` emits schema 2 by default: the envelope format below. Set `[list] json-schema = 1` to retain the original bare-array format." `WTREF/list.md:214-215`
- Envelope fields: `schema` ("Format version; always `2`"), `repo` (`{default_branch, forge}`, "absent when detection failed"), `collected` (`{ci, summary}` — "which gated fact families this run requested, so an absent `pr`/`checks`/`summary` reads as 'not requested' rather than 'none'"), `items`. `WTREF/list.md:263-270`
- Unknown vs absent vs unavailable: "**Absent** — nothing to report: not applicable (`worktree` on a branch-only row), not requested this run (the envelope's `collected` records what was), or determined-empty (no PR, no lock, not integrated)." / "**`null`** — requested but not determined: a task timed out, the branch was too stale for the expensive checks, or a forge fetch failed. This is the JSON form of the table's `·` placeholder." `WTREF/list.md:251-258`
- Item fields: `branch` (string/null; "null for a detached-HEAD worktree"), `remote`, `head` (object/null, "null for unborn branches"), `worktree` ("absent on branch-only rows"), `default_branch` ("absent on the default branch itself"), `upstream` ("absent when none is configured"), `pr` and `checks` ("collected with `--full`"), `dev_server` (`{url, listening}`), `summary`, `marker` ("absent when none is set"), `vars`, `display`. `WTREF/list.md:272-288`
- `worktree` object: `path, main, current, previous, detached, locked{reason}, prunable{reason}, branch_mismatch, duplicate_branch, operation ("merge","rebase","cherry_pick","revert","bisect"; absent when none), changes`; `changes` = `staged, modified, untracked, renamed, deleted, conflicted (boolean/null), diff {added, deleted} (object/null)`. `WTREF/list.md:299-329`
- `default_branch` object: `ahead/behind` (number/null, "null for orphans"), `diff`, `orphan`, `integration` ("`{reason}` ... absent when determined not-integrated, null when a dirty tree skipped the checks"), `merge_conflicts` ("simulated locally with `git merge-tree`"). Integration reasons: `same_commit, ancestor, no_added_changes, trees_match, merge_adds_nothing, patch_id_match`. `WTREF/list.md:331-342`, `WTREF/list.md:411-422`
- `pr` object: `number` (integer/null), `url`, `review` ("`changes_requested`, `pending`, `draft`, `approved`, absent when the forge reports no review signal"; "The vocabulary matches Claude Code's statusline `pr.review_state` field"), `mergeable` ("False when the forge reports conflicts, null otherwise"), `repo`. `WTREF/list.md:355-363`, `WTREF/list.md:424-426`
- `checks` object: `status` ("`passed`, `running`, or `failed`; null when a conflicts report masks it"), `source` (`pr`|`branch`), `stale` ("Local HEAD differs from remote (unpushed changes)"). The three remaining CI states are encoded by shape: "a fetch error (`⚠`) makes both null, no CI leaves `checks` absent, and merge conflicts leave `checks.status` null with `pr.mergeable` false." `WTREF/list.md:365-373`
- CI results "are cached for 30-60 seconds; use `wt config state cache` to view or clear." `WTREF/list.md:117`
- `display` is presentation only: `state` (the collapsed default-branch state: `is_main, orphan, empty, integrated, would_conflict, same_commit, diverged, ahead, behind`), `symbols` ("Raw status symbols without colors"), `statusline` ("Pre-formatted status with colors and links"), `columns`. `WTREF/list.md:382-391`, `WTREF/list.md:407-409`
- Published JSON Schema: "A JSON Schema for the envelope is published at worktrunk.dev/schema/list-v2.json". `WTREF/list.md:454-455`
- `--full` is what reaches the network: "`--full` adds the two columns that reach off-machine: CI status (GitHub/GitLab pipeline pass/fail, over the network) and LLM-generated summaries". `WTREF/list.md:11`
- `--branches` adds rows with no `worktree` object; `wt list statusline --format=json` returns "a one-item envelope by default". `WTREF/list.md:445`, `WTREF/list.md:557-560`
- Observed on `PIANO` (`wt -C /Users/james/scratch/piano list --format=json`, read-only): `{"schema":2,"repo":{"default_branch":"main"},"collected":{"ci":false,"summary":false},"items":[{"branch":"main","head":{...,"subject":"feat: pull request pile, ..."},"worktree":{"path":"/Users/james/scratch/piano","main":true,"current":true,"previous":true,"detached":false,"branch_mismatch":false,"duplicate_branch":false,"changes":{"staged":false,"modified":true,"untracked":false,"renamed":false,"deleted":false,"conflicted":false,"diff":{"added":171,"deleted":123}}},"marker":"🤖","display":{"state":"is_main","symbols":"!^🤖","statusline":"main  \u001b[36m!\u001b[39m..."}}]}` — no `repo.forge` (no remote parses), no `default_branch` on main, no `pr`/`checks` (not collected), and a `marker` of 🤖 already set by an agent plugin. (saved tool output `/Users/james/.claude/projects/-Users-james-scratch-piano/bd5de4a1-690a-4be7-99aa-4c0a662c0beb/tool-results/b8q16tu50.txt:565-620`)
- Schema 1 rename table (what piano's current parser silently assumes a mix of): `path` → `worktree.path`, `is_main` → `worktree.main`, `main_state` → `display.state`, `ci.status` → `checks.status`, `ci.review_state` → `pr.review`. `WTREF/list.md:462-487`

#### `wt switch --create` / `wt remove` for a long-running server

- `wt switch --format=json` is "Designed for tool integration (e.g., Claude Code WorktreeCreate hooks)"; `--no-cd`: "Hooks still run normally, and an --execute program still starts in the worktree — only your shell stays put ... Useful when hooks handle navigation (e.g., tmux workflows) or for CI/automation." `WTREF/switch.md:236-243`, `WTREF/switch.md:211-217`
- JSON payload of `wt switch`: `action` (`"already_at"` | `"existing"` | `"created"`), `branch` (optional), `path` ("Absolute worktree path"), `created_branch` ("True if branch was created (--create flag)"), `base_branch`, `from_remote`. `WTSRC/src/commands/worktree/switch.rs:1489-1537`
- `wt remove --format=json` "prints one object per removal to stdout: `{kind, branch, path, branch_outcome, branch_checked_out_at}`"; `branch_outcome` ∈ `deleted, deferred ("Left to the background removal, whose result this run doesn't see. --foreground never reports it"), not_attempted, retained_unmerged, retained_checked_out, retained_raced, retained_failed`. `WTREF/remove.md:97-111`
- Removal is asynchronous by default: "Removal runs in the background by default — the command returns immediately, and output goes to `.git/wt/logs/{branch}/internal/remove.log`. Use `--foreground` to wait for it." `WTREF/remove.md:73-75`
- Branch deletion is conditional: "By default, branches are deleted when they would add no changes to the default branch if merged" (six checks); `--force` for a dirty worktree, `-D` for an unmerged branch, `--no-delete-branch` keeps it. `WTREF/remove.md:37-71`
- `--reap` (experimental, Unix) kills detached processes whose cwd is under the worktree ("Interactive processes are spared"; "Discovery is by working directory only"; reliably reap with `wt step tether`). Relevant because piano's `pi` child has `cwd` = worktree. `WTREF/remove.md:77-95`
- Detached worktrees are addressed by path: "Detached worktrees have no branch name. Pass the worktree path instead: `wt remove /path/to/worktree`." `WTREF/remove.md:117-119`
- Hook approvals block non-interactive callers: "Cannot prompt for approval in non-interactive environment ↳ To skip prompts in CI/CD, add --yes; to pre-approve commands, run wt config approvals add --yes"; the skill says an agent must "stop and escalate to the user" rather than pass `--yes`. (`worktrunk:worktrunk` skill body, §"Hook approvals in non-interactive sessions")
- Non-TTY callers get buffered output: `--progressive` is "Auto-enabled for TTY" and `--no-progressive` forces buffered rendering. `WTREF/list.md:520-525`
- Worktree selection rule for a server living outside any repo: "`-C <path>` moves the working directory, not the worktree selection. Reach for it when ... a caller whose working directory isn't inside a repository at all". (`worktrunk:worktrunk` skill body, §"Which worktree a command acts on")

#### `wt merge` pipeline

- Steps in order: 1 Commit ("Pre-commit hooks run, then uncommitted changes are committed ... skipped when squashing (the default)"), 2 Squash ("Working-tree changes swept into the squash are backed up first to `refs/wt-backup/<branch>`"), 3 Rebase ("A conflict stops the merge with the rebase left open in the worktree, to resolve or abort"), 4 Pre-merge hooks ("Hooks run after rebase, before merge. Failures abort."), 5 Merge ("Fast-forward merge to the target branch ... Non-fast-forward merges are rejected"), 6 Pre-remove hooks, 7 Cleanup ("Removes the worktree and branch ... When already on the target branch, in the primary worktree, or locked, the worktree is preserved"), 8 Post-remove + post-merge hooks ("Run in background after cleanup"). `WTREF/merge.md:62-73`
- "`wt merge` merges into the *local* target branch and never fetches." `WTREF/merge.md:77`
- Flags: `--no-squash`, `--no-commit`, `--no-rebase` ("require the target to fast-forward to the resulting tip"), `--no-remove`, `--no-ff`, `--stage all|tracked|none`, `--no-hooks`, `--format json` ("JSON prints structured result to stdout after merge completes"), `-y/--yes`. `WTREF/merge.md:109-165`
- JSON payload of `wt merge`: `{branch, target, committed, squashed, rebased, removed}`. `WTSRC/src/commands/merge.rs:473-482`
- Blocking hook order across the pipeline: "During `wt merge`, the blocking hooks run in this order: pre-commit → pre-merge → pre-remove. The `post-*` hooks start together once the merge finishes." `WTREF/hook.md:34`

#### Hook points

- Ten hooks: `pre-switch/post-switch`, `pre-start/post-start` (create), `pre-commit/post-commit`, `pre-merge/post-merge`, `pre-remove/post-remove`. "`pre-*` hooks block — failure aborts the operation. `post-*` hooks run in the background with output logged". `WTREF/hook.md:7-17`
- Where each runs: `post-merge` "Runs in the target branch worktree if it exists, otherwise the primary worktree"; `pre-remove` "Runs in the worktree being removed"; `post-remove` runs in the primary worktree ("the active worktree is gone"). `WTREF/hook.md:29-32`, `WTREF/hook.md:161-165`
- Hooks get the full variable set as JSON on stdin: "Hooks receive all template variables as JSON on stdin ... Variables that are unset in a template are absent from the JSON too". Variables include `branch, worktree_path, commit, base, target, pr_number, pr_url, repo_path, default_branch, cwd, hook_type, vars.<key>`. `WTREF/hook.md:116-147`, `WTREF/hook.md:257-273`
- Background hooks lose process ancestry: "`post-*` hooks run as detached background processes, breaking the process ancestry chain. `pre-*` hooks run in the foreground and inherit the terminal's process lineage." (cmux recipe) `WTREF/tips-patterns.md:417`
- Approval model: "Approvals are saved to `~/.config/worktrunk/approvals.toml`"; "If a command changes, new approval is required"; "`--no-hooks` to skip hooks — accepted by the commands that run them (`wt switch`, `wt merge`, `wt remove`, `wt step commit`, `wt step squash`)". `WTREF/hook.md:53-57`
- Pipelines: `[[hook]]` blocks run in order, keys within a block run concurrently; `{{ vars.* }}` set in one step is readable by later steps. `WTREF/hook.md:85-99`

#### Pi plugin and activity markers

- `wt config plugins pi install` "writes the activity extension to `~/.pi/agent/extensions/worktrunk.ts`, where Pi discovers it on startup; `$PI_CODING_AGENT_DIR` replaces the agent directory." `WTREF/claude-code.md:56-62`
- Pi gets only activity tracking; no configuration skill, no worktree isolation ("Worktree isolation needs worktree-lifecycle hooks, which only Claude Code exposes, so Codex, OpenCode, Pi, oh-my-pi, and Gemini users invoke `wt switch --create` and `wt remove` directly"). `WTREF/claude-code.md:5-14`
- The whole extension is 43 lines: `pi.on("agent_start")` → `wt config state marker set 🤖`; `pi.on("agent_settled")` → `set 💬`; `pi.on("session_shutdown")` → `clear`; all via `pi.exec("wt", [...], { cwd })`, errors swallowed ("Activity tracking must never interrupt the host Pi session"). The comment explains the event choice: "`agent_end` is not the end: Pi may auto-retry, auto-compact and retry, or pick up a queued follow-up message. `agent_settled` is the event Pi documents for status integrations". `WTSRC/dev/pi-extension.ts:16-43`
- Installer embeds the source at compile time and checks installation by byte-equality (`content == EXTENSION_SOURCE`); it expands `~` in `$PI_CODING_AGENT_DIR` because "Pi expands a leading `~` ... (`getAgentDir` → `normalizePath`)". `WTSRC/src/commands/config/pi.rs:16-45`
- Marker storage is plain git config, keyed by branch, not by process: "Stored in git config as `worktrunk.state.<branch>.marker`" — `git config worktrunk.state.feature.marker '{"marker":"🚧","set_at":0}'`; reads back as the item's `marker` field in `wt list`. `WTREF/config.md:1254-1260`, `WTREF/list.md:195-200`
- Any host can drive the same markers without a plugin: session start/resume → `wt config state marker set "🤖"`, finished turn → `set "💬"`, session end → `clear`. "A stale marker can remain if the agent process is killed before its session-end hook runs ... `wt config state marker clear` removes a marker manually." `WTREF/claude-code.md:121-129`, `WTREF/claude-code.md:109`
- Pi's own docs agree on the settle semantics: "`agent_settled` is final and notification-only; use it when an integration needs to know Pi will not continue automatically." and in RPC: "`agent_end` marks the end of one low-level agent run, but retries, overflow recovery, compaction, steering, or follow-up work can still follow. Wait for `agent_settled`". `PIANO/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:62-67`, `.../docs/rpc.md:69`
- Per-branch `vars` (`wt config state vars set k=v [--branch]`) are also git config, surface in `items[].vars`, and feed `[list.custom-columns]` templates "useful for tracking what each of many (often agent-driven) branches is for". `WTREF/list.md:123-131`, `WTREF/config.md:1285-1311`
- Statusline for Claude Code (`wt list statusline --format=claude-code`) is run "in the background, which is what makes the occasional 1–2 second CI fetch invisible." `WTREF/claude-code.md:141-143`

### Herdr

- Transport: "Herdr uses newline-delimited JSON over a local socket. On Unix, that socket is a Unix domain socket. On Windows, it is a named pipe. Send one request per line: `{"id":"req_1","method":"ping","params":{}}`"; a success echoes the `id` with `result`. Socket at `~/.config/herdr/herdr.sock` or `~/.config/herdr/sessions/<name>/herdr.sock`; resolution order "explicit CLI `--session <name>`, `HERDR_SOCKET_PATH`, `HERDR_SESSION=<name>`, default session socket". `HERDR/socket-api.mdx` ("Socket transport", "Socket paths"; local `herdr-socket-api.mdx`), `https://herdr.dev/docs/socket-api/`
- Method families: Workspace (`workspace.create/list/get/focus/rename/move/move_block/report_metadata/close`), Worktree (`worktree.list/create/open/remove`), Tab, Pane (incl. `pane.send_text/send_keys/send_input/read/report_agent/report_agent_session/report_metadata/clear_agent_authority/release_agent/wait_for_output`), Layout, Agent (`agent.list/get/read/explain/send_keys/prompt/wait/rename/focus/start/view.set/view.clear`), Events (`events.subscribe`, `events.wait`), Integrations, Plugins, `session.snapshot`, `notification.show`. `herdr-socket-api.mdx:100-112`
- `agent.wait` "is server-owned and event-driven. It pins the resolved pane occupant so a replacement cannot satisfy the wait. `agent.prompt` accepts an optional `wait` object with `until` and `timeout_ms`; this submits the prompt and starts the wait in one request, avoiding a race between separate calls. If the resolved agent is already `blocked`, `agent.prompt` returns `agent_blocked` without sending input or starting the wait." `herdr-socket-api.mdx:114`
- Schema (from the installed binary): `AgentPromptParams {target, text, wait?}`, `AgentWaitParams {target, timeout_ms?, until: AgentStatus[]}`, `PaneReportAgentParams {pane_id, source, agent, state, message?, seq? (uint64), agent_session_id?, agent_session_path?}` with required `pane_id, source, agent, state`; `WorktreeCreateParams {workspace_id?, cwd?, branch?, base?, path?, label?, focus=false, trust_repository}`. `herdr api schema --json` (local `herdr-schema.json`, `schemas.request.$defs`)
- Snapshot vs events: "`session.snapshot` returns a one-time bootstrap snapshot for clients that keep their own local runtime cache ... It is not a subscription. For cache bootstrap and recovery, subscribe first, then reconcile through authoritative reads ... Events invalidate cached state; they cannot be unconditionally replayed over a snapshot." `herdr-socket-api.mdx:118-126`
- Event stream is bounded and non-durable: "Lifecycle subscriptions start when the request is accepted and do not replay events retained before that point." / "Event history is not durable. If a subscriber falls behind the retained history ... the server sends an error response with the original request `id` and `error.code: "events_lost"`, then closes that subscription connection instead of silently continuing with missing events." `herdr-socket-api.mdx:787-800`
- Worktree ops: "`worktree.create` creates a checkout and returns the new `workspace`, `tab`, `root_pane`, and `worktree` records. If the requested branch already exists locally, it checks out that branch; otherwise it creates the branch from the requested base or `HEAD`. `worktree.open` opens an existing checkout or returns the already-open workspace. `worktree.remove` runs `git worktree remove` against a linked child workspace and never deletes the branch." Emits `worktree.created/opened/removed` plus workspace/tab/pane events. `herdr-socket-api.mdx:342-364`
- Agent state vocabulary and ordering: states `idle, working, blocked` (reporting) / `idle, working, blocked, done, unknown` (observed); `--seq` "must increase with every report from your source, including across sessions and restarts of your agent. A timestamp works well. Herdr ignores reports whose number is not higher than the last one it accepted". `HERDR/add-herdr-support.mdx:46-49`, `HERDR/agents.mdx:12`
- Resume command contract: reported via `resume_argv` on `pane.report_agent[_session]`; "The first word is a plain command name on the user's `PATH`"; "At most 64 arguments and 8 KiB in total"; "Your source must hold the pane first ... Otherwise Herdr answers with `resume_not_accepted`." Resume commands "need Herdr 0.10.0 or later." `HERDR/add-herdr-support.mdx:67-74,93`, `herdr-socket-api.mdx:690`
- Release on exit: "If your agent exits without releasing, Herdr notices once the pane is back at its idle shell prompt and clears the agent ... usually takes a second or two. It is a safety net, not a replacement for releasing." Guidance: "Send reports in the background or with a short timeout, and ignore failures. Send only the latest state." `HERDR/add-herdr-support.mdx:87-92`
- Persistence matrix: Detach/reattach — processes keep running, layout, screen and conversation all return; Server restart — "Processes keep running: No; Layout returns: Yes; Recent screen returns: Only with pane screen history; Agent conversation resumes: Only with native agent session restore." `HERDR/session-state.mdx:10-15`
- Snapshot restore "restores the saved session shape: workspaces, tabs, panes, cwd, layout, and focus" but "does not preserve running shells, servers, tests, or arbitrary processes"; `session.json` with up to 3 `session-backups/` recovery copies and "up to 48 layout snapshots in `session-snapshots/` ... at most once every 15 minutes". `HERDR/session-state.mdx:31-47`
- Pane screen history is off by default ("pane output can include secrets, tokens, prompts, and command output"), enabled by `[experimental] pane_history = true`, stored in `session-history.json`, "replayed only when it matches the exact saved layout". `HERDR/session-state.mdx:60-71`
- Native resume for Pi: integration version ≥ `2`, command `pi --session <path-or-id>`; "If native agent session restore applies to a pane, Herdr resumes the agent session instead of replaying saved pane history". `HERDR/session-state.mdx:88-92,115`
- The installed Pi integration (`~/.pi/agent/extensions/herdr-agent-state.ts`, `HERDR_INTEGRATION_VERSION=9`) only activates in TUI mode — "RPC/JSON/print modes are headless (no PTY herdr can display), and RPC still reports hasUI=true, so mode is the reliable gate" — maps `agent_start` → working, `agent_settled` + `ctx.isIdle()` → idle, a custom `herdr:blocked` event → blocked, reports `agent_session_path` from `ctx.sessionManager.getSessionFile()`, and drops intermediate states while a send is in flight (latest-wins queue). `~/.pi/agent/extensions/herdr-agent-state.ts:229-241`, `:243-260`, `:74-92`, `:149-177`
- Herdr detects agents by screen rules only when no integration reports: "When an integration also reports state, Herdr uses those reports instead of reading the screen"; blocked detection "is deliberately strict ... If no manifest rule matches for a known agent other than Codex, Herdr falls back to `idle`". `HERDR/agents.mdx:61,73`
- `agent start` and `agent prompt --wait` semantics from the skill file: start "returns only after Herdr detects the expected agent in the same pane and considers it ready" (30 s default); prompt with `--wait` requires "observed `working` or `blocked` activity" within five seconds else `agent_prompt_stalled`; "A timeout or stalled response does not prove the prompt was never delivered; do not blindly submit it again." (`herdr --skill` output, §"Start and coordinate an agent")

### pi-tau-web-server

Analysis delegated to a subagent and spot-checked (`sessions.ts:304-330`, `:454-462` verified by direct read).

- Targets pi by range, not pin: `"@earendil-works/pi-coding-agent": ">=0.86.0 <2.0.0"` (devDependency); binary found on PATH via `spawn('pi', ...)`. `TAU/package.json:63-71`, `TAU/src/server/sessions.ts:213-218`
- RPC subprocess, one long-lived child per session: argv `['--mode','rpc','--extension', TAU_TREE_EXTENSION]`, `--session <file>` only on resume, `--model` only if given; env `{...process.env, TAU_DISABLED:'1'}`, `cwd` = session cwd. `TAU/src/server/sessions.ts:209-218`
- Framing: buffer, split `/\r?\n/`, keep trailing partial, `JSON.parse` per line, non-JSON logged; `type==='response'` → `handleResponse`, else `handleEvent`. `TAU/src/server/sessions.ts:396-413`
- Correlation: `cmd_<ts36>_<rand>` ids, `pending` map with timers; defaults 60 s, `prompt` 10 s ("Current Pi acknowledges `prompt` after preflight rather than after completion, so a 10-second timeout there is a genuine failure"), probes 5 s. `TAU/src/server/sessions.ts:273-302`, `TAU/.plans/active/debug-session-hang-and-unaborteable/plan.md:93`
- `extension_ui_response` bypasses the request map: "Pi never acknowledges UI replies. Success means stdin delivery only." `TAU/src/server/sessions.ts:304-313`
- Readiness is a timer: resolve after 100 ms unless exited, then fire-and-forget `get_state` + `get_session_stats` at 250 ms. `TAU/src/server/sessions.ts:233-270`
- Fan-out: a flat `Set<LiveClient>`; `broadcast()` sends every session's events to every open socket, plus a `live_session_updated` metadata frame after each event; no per-session subscription. `TAU/src/server/sessions.ts:574-591`, `:492-493`
- Reconnect = snapshot, not replay: WS connect sends only `{type:'state', liveSessions}`; the browser GETs `/api/live-sessions/:id/snapshot` (`pendingDialogs`, `interactionRevision`, `entries`, model, `isStreaming`); streaming deltas are not buffered; snapshot/WS races are resolved with monotonic `interactionRevision` ("Do not let an HTTP response overwrite newer WebSocket state"). `TAU/src/server/server-main.ts:884-888`, `TAU/src/server/sessions.ts:136-149,160-164`, `TAU/src/public/app-main.ts:1878-1900,1913-1921`
- Transcript owner: server memory array `entries` (pushed on `message_start`/`message_end`), seeded on resume by reading the whole JSONL; no cap. `TAU/src/server/sessions.ts:496-505`, `TAU/src/server/server-main.ts:524-534`
- Dialogs: only `confirm|select|input|editor` are retained in `pendingDialogs` with `createdAt/expiresAt` from pi's `timeout` ("Pi owns the actual timeout; this timer only expires Tau's live UI state"); included in snapshot so a refreshed browser sees the original deadline; `notify` passes through. `TAU/src/server/sessions.ts:181-203,450-453`
- Multi-browser answer: first reply wins — `pending.responding = true; // Claim synchronously before yielding to another browser.` then write to stdin; others get "Dialog response is already being delivered"; clients drop older revisions ("an older snapshot must never recreate a request another client answered"). `TAU/src/server/sessions.ts:315-342`, `TAU/src/public/app-main.ts:1046-1060`
- Browser absent: request waits server-side; pi RPC reports `hasUI === true` so "lack of a connected browser does not make it automatically deny". `TAU/.plans/active/debug-session-hang-and-unaborteable/plan.md:23`
- Idle definition: "Only agent_settled confirms completion after retries/compaction and queued continuations; neither turn_end nor agent_end establishes idle." `agent_start` bumps `operationRevision`. `TAU/src/server/sessions.ts:454-462`
- Abort state machine `idle|stopping|timed_out|failed`: write native `{type:'abort'}` first, then cancel all pending dialogs without waiting for the ack ("Never wait for its acknowledgement before releasing hooks whose extensions forgot to pass the turn signal"); late acks only clear `isStreaming` if `operationRevision` matches; while a stop is outstanding every new dialog is auto-cancelled ("approving anything while a stop is outstanding is never correct"). `TAU/src/server/sessions.ts:355-394,197-202`
- Root cause of their hang: the permission extension "awaited `ctx.ui.confirm(...)` without a timeout or cancellation signal"; pi's RPC abort "aborts the agent and then awaits idle, but RPC Abort does not resolve pending UI requests. The tool preflight hook is still awaiting the confirmation, so the turn cannot reach idle." Tau-side amplifiers: dialogs "not retained as pending server state or included in snapshots", abort "immediately displays 'Aborted by user'", "an Abort acknowledgement timeout is converted to success." `TAU/.plans/active/debug-session-hang-and-unaborteable/plan.md:19-33`
- Steering: the browser never sends `steer`/`follow_up`; prompts during a turn go into a client-side `messageQueue` flushed after `agent_settled`; queued prompts use HTTP (`/api/rpc`) "which silently drops a command when the socket is closed"; lost acks become "Delivery uncertain" with no retry; three review rounds chased ordering/lock/duplicate bugs. `TAU/src/public/app-main.ts:1325-1366,1433-1512`, `TAU/.plans/active/debug-session-hang-and-unaborteable/review.md:243-285,404-426,485-507`
- Crash/exit: `error`/`exit` → idempotent `handleExit` (clear dialogs, reject pending with `Pi process exited (<signal|code>)`, broadcast `live_session_closed`); no restart; stderr only to server console; terminate = SIGTERM, 1.5 s, SIGKILL; no idle reaping, no cap. `TAU/src/server/sessions.ts:228-229,539-566`, `TAU/src/server/server-main.ts:930-951`
- Resume: `POST /api/live-sessions/resume {filePath}` → `--session <abs path>` (never `--session-id`), coalesced via `pendingResumes`/`terminatingResumes` ("resume must not spawn while the old child is terminating"); listing walks `SESSIONS_DIR`, reads the `session` header `cwd` (never decodes the directory name), hides sessions with `userMessageCount <= 1 && lineCount <= 8`. `TAU/src/server/sessions.ts:609-645`, `TAU/src/server/server-main.ts:629-683,570-590`
- Tree navigation needs a bundled extension (`/tau-tree-navigate <entryId>` → `ctx.navigateTree`) because pi's RPC has only read-only `get_tree`/`get_entries`; it appends a `custom` marker entry so the leaf survives restart and verifies by re-reading `get_tree`; `get_commands` is checked once per child so missing-extension text cannot leak to the LLM. `TAU/src/server/tree.ts:1-34,179-191,262-288`, `TAU/src/pi-extension/tau-tree.ts:45-70`
- Model identity is two fields: `set_model {provider, modelId}` + `set_thinking_level {level}`; "Model strings are two separate fields — don't parse or split them"; an extension-driven model change is caught by `get_state` after every prompt/steer/follow_up ack. `TAU/AGENTS.md:370-382`, `TAU/src/server/server-main.ts:187-199,313-342`
- Auth: optional HTTP Basic + signed stateless cookie (12 h) because "iOS Safari (and the installed PWA) evicts cached Basic credentials when the user switches apps"; same-origin checks on `/api/*` and the upgrade. `TAU/src/server/auth.ts:1-50`, `TAU/src/server/server-main.ts:45-57,209-224,869-882`
- Session stats come from `get_session_stats` after `agent_settled` with a sequence number ("a slow stale response must never clobber fresh stats"). `TAU/src/public/session-stats-card.ts:1-11,139-149`

### pi-web

Analysis delegated to a subagent and spot-checked (`runner.go:60-85`, `broker.go:96-101` verified by direct read). Caveat: the chat surface was moved into external plugins on 2026-06-07; the prompt/steer/cancel handlers survive only in git history (`@796eee7^`).

- No pi pin: Go shells out to `pi --version` and compares with `https://pi.dev/api/latest-version`; pi on PATH only. `PIWEB/internal/piweb/backend/runtime/pi_version.go:12-53`, `PIWEB/internal/piweb/backend/runner/runner.go:62`
- One `pi --mode rpc` process per prompt, not per session: argv `--session <file> --mode rpc --append-system-prompt <fallbackChoiceSystemPrompt>`, `cmd.Dir = cwd`; write one prompt line, read until `agent_end`, close stdin, `Wait()`; concurrent prompt → `"session already running"`. `PIWEB/internal/piweb/backend/runner/runner.go:48-150,62-63,78-85,187-200`
- Framing: `bufio.NewReaderSize(pipe, 64*1024)` + `ReadString('\n')`; non-JSON stdout and all stderr forwarded to the browser as `tool.output` with `tool: "pi"`; no request ids in the prompt path; no prompt timeout. `PIWEB/internal/piweb/backend/runner/runner_events.go:137-153`, `runner.go:117-134`
- Transport is SSE: per-channel buffered Go chans (`buffer: 32`), global `nextID atomic.Uint64`, per-channel history ring (`historySize: 256`), 15 s heartbeat; replay from `Last-Event-ID`; frame `event:/id:/data:`. `PIWEB/internal/piweb/eventbus/broker.go:15-33,129-140,175-196`
- Fan-out is lossy by design: `select { case eventChannel <- event: default: }`. `PIWEB/internal/piweb/eventbus/broker.go:96-101`
- Secrets redacted at the broker boundary (api_key/token/secret/password, bearer, `sk-…`). `PIWEB/internal/piweb/eventbus/broker.go:83`, `PIWEB/internal/piweb/shared/redact.go:5-9`
- Transcript: in-memory `conversations` map plus pi's `.jsonl` re-parsed when the session dir mtime changes; only rename writes to the file (`session_info` line). `PIWEB/internal/piweb/backend/store/store_sessions.go:187-246,259-297`
- Extension dialogs are not forwarded at all: no `extension_ui_request/response` handling; instead a system prompt asks the model to emit a fenced `{"type":"piweb_choice",…}` block and "Stop after emitting the fallback block and wait for the user's follow-up"; the answer was sent as a new prompt. `PIWEB/internal/piweb/backend/runner/runner.go:14-32`, `PIWEB/src/pi-app/input/fallback-choices.ts@796eee7^:3-54`
- Crash/exit: `Setpgid: true`, cancel = SIGTERM to `-pid`; `Wait()` error → `error` event then `session.status idle`; no exit code, no restart, no reaping, no cap. `PIWEB/internal/piweb/backend/runner/process_unix.go:10-19`, `runner.go:135-147,265-276`
- Steer = second prompt line with `"streamingBehavior":"steer"` on the live process; no `follow_up`; `queue_update` events discarded. `runner.go:152-160,208-210`, `runner_events.go:41`
- Session dir encoding: `"--" + replace(/,\\,: → "-")(TrimLeft(cwd,"/\\")) + "--"`; new session = write a v3 header line to `<timestamp>_<uuid>.jsonl` then `--session <path>`; listing = recursive `WalkDir` + summary parse, cached by dir-tree max mtime; transcript paging reads backwards in 64 KiB chunks (default 120, max 500 messages). `PIWEB/internal/piweb/backend/sessions/pi_sessions.go:116-146`, `pi_session_summaries.go:14-90`, `pi_session_message_page.go:10-60`
- Remote model: binds `0.0.0.0:8732`, `Access-Control-Allow-Origin: *`, no auth; `--mock` swaps a scripted store and disables pi execution. `PIWEB/cmd/pi-web/cli.go:33`, `PIWEB/internal/piweb/backend/server/server.go:128-139`, `PIWEB/cmd/pi-web/server.go:54-67`
- Plugins: trusted JS from `~/.pi-web/plugins/<id>/plugin.json`, RxJS subject registry, DOM hook points, optional Node/Go backends invoked per call with JSON on stdin ("Core does not store chat sessions … or provide feature APIs for plugins"). `PIWEB/docs/plugins/README.md:24-166`, `PIWEB/internal/piweb/backend/server/plugin_backend_exec.go:18-72`

### Harness evidence

- **Harness design for long-running apps (Anthropic).** Three roles: planner ("took a simple 1-4 sentence prompt and expanded it into a full product spec"), generator, evaluator ("tested via Playwright"). V1 (Opus 4.5): 6 h, $200, sprint contracts; baseline solo run produced a game where "entities appeared on screen but nothing responded to input". V2 (Opus 4.6): "I removed the sprint construct entirely"; evaluator moved from per-sprint grading to "a single pass at the end of the run"; DAW built in 3 h 50 min for $124.70, build phase "2 hr 7 min". Self-review fails: agents "tend to respond by confidently praising the work—even when, to a human observer, the quality is obviously mediocre", whereas "tuning a standalone evaluator to be skeptical turns out to be far more tractable." `https://www.anthropic.com/engineering/harness-design-long-running-apps`
- **Effective harnesses for long-running agents (Anthropic).** Initializer agent + coding agent split. Failures: "A later agent instance would often look around, see that progress had been made, and declare the job done"; context exhaustion "leaving the next session to start with a feature half-implemented and undocumented"; Claude "would fail recognize that the feature didn't work end-to-end". Artifacts: a feature list in JSON with >200 features marked `"passes": false`, chosen because "the model is less likely to inappropriately change or overwrite JSON files compared to Markdown files"; `claude-progress.txt`; `init.sh` to "run the development server"; one git commit per feature. Session start protocol: read progress notes and git log, run "a basic test on the development server to catch any undocumented bugs", pick "a single feature". Browser automation (Puppeteer MCP) "to start a new chat, send a message, and receive a response" before implementing new features. `https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`
- **Scaling managed agents (Anthropic).** Three virtualized parts: session = "the append-only log of everything that happened", harness = "the loop that calls Claude and routes Claude's tool calls", sandbox = "an execution environment where Claude can run code and edit files", so "the implementation of each to be swapped without disturbing the others." Durable events: the harness "writes to the session with `emitEvent(id, event)` in order to keep a durable record"; on failure a new harness can "use `getSession(id)` to get back the event log, and resume from the last event"; the session is "a context object that lives outside Claude's context window" with `getEvents()` returning "positional slices of the event stream". Decoupling brains from containers: "our p50 TTFT dropped roughly 60% and p95 dropped over 90%". `https://www.anthropic.com/engineering/managed-agents`
- **Demystifying evals for AI agents (Anthropic).** Grader classes: code-based ("Fast, Cheap, Objective, Reproducible" but "Brittle to valid variations"), model-based ("Non-deterministic, More expensive than code, Requires calibration"), human ("Gold standard quality" but "Expensive, Slow"). pass@k ("at least one correct solution in k attempts") vs pass^k ("all k trials succeed"): "By k=10, they tell opposite stories: pass@k approaches 100% while pass^k falls to 0%." Record the transcript ("tool calls, reasoning, intermediate results") and the outcome ("The final state in the environment at the end of the trial"); "You won't know if your graders are working well unless you read the transcripts and grades from many trials." `https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents`
- **OpenAI "Harness engineering".** Not retrievable from the primary source in this session: `https://openai.com/index/harness-engineering/` returned HTTP 403 to WebFetch and curl and a Cloudflare "Verification successful. Waiting for openai.com to respond … Enable JavaScript and cookies to continue" interstitial that did not clear in `agent-browser` within ~70 s. No findings recorded; nothing substituted from secondary sources.
- **microsoft/playwright-mcp README.** Interaction model: "Uses Playwright's accessibility tree, not pixel-based input", "No vision models needed", "Deterministic tool application. Avoids ambiguity common with screenshot-based approaches." Profiles: persistent by default ("All the logged in information will be stored in the persistent profile"), `--isolated` loses storage state on close; "A persistent profile can only be used by one browser instance at a time, so concurrent MCP clients sharing the same workspace will conflict. To run several clients in parallel, start each additional client with `--isolated`." Headless idle timeout "Defaults to one hour for headless browsers, never for headed ones"; `--save-session`, `browser_start_tracing`, `browser_start_video`; `--caps vision|pdf|devtools|testing`. `https://github.com/microsoft/playwright-mcp`

### Implications for piano

- **`server/Worktrees.ts` parses a schema-2 subset without declaring it.** `listWorktrees` reads `items[].branch` and `items[].worktree.{path,main}` (`PIANO/server/Worktrees.ts:53-70`) which is schema 2, but never checks `schema === 2`; a user with `[list] json-schema = 1` gets a bare array, `parsed.items` is `undefined`, and the fallback silently reports the project root as the only worktree (`:68-69`). Assert `schema === 2` and surface the error. Also `branch ?? ""` hides the documented meaning of `null` (detached HEAD, `WTREF/list.md:276`); map it to a `detached` flag.
- **Worktree status is already free in the same call.** `wt list` without `--full` is local-only and returns `worktree.changes` (dirty/conflicted/diff), `worktree.operation`, `worktree.prunable`, `default_branch.{ahead,behind,integration,merge_conflicts}`, `display.state`, `upstream.{ahead,behind}` and `marker` (`WTREF/list.md:299-342`). `shared/wire.ts:120-125` (`WorktreeView` = branch/path/main) and `server/Views.ts:17-20` discard all of it. Extend `WorktreeView` with `state` (the nine `display.state` values), `changes`, `aheadBehind`, `marker`, keeping the absent/`null` distinction (`null` = "not determined" → render as `·`, absent = nothing to show, `WTREF/list.md:251-258`). Add `--no-progressive` explicitly since piano is not a TTY (`WTREF/list.md:520-525`).
- **`server/PullRequests.ts` duplicates what `wt list --full` returns, with a different vocabulary.** piano shells out to `gh pr view` per URL and folds `statusCheckRollup` into `none|pending|success|failure` and review into `none|approved|changes_requested|review_required` (`PIANO/server/PullRequests.ts:36-63`, `shared/wire.ts:178-188`). worktrunk's `checks.status` is `passed|running|failed` with `stale`, and `pr.review` is `changes_requested|pending|draft|approved` — and the docs state it "matches Claude Code's statusline `pr.review_state` field" (`WTREF/list.md:365-373,424-426`). For PRs that belong to a worktree branch, prefer `wt -C <project> list --full --format=json` (one call, 30–60 s cache, forge-agnostic: GitHub/GitLab/Gitea/Azure) and keep `gh` only for PR URLs mentioned in transcripts that are not the worktree's branch. Either way, align the wire literals on worktrunk's names so one `checks`/`review` renderer serves both.
- **Activity markers: piano should set them itself, from `SessionHosts`.** The Pi plugin keys markers by branch via `wt config state marker set` on `agent_start`/`agent_settled`/`session_shutdown` (`WTSRC/dev/pi-extension.ts:28-42`), but piano's children run in RPC mode and are retired after idle (`PIANO/server/SessionHosts.ts:109-121`) and killed on shutdown; a kill before `session_shutdown` leaves a stale 🤖 (`WTREF/claude-code.md:109`). (The `marker: "🤖"` observed on the piano repo is not evidence of this: this research session itself ran in that directory under Claude Code, whose worktrunk plugin sets the same marker.) Options: (a) rely on the extension and clear markers in `release` (`SessionHosts.ts:66-79`) with `wt -C <cwd> config state marker clear`; or (b) do not install the extension for piano-spawned children and drive the three commands from the `state` events the host already sees (`SessionHosts.ts:95-104`), which is the documented plugin-free path (`WTREF/claude-code.md:121-129`). (b) keeps one writer per branch; note two sessions in the same worktree share one marker (git config is per branch, `WTREF/config.md:1256`).
- **`createWorktree` should read the documented JSON fields and stop regex-matching errors.** `wt switch --format=json` returns `{action, branch, path, created_branch, base_branch, from_remote}` (`WTSRC/src/commands/worktree/switch.rs:1489-1537`); piano reads only `path`/`branch` and retries on `/already exists/i` (`PIANO/server/Worktrees.ts:85-102`). Use `action` (`created|existing|already_at`) to label the result in `worktree_created` (`shared/wire.ts:232`) and record `base_branch` in the registry entry. Hooks are skipped by default (`--no-hooks` unless `hooks: true`), which is right for an unattended server: with hooks on, an unapproved `.config/wt.toml` fails with "Cannot prompt for approval in non-interactive environment" (worktrunk skill, §Hook approvals); when the user ticks hooks, piano should surface that exact error and point to `wt config approvals add` rather than pass `-y` (it already passes `-y`, `Worktrees.ts:91` — that bypasses the approval gate for project hooks and should be dropped when `hooks` is true).
- **Removal and merge are missing from piano and have precise contracts.** A future `remove_worktree` action should run `wt -C <project> remove <branch|path> --format=json --foreground` so `branch_outcome` is `deleted|retained_*` rather than `deferred` (`WTREF/remove.md:73-75,97-111`), release the session host first (the `pi` child's cwd is the worktree; `--reap` would otherwise be the only way to find it, `WTREF/remove.md:77-93`), and show `retained_unmerged` as a choice to pass `-D`. A `merge_worktree` action maps to `wt -C <worktree> merge --format=json` (`-C` because merge takes no branch argument), whose result is `{branch, target, committed, squashed, rebased, removed}` (`WTSRC/src/commands/merge.rs:473-482`); a conflict leaves "the rebase left open in the worktree" (`WTREF/merge.md:68`), which the next `wt list` reports as `worktree.operation: "rebase"` — so the sidebar status above doubles as the conflict indicator. `pre-merge` hooks run after rebase and block (`WTREF/hook.md:29,34`), so merge must run off the WebSocket handler's critical path with its stdout/stderr streamed as a notice.
- **`Views.ts` existence check vs. prunable.** `existsSync(w.path)` (`PIANO/server/Views.ts:19`) hides a worktree whose directory is gone, while worktrunk still lists it as `worktree.prunable {reason}` (`WTREF/list.md:311`); showing it with a "prunable" state and a Remove action is more honest than silently dropping a registry entry.
- **`PiSessions`/`SessionHosts` vs. the two reference servers.** piano's design (one long-lived `pi --mode rpc` child per session, per-session `events` stream, snapshot on re-attach, dialogs retained, idle retirement from the session file) is the shape pi-tau-web-server converged on after its hang incident and avoids pi-web's process-per-prompt and prompt-engineered dialogs. Three concrete things to check in `PIANO/server/PiSessions.ts` against their findings: (1) `extension_ui_response` must not sit in the request/response map — pi never acks it (`TAU/src/server/sessions.ts:304-313`, `pi docs/rpc.md:48`); (2) idle must be keyed on `agent_settled` only, and `abort` must cancel retained dialogs immediately rather than after the ack, with an operation revision so a late ack cannot un-stream a newer turn (`TAU/src/server/sessions.ts:355-394,454-462`); (3) a second browser answering the same dialog must lose cleanly (claim before the first await, `TAU/src/server/sessions.ts:315-342`). The subagent did not read `PiSessions.ts`; verify rather than assume.
- **Reconnect replay.** piano re-attaches with "a full snapshot" (`PIANO/README.md` §Use 5). pi-web's monotonic event ids + `Last-Event-ID` ring (`PIWEB/internal/piweb/eventbus/broker.go:78-140`) and Herdr's rule that events "cannot be unconditionally replayed over a snapshot" plus an explicit `events_lost` error (`herdr-socket-api.mdx:118-126,794-799`) argue for adding a per-session sequence number to `SessionEvent` so the client can detect a gap and request a snapshot, instead of always paying for a full snapshot on every reconnect.
- **Secrets at the fan-out boundary.** pi-web redacts api keys/bearer tokens in every event before it reaches a browser (`PIWEB/internal/piweb/eventbus/broker.go:83`, `shared/redact.go:5-9`); Herdr keeps pane history off by default for the same reason (`HERDR/session-state.mdx:62`). piano has no auth and binds localhost (`PIANO/README.md` §Pi environment); a redaction pass in `server/PiRecords.ts` before `RenderMsg` is cheap insurance for tool output.
- **Herdr is a sibling, not a dependency.** Herdr's worktree methods call `git worktree` directly and "never deletes the branch" (`herdr-socket-api.mdx:342`), so they do not compose with `wt`'s naming/hook/removal model; and its Pi integration is TUI-only by design (`~/.pi/agent/extensions/herdr-agent-state.ts:229-233`). What is worth copying is the reporting discipline: a monotonically increasing `seq` on state reports so late reports cannot overwrite newer state (`HERDR/add-herdr-support.mdx:49`), latest-wins coalescing while a send is in flight (`herdr-agent-state.ts:149-177`), and `agent.prompt` with an embedded wait to avoid the prompt/wait race (`herdr-socket-api.mdx:114`) — the same race pi documents ("Subscribe before sending a prompt to avoid missing a fast completion", `pi docs/rpc.md:71`).
- **Verification practice from the harness papers.** The long-running-agent write-ups converged on a durable progress record outside the model's context (feature list JSON, progress file, `claude-progress.txt`) and on end-to-end browser checks before declaring a feature done; piano's AGENTS.md already demands `agent-browser` observation. A small addition in the same spirit: the `PIANO/server/Registry.ts` session entry could store the last `agent_settled` timestamp and last tool-error count so the sidebar can show "settled 3 min ago / 2 errors" without reopening the session file.
