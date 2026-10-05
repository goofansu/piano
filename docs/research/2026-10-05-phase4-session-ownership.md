# Phase 4 — Canonical server-owned execution

Date: 2026-10-05. Implements the [Phase 4 slice](../vertical-slice-plan.md#phase-4--keep-one-canonical-server-owned-execution),
not completion of the runtime milestone. **INV-01–04**, with a focused **INV-12** locked-CLI check.

## Claim and implementation

Within one Piano backend, concurrent tabs and real/symlink aliases share one child for a canonical
checkout/session identity. Browser detachment does not own acquisition, actions or shutdown.
Retirement requires observed quiescence; reopening history never replays interrupted work.

- `SessionHosts` serializes lifecycle operations per realpath/session key. Acquisition belongs to the
  backend scope, not the opening socket. Ownership remains held until the child scope finishes
  shutdown. Unrelated sessions remain usable during a blocked shutdown. Late exit events can retire
  only their own incarnation.
- Action admission competes with retirement under the same lock, but command acknowledgement does
  not hold that lock: another tab can still answer a blocking dialog. Pending actions, requests,
  unprocessed records, dialogs, queue, retries, compaction and uncertain delivery prevent idle retirement.
  A newer handled input cannot erase an older command's delivery uncertainty.
- Release keeps the registration and Pi history. Archive/delete stop the child and update retention
  under the lifecycle lock. Ordinary reopen requires an active registration, so stale tabs cannot
  resurrect archived/deleted sessions. New server-generated IDs explicitly create registrations.
- `PiSessions` keeps bounded command deadlines and drains protocol events independently of state,
  context and usage readbacks. Event-triggered readbacks are coalesced by kind. Failed state/stat
  observations produce an actionable, retained warning instead of silently stale details. Shutdown
  closes stdin, allows three seconds for exit, then escalates termination with a one-second force-kill
  grace; ownership is not released merely because shutdown was requested.
- Crash causes survive browser reload/file peeks in backend memory. Get/peek/open reconcile an exited
  child even when the caller beats the host's event watcher. The UI explains that interrupted operations
  are not resumed. Disappearing hosts no longer acquire a completed-turn badge.

### Alias policy: no history migration

Only the execution key is canonicalized. Existing registry cwd/session references and Pi files are
not renamed, merged, rewritten or copied. A request through another spelling resolves to the original
registered reference. Lookup checks that reference, the requested path and its realpath. An existing
file is passed to normal Pi CLI `--session <file>`; readiness must confirm the requested session ID.

Multiple registered references for the same canonical identity, or distinct Pi files with the same
identity, are explicit conflicts. Piano preserves them and refuses to choose a writer. Resolving a
conflict is an explicit owner recovery task, not an automatic migration. No registry schema migration
was needed; `RegistryPath` permits isolated persistence checks with the real registry implementation.

## Verification retained

Local packet: `/tmp/piano-phase4-evidence/`. These artifacts are machine-local, not registry data.
Reproduction scripts and assertions are committed with this report.

| Check | Observation | Retained output |
| --- | --- | --- |
| Original concurrent-open regression | Eight startup log lines for the same session through two path spellings; assertion failed. The old runner needed the 30-second command timeout; source inspection found overwritten child scopes. | `red-hosts.txt` |
| Immediate post-crash file peek | Full-suite run caught a missing exit reason when peek beat the watcher. Get/peek now reconcile the child's authoritative closed state under ownership. Same assertion passes without waiting for watcher internals. | `red-immediate-crash-peek.txt`, `tests-final.txt` |
| Public host contracts | Eight concurrent opens → one spawn/exit; abandoned opener survives; blocked shutdown → exit before replacement spawn; archive and delete reject racing opens; old alias file preserved; reference/file conflicts rejected. | `test/SessionHosts.test.ts`, `tests-final.txt` |
| Controlled idle/readback checks | Queue, retry, compaction, idle dialog and older uncertain command remain hosted past deadline; genuinely quiescent child retires. A dialog and text behind withheld state/stats arrive before advancing the deadline; timeout becomes visible, then crash/file reopen does not replay prompts. | `tests-final.txt` |
| Locked Pi 1.0.2 | Normal CLI reopens an old alias-header file by exact path, returns its original history and file identity, and leaves the registry cwd intact; zero model requests. | `test/RealPiOwnership.test.ts`, `real-ownership.txt`, `tests-final.txt` |
| Scratch public WebSocket/browser journey | Concurrent opens through real/symlink paths share one child. Leave all browser observers, return from two tabs, reconnect socket: one execution and no prompt replay. Withheld readbacks surface a warning while a later dialog remains visible. Crash, reload history with interruption explanation, then explicit new input starts a new child. Pointer-menu archive rejects a stale tab's new prompt. | `browser-final.txt`, `browser-final/result.json`, `browser-final/browser-commands.json`, screenshots/snapshots and `host-audit.jsonl` |
| Required gates | `npm test`: **41 passed**. `npm run typecheck`: server and web passed. `git diff --check`: passed. | `tests-final.txt`, `typecheck-final.txt` |

The projection regression checks still assert the same exact usage/context values. Their synchronization
now observes both the fixture marker and the relevant host projection: a later Pi notification is no
longer an ordering barrier for asynchronous readbacks. The old assumption failed at the compaction
assertion (`projection-barrier-before.txt`); it was replaced with an installed-before-action event
barrier, not a sleep or weaker expected result. The first browser attempt also exposed a fixture boot
race (Vite ready before backend); the script now checks both listeners before opening sockets.

### Tested inputs and environment

- Base commit: `50501c1964fb22c76bcd7eceed34a08f9ee41991` plus the implementation in this commit.
- Source/fixture/dependency input manifest: `source-inputs.sha256`; SHA-256
  `e6d4cb7d5fbdda889dc5c36d5ef84bf34caf28fb6bf6dc5b21a0944cb08842d7`.
  Documentation is outside that manifest. `implementation.patch` includes added implementation/test
  files as well as tracked edits; its digest and outcomes are in `verification.json`.
- Node **24.21.0**, Effect/platform-node **4.0.0-rc.118**, installed/locked Pi **1.0.2**,
  Worktrunk **0.80.0** (version observation only), agent-browser **0.38.2**.
- Browser CLI: `test/fake-host-pi.mjs`, Node `--mode rpc`, explicit audit path and isolated session
  directory. Real check: installed `node_modules/@earendil-works/pi-coding-agent/dist/cli.js` via the
  credential-stripping compatibility shim, scratch-only `--offline --approve`, normal resource loading.
- Browser targets: scratch backend **127.0.0.1:7171** and Vite **127.0.0.1:7172**, separate scratch Git
  project, registry, HOME and Pi storage. Only owned PIDs were stopped; fake children were confirmed
  exited before storage removal. No worktrees or production Pi session files were created. No paid calls.
- Self-review covered lock scope, cancellation, failure cleanup, reference preservation, late exits,
  stale readbacks and UI completion semantics. This is not a separate independent reviewer verdict.

## Limits and operations

- Ownership is within one backend, not an inter-process lock against a second Piano backend or an
  external Pi/TUI writer. Live filesystem replacement/retargeting is not an execution-isolation promise.
- Exit diagnostics are retained for this backend lifetime, not persisted across backend restart.
  Pi remains the only transcript authority. No interrupted shell/process is reconstructed or replayed.
- Unknown delivery conservatively prevents automatic retirement for that child; it is not inferred
  safe merely because a later command succeeds. Explicit lifecycle shutdown remains available.
- Known alias references and their physical checkout are checked, not every possible unregistered
  alias on disk. General registry recovery/versioned migrations remain Phase 7. Startup/custom UI
  limitations from Phases 0–2 remain unchanged.
- Phase 5 ordering/gap/slow-client guarantees and Phase 6 Worktrunk compatibility are still open.
  This check does not certify the entire runtime milestone or unrestricted descendant-process recovery.

**Deployment:** not requested and not performed. No production build was run. To activate this change,
build the UI, restart **`piano.service`**, then deliberately reload browsers. No proxy/socket restart or
new dependency installation is required. The user's services and real registry were left untouched.
