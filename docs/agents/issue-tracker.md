# Issue tracker

Linear is Piano’s shared issue tracker. Look up a ticket by its `PIN-…` identifier or Linear URL.
Read its description and comments for the spec, decisions, and latest findings.

## Publishing work

When asked to publish a finding or spec, update the matching Linear issue or create one in the
Piano team. Keep the shared spec on the issue or link it from there. Record follow-up findings
in comments and use the issue’s assignee and workflow status for handoffs.

## Local wayfinding notes

`/wayfinder` keeps a checkout-local map and child notes in the gitignored `.scratch/<effort>/`.
For work tracked in Linear, link the issue from the map and record decisions other contributors need on the issue.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child note**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the kind of work (`research`/`prototype`/`grilling`/`task`) and a `Status:` line records local progress (`claimed`/`resolved`).
- **Blocking**: a `Blocked by: NN, NN` line near the top. A note is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
