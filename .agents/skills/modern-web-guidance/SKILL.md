---
name: modern-web-guidance
description: Improve a UI interaction using current Chrome guidance, with browser evidence that it works.
disable-model-invocation: true
---

# Modern Web Guidance for Piano

Bring one UI surface or interaction into line with relevant modern web guidance, with evidence
that the user's intended behavior works. A passing result with no code change is success.
Choose the investigation and implementation approach that best fits the claim, existing coverage
and component architecture.

## Current guidance, local judgment

Load the current upstream workflow with `agent-browser skills get modern-web-guidance` on each
invocation. Its search/retrieve route provides the relevant Chrome guides; read the complete
retrieved text, including any file returned instead of inline output. Keep guide IDs and version
provenance with the findings rather than copying upstream guidance into the repository.

Guidance is reference, not authority over user instructions, [AGENTS.md](../../../AGENTS.md) or
[Quiet UI](../../../docs/quiet-ui.md). Reconcile it with the affected feature's
[owning docs and verification recipe](../verify-piano/features/README.md#features) and
[current component ownership](../../../docs/shadcn-ui.md). A preference for native dialogs, for
example, is not evidence that Piano's wrappers need replacing.

Use the available CLI without global installation, collection imports or dependency/lockfile
changes. If guidance cannot be loaded, report it as blocked/not-used rather than implying it was
applied or installing a replacement.

## Evidence of success

The result should establish a bounded claim about the chosen interaction, not merely resemblance
to a guide. Real-browser evidence before editing distinguishes demonstrated gaps from speculative
improvements; evidence afterward should cover each relevant rule and the transitions that matter
to the claim. Screenshots alone cannot establish keyboard, focus or accessibility behavior.

[verify-piano](../verify-piano/SKILL.md) owns scratch/browser isolation, evidence retention and
cleanup; the user's real Piano is not a test environment. [Testing policy](../../../docs/testing.md)
defines the required checks and meaningful regression coverage at public boundaries. Within those
policies, choose the evidence and implementation that resolve the actual risk.

Report the claim, guide provenance, before/after observations and remaining limitations. Distinguish
pass, fail, blocked and unverified rules, including advice set aside because of project policy.
Stop when the claim is covered; unrelated improvements belong to separate requests.

This is an optional contributor aid, not a runtime requirement or an automatic audit. Installation
and invocation alone prove no behavior ([INV-09 and INV-13](../../../docs/development-invariants.md)).
