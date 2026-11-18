# Phase 6 — Truthful Worktrunk discovery and creation

Date: 2026-10-05. Scope: [Phase 6](../vertical-slice-plan.md#phase-6--discovercreate-worktrees-without-false-health),
**INV-01, INV-06, INV-11**. This completes the discovery/create slice, not the later revision,
evidence, merge/remove or remote-access milestones.

## Claim and implementation

A project exposes actual Worktrunk observations or an explicit unknown/error/non-Git result.
Creating a new branch uses the returned checkout path/base branch and does not bypass hook approval.

- `server/Worktrees.ts` enforces **Worktrunk 0.80.0**, validates the schema-2 envelope and consumed
  fields, and requests `list --format=json --no-progressive` with schema 2 and full collection off.
  `PIANO_WT_CLI` optionally selects an executable, which must meet the same version contract.
  Unsupported/missing backends, malformed output and Git failures never become a healthy root-only
  list. Genuine non-Git directories remain usable for sessions. Broken `.git` metadata is an error.
- Observations retain detached/null HEAD, nullable/missing changes and operation facts, dirty flags,
  conflicts, locks and prunable state. Worktrunk's current checkout identifies a project opened through
  a subdirectory; the registry root is not invented as Git's primary checkout. These are timestamped
  observations, not revision identities or evidence. PR/check/LLM summaries are **not requested or shown**.
- `Views` preserves explicit registry selections and session references, including missing checkouts;
  stored branch names no longer masquerade as current facts. Discovery itself never registers
  checkouts or scans/registers external Pi sessions. No registry migration or transcript copy occurs.
- The directory picker's **Worktrees** dialog discovers, refreshes and explicitly selects a checkout,
  or creates a new branch. Creation/selection receipts are correlated to the requesting picker.
  Delayed receipts cannot select a directory in a newly mounted composer. Successful creation shows
  the returned base branch and whether hooks were enabled/skipped; it does not start a Pi session.
- Creation validates the entire structured `created` result. It never synthesizes a path, extracts a
  lucky JSON line from prose, retries an `already exists` error as another operation, or passes `--yes`.
  Hooks default off; enabling them uses Worktrunk's existing approvals. The UI retains failures and
  guides inspection/terminal approval. A failed foreground hook may leave a checkout: discovery
  reconciles it, but no success receipt or automatic registration is invented.
- HTTP/WS use the existing display-redaction projection. Output is rendered as text. Verification
  stayed on loopback with isolated configuration; no access or authentication policy changed.

## Evidence and environment

Tested base: `cf195b7508dfcff5adece44d666772c734ce32ce`, plus the complete implementation patch
(including new test/browser files). Patch SHA-256:
`5b19984f315b6a5cac526825dd2c76880559c066a36c4cc9aa61873f2780adc8`.
The patch excludes this evidence note and the plan's documentation update.

Retained packet: `/tmp/piano-phase6-evidence/` (machine-local, not durable CI artifact storage):
`manifest.json`, `implementation.patch`, CLI help/results, test/typecheck logs, and
`browser-final/{commands.json,process.log,result.json,*.txt,*.png}`.

Environment: Node **24.21.0**, Effect **4.0.0-rc.118**, Git **2.43.0**, Worktrunk **0.80.0**
at `/home/exedev/.local/bin/wt`, Vite **8.3.1**. Worktrunk binary SHA-256:
`1d2e89a512aa530613064aaadb92f78ad096baa6eaf44c46e4c4577302ed0e1c`.
Locked Pi remains **1.0.2**, CLI `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`.
The browser overrides it with `test/fake-pi.mjs`, no extra arguments; only cwd catalog probes
(`--mode rpc --no-session`) run. No model prompts or credits were used.

| Check | Observed result |
| --- | --- |
| `npm test` | **48 passed**, including three new Worktrees tests through the caller-facing functions and real view builder; `tests-final.txt`. |
| `npm run typecheck` | Server/shared and web passed; `typecheck-final.txt`. |
| `git diff --check` | Passed. |
| Real isolated `wt switch --create … --format=json --no-cd --no-hooks` | Exit 0; `creation.json` returns the configured `custom/…` path and `base_branch: main`. |
| Same isolated checkout, unapproved project hook enabled | Exit 1; `unapproved-stderr.txt` says it cannot prompt in a non-interactive environment. No hook run or new checkout. |
| `node test/browser-phase6.mjs /tmp/piano-phase6-evidence/browser-final` | Ten observations/assertion groups passed through `npx agent-browser`, scratch backend **7171** and Vite **7172**. |

The new regression checks protect previously uncovered consequential failures: schema/null/error
collapse, prose-based creation/approval bypass, custom-path identity, and partial lifecycle outcomes.
The real test also explicitly approves a known failing scratch hook: the hook runs and fails after
checkout creation, the adapter returns failure, and discovery finds the leftover checkout. It verifies
subdirectory identity, external detached/untracked state, missing-checkout session retention, and
that failed discovery cannot reuse registry branches as Git facts. Scratch HOME/XDG/Worktrunk config
and approval stores are separate from the user's setup.

Browser assertions and retained snapshots cover:

1. External detached checkout discovery without registration or session creation; explicit selection
   registers only that returned path.
2. Unapproved hook error remains in the dialog; no checkout appears. Explicitly disabling hooks then
   creates/selects the configured custom path, without executing the hook or starting a session.
3. A real external Git merge conflict plus untracked source appears as conflicts/dirty/merge in progress.
4. Controlled null CLI facts render **Changes unknown / Operation unknown**, never Clean.
5. Controlled backend outage removes the successful discovery list, shows actionable failure, and
   recovers on refresh. It is not represented as non-Git or a healthy root-only list.
6. External removal leaves the registered directory visibly missing rather than losing references.
7. A genuine non-Git project has explicit labeling and no creation form.

The unknown/outage browser cases use a wrapper around the real binary; they demonstrate wire/UI
handling, not an actual Worktrunk timeout or network outage. Real Git/Worktrunk covers creation,
custom configuration, hook approval/failure, detached state, merge conflict and removal observations.

Earlier retained attempts include a test-fixture correction (`git show-ref --verify` needs `--quiet`
for the expected missing-ref exit code) and two browser locator failures; neither is reported as a
passing gate. The final locator clicks the actual Radix/cmdk item. Browser review also improved the
error placement so failed creation scrolls its concise recovery message into view.

## Review, limits and handoff

Implementation review checked ownership (registry selections versus observed Git facts), complete
structured parsing, failure/partial-result handling, hook approval, and browser request correlation.
No new dependencies or changes to Pi's protocol/loading were needed. Existing runtime suites remain
in place. This is not a fresh combined certification of every Phase 0–5 scenario; their retained
evidence and stated startup/terminal-UI limitations still apply.

- Discovery is point-in-time and refresh driven, not a filesystem watch or exact snapshot. Refreshing
  and disconnected views label retained observations; a failed refresh clears facts rather than
  serving unlabeled cached health. Per-command deadlines/output limits bound backend failures.
- Creation supports **new branches only**. Existing discovered checkouts can be selected; creating a
  checkout for an existing branch without one is deliberately not inferred from error prose.
- Hook execution is not verification. Enabled hooks can run in the background; creation success does
  not assert their completion. Hooks remain trusted-developer shell execution, not a sandbox.
- Creation is not a durable job/deduplicated transaction. Disconnect/timeout invites discovery and
  inspection, never automatic replay. Durable lifecycle reconciliation belongs to later slices.
- Worktrunk observations run when project views refresh, including registry/session updates. Slow
  repositories can delay those updates; this slice adds no observation cache or progressive stream.
- No dependency/build/production-serving change required a build gate. **No build or deployment was
  performed.** Scratch processes were stopped by their own PIDs; scratch worktrees/branches and
  isolated session/config directories were removed. The real registry and running service were untouched.

To deploy this wire/UI change, build the UI, restart **`piano.service`**, and reload browsers together.
The proxy (`piano-web.service` / `piano-web.socket`) needs no restart. Those deployment steps have
**not** been performed.
