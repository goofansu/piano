# Live Composer context usage fix

## Claim and diagnosis (INV-03 / INV-12)

Composer must receive Pi's latest canonical context estimate during an active run, not
only after `agent_settled`. This means finalized-message boundaries during multi-step
runs, **not token-by-token growth**.

Inspected installed Pi Coding Agent **1.0.2** documentation in full: README, RPC,
RPC commands, JSON events, message types, SDK, CLI, CLI integration, extension UI,
session format, sessions, and compaction. Relevant installed source:

- `dist/modes/rpc/rpc-mode.js:466`: `get_session_stats` directly calls
  `session.getSessionStats()`. No `get_context_usage` RPC command exists in the
  installed command handler or exported `rpc-types.d.ts`.
- `dist/core/agent-session.js:3345–3440`: stats aggregate persisted entries;
  `getContextUsage()` uses `SessionManager.buildSessionProjection()`, the active
  branch, and Pi's own context estimation. After compaction it returns null
  tokens/percent until valid post-compaction assistant usage exists.
- `dist/core/agent-session.js:734–754`: finalized messages are publicly emitted
  then synchronously appended to SessionManager. A subsequent stdin stats request
  observes persistence; no character-count reconstruction is needed in Piano.
- `docs/json.md`: `message_update.usage` is cumulative usage for one response,
  may remain zero until completion, and is not the canonical session projection.
- `docs/rpc-commands.md#get_session_stats`: canonical context estimate is exposed
  through stats, can be absent without a model/window, and can contain null values.

The defect was `server/PiSessions.ts` refreshing stats only on open and settlement.
Composer already renders the state projection. The fix adds refreshes on finalized
messages, compaction completion, and successful model selection. It preserves the
initial and settled refreshes and best-effort rejection handling. Requests are
bounded by these boundaries, not deltas/tokens; protocol stays inside PiSessions.
Git and registry behavior are unchanged.

## Regression and evidence

Checkout: `/home/exedev/piano`, base HEAD
`17402c3e02bdecf8cb423e71ef07a38978d7397b`, dirty working tree including the
pre-existing Composer/NewSession edits. File hashes retained in
`/tmp/piano-context-evidence/revision.sha256`; Node version in `environment.txt`.

Public PiSessions regression uses a fake finalized response followed by an explicit
dialog pause while still streaming, then successful compaction and another pause.
No model calls, sleeps, private-helper tests, or registry data are involved in these
new tests. Subscription readiness is synchronized through snapshot events.

- `node --test --test-name-pattern='canonical context|model switch refreshes' test/PiSessions.test.ts`
  before fix: **2 failed**, specifically missing the running 42000-token state and
  retaining 200000 rather than 400000 on model selection (`red.txt`).
- Same focused command after fix: **2 passed** (`green.txt`).
- Final `npm test`: **7 passed, 0 failed** (`tests.txt`).
- Final `npm run typecheck`: **exit 0** (`typecheck.txt`).
- `npm run build`: **exit 0**, existing large-chunk warning (`build.txt`).
- `git diff --check`: **exit 0**.

All artifact names above are under `/tmp/piano-context-evidence/`.

## Browser observation

Built app on `127.0.0.1:7171`, scratch registry `config.json`, scratch Git directory
`/tmp/piano-context-evidence/repo`, CLI override `/home/exedev/piano/test/fake-pi.mjs`.
Named agent-browser session `piano-context`; directory chosen via pointer-clicked
picker, first prompt `live context`, then answered the first pause with `continue`.

- `browser-live-dom.txt`: response read back as `echo: live context`; Composer
  **42,000 tokens**, **Working**, and **Stop** button present simultaneously.
- `browser-compacted-dom.txt`: Composer **200k context** (unknown token count),
  **Working**, and **Stop** still present after compaction; no stale 42000 count.
- Screenshots: `live.png`, `compacted.png`; accessibility output:
  `browser-running.txt`. Dialogs intentionally pause the fixture, so underlying
  Composer evidence was captured with read-only DOM inspection through agent-browser.

Stopped only the scratch server PID, closed the named browser, removed the scratch
repo and its empty Pi session directory. The user's port 7070/registry was untouched.
Initial browser navigation raced server startup (connection refused); retry succeeded.
A stale picker reference also failed after the picker had already closed; fresh
snapshot confirmed the chosen scratch path before prompt submission.

## Limits

This is source/contract inspection plus deterministic fake-Pi runtime/browser evidence,
not a credentialed real-provider smoke test. No token-streaming accuracy is claimed:
Pi's canonical projection excludes the partial response, and its context value is
itself an estimate where Pi adds finalized content since the last valid usage anchor.
Piano does not recreate that estimator or combine partial usage with it. Very fast
boundaries may return a newer projection rather than every intermediate value.
Existing request transport/lifecycle limitations are not expanded into this fix.
Pre-existing mobile-enter edits and research note were preserved unchanged.
