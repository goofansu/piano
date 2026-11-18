# Phase 3 — faithful and safely projected session output

Date: October 4, 2026. Implements [Phase 3](../vertical-slice-plan.md#phase-3--inspect-faithful-and-safely-projected-session-output).
Contracts: **INV-01, INV-03, INV-11–12**. This completes the supported text-display slice, not the
runtime milestone or credential containment. No dependency, registry migration or deployment change.

## Claim and implementation

The live display converges to Pi's authoritative message/model facts. Supported extension state is
visible, and known secret canaries/untrusted markup are not leaked or executed in the tested paths.

- `PiRecords` reconstructs blocks by content index, replaces `text_end`/`toolcall_end` content, and
  replaces the whole message on `message_end`. Usage updates are cumulative replacements, not sums.
- `PiSessions` reconciles `get_messages` at settled/compaction/handled-command boundaries. Readbacks
  raced by Pi output are retried (three attempts); unresolved churn or command failure is explicitly
  labeled. The chosen scope is **Current Pi context**, not raw history. System declarations,
  thinking and images are omitted; custom context and compaction/branch summaries are labeled.
- File peeks use `SessionManager.buildSessionContext()`, preserving Pi's active-branch, compaction and
  context-edit authority. Pi 1.0.2's context builder reports the last physical model, so the separate
  latest `model_change` supplies the **recorded selection** hint. This is not a second context builder
  or model/resource loader. A stopped-file hint cannot establish whether a virtual model remains
  available. The next CLI start restores/falls back itself unless the user explicitly overrides it.
- Running selection/effort is read back from Pi. Individual responses label the physical routed
  model/effort (and provider response-model metadata when supplied). Full-session tokens/cost come
  from Pi, not a sum of current-context messages. Read-only file peeks do not invent totals.
- Tool updates show the **latest update**, not an assumed append-only log; final output replaces it.
  Nested calls retain identity/parentage as execution previews, not extra transcript results or extra
  billable usage. Persisted `ok`/`error`/`unfinished` records map to success/error/incomplete. Pi does
  not persist nested result text. Incomplete executions cannot remain displayed as still running
  after settlement/exit. Pending text and execution previews are included in hosted snapshots.
- Status set/clear, string widgets/placement, title and editor requests are retained per child.
  Editor requests require **Append to draft**, never overwrite a local draft or send automatically.
  Widget placement is labeled in one extension panel, not arbitrary terminal-component rendering.
- Catalog requests/cache entries identify the selected cwd. Pi loads that directory's resources
  normally, including its trust policy; home is no longer presented as the project's catalog.
- `DisplayProjection` applies one rule to live output, snapshots, state, action errors/results and
  outbound HTTP/WebSocket values. It strips terminal controls and heuristically redacts secret-valued
  environment variables of at least eight characters, common token/bearer/assignment/private-key
  shapes. Known-secret suffix prefixes are withheld from cumulative streaming text. Pi records and
  history are not rewritten. Redacted select labels map back to the original private option only
  when unambiguous. Protocol debug logs now record types, not raw message content.
- Existing escaped Markdown and React text rendering remain the untrusted-content policy. No raw
  HTML renderer, credential loader, evidence registry or new public listener was introduced.

## Verification and provenance

Base: `beaad3d` plus the dirty implementation. Packet: **`/tmp/piano-phase3-evidence/`**, outside the
registry. `implementation.patch`, `input-sha256.txt` and `environment.txt` capture the tested source,
new files, base revision, tool versions and effective fixture CLI paths/arguments. VM-local packet
artifacts are not a durable product evidence store; the reproducible fixtures/assertions are committed.

Environment: Node `v24.21.0`, Pi `1.0.2`, Effect/platform-node `4.0.0-rc.118`, Worktrunk `0.80.0`
(not exercised), agent-browser `0.38.2`, Vite `8.3.1`. Fake protocol checks use
`test/fake-projection-pi.mjs`. Real checks load the locked CLI through credential-stripping scratch
shims, isolated HOME/agent/session storage, loopback-only endpoints and disabled cache warming.
Scratch `--approve` in the discovery fixture is **not** a production default. **Zero paid model calls.**

| Check | Observed result | Artifact |
| --- | --- | --- |
| Indexed-ending regression before implementation | Failed with `second draftfirst draft` instead of `first corrected second corrected`. | `red.txt` |
| First full baseline | Real-Pi queue check timed out. Identified overly broad generic-prefix redaction turning `working` into `workin[REDACTED]`; fixed generic prefixes without relaxing known-secret protection. | `tests-first.txt`, `real-queue-debug.txt`, `real-queue-fixed.txt` |
| `npm test` | **31 passed**, no failures/skips. | `tests.txt` |
| `npm run typecheck` | Passed server/shared/tests and browser. | `typecheck.txt` |
| `node test/browser-phase3.mjs …/browser-final` | Passed corrected partial/final text, partial/final reload, selected/routed labels, parent/nested output, extension set/clear and editor opt-in, compaction replacement, rejection redaction, inert malicious markup, no automatic resubmission. | `browser-final-run.txt`, `browser-final/result.json`, command log, six snapshots/screenshots |
| `git diff --check` | Passed. | `diff-check.txt` |

New checks exercise the public PiSessions, Catalog and file-peek interfaces, not assembler helpers.
They protect interleaved text/tool indexes, cumulative usage, clamped effort, split secret prefixes,
notices/errors/stderr, nested latest/final output, authoritative raced context readback, context edits,
virtual/physical selection and extension retention. A real SessionManager file proves compaction,
branch selection and context replacement without modifying original content. Real Pi proves that a
project-only virtual model is discovered only in its cwd and that its supported UI state/readback is
compatible. The existing real-Pi queue/dialog test still passes against the local synthetic provider.

No build was required for dependency/bundling/asset/serving changes (none were made). Browser checks
used scratch Vite source serving; the user's built UI was not rewritten. A production build remains
a separate deliberate deployment requirement.

## Review and remaining limits

Two manual implementation-review passes against repository standards and the Phase 3 contract;
**not independent sub-agent review**. No delegation tool was available. Review corrected persisted
nested status names from the installed type declarations, preserved recorded virtual selection where
Pi's context builder returns a physical model, kept native restore authoritative, handled redacted
select options without changing their protocol values, and labeled unfinished executions.
No remaining blocker was found within this supported Phase 3 scope.

- Redaction is heuristic, **not containment**. Unknown/encoded credentials, secrets distributed across
  unrelated fields/results and arbitrary tool-specific formats are not guaranteed safe. Generic
  prefix detection needs an identifiable prefix; known environment values have full suffix holding.
  False positives are possible. Pi retains original history and credentials.
- Browser reload while hosted retains previews/UI state; after process restart, Pi must reissue
  transient extension state. Persisted nested calls retain no output. Unhosted totals are unavailable.
- This text view is not the exact provider request after arbitrary request-local extension transforms,
  a raw-history browser, or TUI parity. Awaited startup dialogs/custom terminal UI remain unsupported.
- The new observation counter guards context readbacks, **not** client transport ordering. Full
  session/generation/sequence envelopes, slow-client bounds, selection races and historical replay
  policy remain Phase 5. Canonical host acquisition/release/retirement remain Phase 4. Retained preview
  volume is still subject to Phase 5's bounded-delivery work.
- No paid physical virtual-model routing, new provider/image capability, Worktrunk lifecycle change,
  public access or broader runtime-checkpoint acceptance is claimed.

## Cleanup and deployment

Only created scratch projects/registries were used. Browser, backend and Vite were stopped by their
owned PIDs; fixture Pi/MCP processes exited before storage removal. No worktrees were created; isolated
session directories were removed. Ports 7171/7172 are free. The real registry/services were untouched.

To use the changes, deliberately build the UI, restart **`piano.service`** after active Pi work finishes,
and reload browsers so server/shared wire and client match. No `piano-web` proxy restart is needed.
**Build, production restart and deployment were not performed.**
