---
name: modern-web-guidance
description: Find a worthwhile UI improvement and prove it works, guided by current web standards.
disable-model-invocation: true
---

# Modern Web Guidance for Piano

Help the user make a chosen part of Piano easier to use, more stable or more accessible, with
browser evidence of the result. The goal is a better experience, not newer APIs for their own
sake. A passing result with no code change is success.

## Help the user choose an outcome

Users need not know web standards, guide names or technical acceptance criteria. Start from what
they want to do and what feels difficult. Use the conversation's existing target when it is clear.
When it is not, ask which screen or task matters and help them identify a useful direction before
editing; do not select an arbitrary component or launch a whole-app audit.

Offer a few relevant possibilities in everyday language, grounded in the user's context, such as:

- A dialog that works predictably with the keyboard and returns you to where you started.
- Content that stays in place while loading instead of jumping under your pointer.
- Motion that respects people who prefer less animation.
- Controls that remain readable and usable in light and dark themes.

These are examples, not a mandatory checklist. Explain the likely benefit and any tradeoff; treat
suspected problems as hypotheses until observed. If several directions are plausible, let the user
choose. Translate the chosen goal into one surface or interaction and an observable success
condition, without asking the user to design the technical solution.

## Current guidance, local judgment

Load the current upstream workflow with `agent-browser skills get modern-web-guidance` on each
invocation. Its search/retrieve route provides the relevant Chrome guides; read the complete
retrieved text, including any file returned instead of inline output. Keep guide IDs and version
provenance with the findings rather than copying upstream guidance into the repository.

Choose the investigation and implementation that best fit the outcome, existing coverage and
architecture. Guidance is reference, not authority over user instructions,
[AGENTS.md](../../../AGENTS.md) or [Quiet UI](../../../docs/quiet-ui.md). Reconcile it with the
[feature's owning docs and verification recipe](../verify-piano/map.md#features) and
[current component ownership](../../../docs/shadcn-ui.md). A preference for native dialogs, for
example, is not evidence that Piano's wrappers need replacing.

Use the available CLI without global installation, collection imports or dependency/lockfile
changes. If guidance cannot be loaded, report it as blocked/not-used rather than implying it was
applied or installing a replacement.

## Evidence of success

Real-browser evidence before editing distinguishes demonstrated gaps from speculative improvements.
Fix only those gaps within the chosen outcome. Evidence afterward should cover each relevant rule
and the transitions that matter to the claim; screenshots alone cannot establish keyboard, focus
or accessibility behavior.

[verify-piano](../verify-piano/SKILL.md) owns scratch/browser isolation, evidence retention and
cleanup; the user's real Piano is not a test environment. [Testing policy](../../../docs/testing.md)
defines required checks and meaningful regression coverage at public boundaries. Within those
policies, choose the evidence that resolves the actual risk.

Explain what now works for the user, what was already working and what remains uncertain, supported
by guide provenance and before/after observations. Distinguish pass, fail, blocked and unverified
rules, including advice set aside because of project policy. Stop when the outcome is covered;
unrelated improvements belong to separate requests.

This is an optional contributor aid, not a runtime requirement or an automatic audit. Installation
and invocation alone prove no behavior ([INV-09 and INV-13](../../../docs/development-invariants.md)).
