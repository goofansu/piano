# Mermaid transcript rendering

Claim: closed `mermaid` fences render as diagrams in assistant replies and expanded skill Markdown.
Incomplete, invalid, oversized or failed renders retain escaped source; ordinary fences stay code.
History remains unchanged (INV-01); diagram content is untrusted (INV-11).

Implementation: lazy-load Mermaid, serialize its global configuration/rendering, lock host
configuration against diagram overrides, disable HTML labels and callbacks, sanitize generated SVG,
and isolate diagram CSS in a shadow root. Theme changes rerender diagrams. Temporary render containers
are removed on success/failure; stale async results cannot replace newer content.

## Evidence

Tested on Node v24.21.0, Mermaid 12.1.0 and DOMPurify 3.4.16, against base `394c4fc` plus this commit's
changes. Scratch backend/UI: loopback 7171/7172, fake Pi history, isolated registry/session directories,
zero model calls. No production deployment.

- `npm test`: 75 passed, including closed/incomplete fence eligibility, escaping and surrounding order.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite reports large chunks, including lazy-loaded Mermaid layouts.
- `node test/browser-mermaid.mjs /tmp/piano-mermaid-evidence`: passed. Real flowchart and sequence SVG,
  invalid/incomplete source, normal code, malicious labels/config/links, light/dark, mobile width,
  reload, and incremental updates through the production Markdown component.
- Browser command output, screenshots and observations: `/tmp/piano-mermaid-evidence`;
  suite/typecheck/build logs: `/tmp/piano-mermaid-{tests,types,build}.log`.
- Manual diff and screenshot review; `git diff --check` passed.

The first browser harness attempt failed on a Vite CommonJS default export; fixing the harness
allowed the incremental checks to run. Screenshot review then exposed blank labels when diagram
configuration enabled HTML labels: explicitly protecting `htmlLabels` fixed it, and the browser
regression now checks that the safe text label survives this override attempt.

Limits: browser coverage is representative, not every Mermaid diagram type. Incremental updates
are deterministic component updates rather than a live model stream. Expanded skill rendering shares
the component but was not separately exercised. HTML labels, external images and interactive links
are intentionally unsupported. npm audit reports eight high findings in the existing shadcn toolchain
and two low findings for Mermaid/its KaTeX dependency (prototype-pollution prerequisite); no unrelated
or breaking dependency upgrades were attempted.

## Wide-diagram readability follow-up

The user's 12-step horizontal flow exposed a missed case: Mermaid's responsive width plus our SVG
`max-width:100%` squeezed a 2,280px diagram into a 740px message. Preserve the SVG viewBox dimensions
at natural size instead; the existing focusable diagram host scrolls overflow without widening the
page. Sanitization and CSS isolation are unchanged (INV-11).

Tested base `dc5d860` plus this follow-up on the same Node/browser setup. The extended
`test/browser-mermaid.mjs` fails before the fix on the exact 740/2,280px shrinkage, then passes at
1440px and 390px viewport widths: natural SVG size, local overflow, keyboard scrolling from the
start, and the final label reachable at the end. Screenshots inspected at both widths. An initial
end-label assertion needed whitespace normalization because Mermaid wraps labels into SVG tspans.
`npm test` (75 passed), `npm run typecheck` and `git diff --check` passed.

Evidence: `/tmp/piano-mermaid-wide-{red,green}` (browser commands/screenshots/results),
`/tmp/piano-mermaid-wide-{red,green,tests,types}.log`. No new model calls or deployment.
