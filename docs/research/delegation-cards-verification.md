# Delegation/result cards — implementation evidence

## Claim and scope

Piano retains validated pi-subagent tool/notification facts and renders meaningful,
correlated delegation and result disclosures. Pi remains authoritative; no live
subagent registry, widget parser, control API or deployment is added.

Implements the existing-data slice in [the event research](pi-subagent-events.md).
Preserves INV-01/03/05/11/12: history ownership, truthful outcomes, history/live
continuity, display redaction and the PiSessions translation boundary.

- Match tool arguments to details by tool-call ID, then outcomes by Run ID.
- Carry stable Subagent identity across resumed Runs.
- Terminal notification/result/wait/already-terminal cancellation facts update the
  matching delegation; a cancellation request or parent settlement does not.
- A mixed wait reports delivered and still-running counts, not a single completed Run.
- Historical admission alone says Started, never currently Running.
- Keep malformed/unknown details readable through the ordinary tool/message fallback.
- Preserve operation explanations, prompts, guidance and result content in disclosures.

## Environment and retained observations

Tested from `feat/delegation-cards`, based on `4d51155`, with the implementation diff
that accompanies this note; Node 24.19.0, installed Pi 1.0.4 and pi-subagent 1.0.5
source contract. Dependencies were shared with the main checkout.

A separate loopback backend/UI on 7171/7172 used a throwaway Git repository, registry,
agent directory and Pi-format history. `test/fake-delegation-pi.mjs` supplied
structured RPC messages; `npx agent-browser` drove the actual application in its
own browser session. No real registry or running user instance was changed.

Retained local evidence: `/tmp/piano-delegation-evidence/`.

- `final/commands.json`, `final/observations.json`, screenshots and snapshots:
  notification completion and wait failure correlate to the correct start/resume;
  cancellation request remains non-terminal; prompt/result disclosures work;
  malformed details remain readable; mixed wait retains its unresolved count.
- `final/live.png`: a live resume inherits historical profile/Subagent identity and
  both its delegation and notification display Cancelled after terminal delivery.
- Browser reload retains results without duplication. A 390px viewport has no
  horizontal page overflow. Browser error output was empty.
- `mixed-wait-red.log`: regression initially failed because the partial collection
  falsely took the delivered Run's identity. `projection-tests.log` records the fix.
- `tests.log`: **90 tests passed**. New PiSessions boundary tests cover exact-ID
  correlation despite equal labels, redaction, fallback, cancellation semantics,
  mixed waits, historical seeding and persisted live updates.
- `typecheck.log` and `lint.log`: **passed**.

Scratch processes and browser session were stopped and temporary fixture data removed.

## Review and limitations

Spec review found the mixed-wait defect described above; it was fixed with a
regression assertion and observed in the browser. Initial implementation review
also led to preserving operation text, seeding live correlation from history and
promoting delegation outcomes from terminal facts.

Concurrent main changes were incorporated before final checks, preserving file-link
context when rendering notification Markdown. A pre-existing NodeList spread that
failed typecheck was changed to equivalent `Array.from` in `Markdown.tsx`.

The browser journey used deterministic fake RPC, not a paid real subagent Run.
Combined runtime compatibility with pi-subagent's separate RPC widget change remains
unverified. No external bridge or widget text is required for these cards.

## Dot alignment regression

The delegation row omitted the `items-center` treatment added to ordinary tool
rows in `afc5c15`. The scratch-browser measurement reproduced a dot centre 5.859px
above its disclosure trigger before the fix. Applying the same alignment to the
card row reduced the maximum error across eight delegation/result/control/tool
rows to 0.016px on desktop (collapsed and expanded) and 0px at 390px width.

`test/browser-delegation-cards.mjs` now asserts a maximum 1px vertical difference
at each of those states. Screenshots, measurements and command output are retained
in `/tmp/piano-delegation-alignment/{before,after}/`; gate logs are alongside them.
Tested on main around `f79ffa8` plus this fix: browser journey, 90 tests, typecheck
and lint passed. Only scratch processes were used; no deployment occurred.
