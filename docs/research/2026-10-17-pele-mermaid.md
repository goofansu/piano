# Pele versus Mermaid.js for Piano

Date: 2026-10-17. Research only; no dependency or runtime changes.

## Scope and recommendation

The request said “replacing Pele with mermaid.js” and linked Pele. Piano already uses Mermaid.js,
so this note evaluates **replacing Mermaid.js with Pele**, while recording the reverse trade-off.
Piano inspected at `1f98ac6ee29b06d2930ec942de21e64d99323eb6`; Pele inspected at
`458322a5b8abb1ae57ddf127c32017ab9fb14a92` (package version 1.6.0). [1][2]

**Recommendation: trial Pele behind the existing SVG-rendering boundary, but do not switch yet.**
Its dependency-free renderer and CSS-variable themes could simplify Piano's implementation.
Compatibility, readable layout and actual browser performance need evidence before replacing the
current renderer. Do not keep two production engines unless a demonstrated compatibility need
justifies their combined cost.

If the literal request was about another application moving **Pele → Mermaid.js**, the principal
benefit is using the canonical Mermaid implementation and its layout/configuration behavior;
the costs are giving up Pele's dependency-free package and synchronous rendering API. In Piano,
that direction requires no migration: Mermaid.js is already installed. [1][2][3]

## Current Piano contract

- `web/package.json` and the lockfile select Mermaid 12.2.0, not the older 12.1.0 recorded in the
  original rendering evidence. DOMPurify is a separate direct dependency. [1]
- `web/src/lib/mermaid.ts` serializes global initialization/rendering; selects light/dark themes;
  locks configuration against diagram overrides; disables HTML labels; limits source to 50,000
  characters and edges to 500; and sanitizes SVG, forbidding `foreignObject`, `image` and `a`. [1]
- `web/src/components/Markdown.tsx` lazy-loads rendering for closed Mermaid fences, keeps source
  available to copy, leaves invalid/oversized/failed diagrams as escaped code, rejects stale async
  results, isolates SVG in a shadow root and preserves natural-size local scrolling. Theme changes
  currently rerender diagrams. [1]
- Wide-diagram readability already caused a regression: fitting a long flow into the message width
  made it illegible. A renderer replacement must preserve readability, not merely produce SVG.
  Earlier browser scripts cited in the evidence note are historical, not available current tests.
  [4][5]

Applicable invariants: **INV-01** (render a projection; never rewrite Pi history), **INV-11**
(treat diagram source/output as untrusted), and **INV-09** (do not confuse upstream claims with
Piano verification). [6]

## What Pele offers—and what changes

| Area | Finding | Consequence for Piano |
| --- | --- | --- |
| Packaging | MIT, ESM, TypeScript declarations, Node >=20; no runtime dependencies declared. Full, core/per-type and lazy exports exist. [2][3] | Attractive dependency reduction. Keep DOMPurify; measure the actual Vite output rather than assuming savings. |
| API | `render(source, options)` synchronously returns SVG, width, height, type and links. `pele/lazy` offers `renderAsync`. [3] | Fits the current async SVG adapter; no Mermaid-style global initialize call or hidden DOM render container is needed. Dynamic imports can remain. |
| Coverage | Upstream claims every built-in Mermaid 12.1.0 diagram type, with parser-spec tests and differential fuzzing. External plugins such as ZenUML are unsupported. [3][7] | This is broad coverage, not proof of complete syntax/semantic parity, especially against Piano's 12.2.0. Identify 12.2-only inputs before switching. |
| Appearance | Different layout engine; Mermaid themes and `themeVariables` colors do not apply. Labels support SVG text, line breaks, bold and italic, not arbitrary HTML. [7] | Expect visual changes even when parsing succeeds. HTML-label exclusion already matches Piano policy. |
| Theming | CSS variables control colors/fonts; colors can change without rendering again. [3][8] | Map Piano theme tokens to Pele variables at the diagram host. Removing theme-triggered rerenders is a separate change requiring verification. |
| Width | Responsive shrinking is enabled by default; width-aware rendering may change direction below 640px. `responsive: false` and `autoDirection: false` are available. [3][7] | Start with fixed natural size and scrolling, preserving source direction. Responsive reflow/zoom should be a separate UX decision. |
| Mount lifecycle | `mount()` handles fonts, resizes and optional zoom; errors appear in the diagram container, potentially over a dimmed prior diagram. It requires `destroy()` cleanup. [3] | Prefer `render`/`renderAsync` initially. Mount's error presentation and DOM ownership do not match Piano's source-code fallback. |
| Security defaults | Links and images are enabled. Host controls can disable both. Defaults are 50,000 source characters, 4,000,000 SVG characters and 5,000 flowchart/agentflow edges. [9] | Explicitly disable links/images and retain Piano's 500-edge policy where supported. Do not inherit the more permissive defaults. |
| Performance | Synchronous rendering avoids an async render API, but still occupies the calling thread. Upstream recommends a terminable worker for time limits. [9][10] | Lazy loading is not background rendering. Large inputs can still affect responsiveness. |

### Security details worth preserving

Pele's docs explicitly make icon markup the application's responsibility: custom resolver output is
inserted without filtering. Do not supply an icon resolver in the initial trial. Do not wire returned
links into navigation; internal link targets are note names, not sanitized URLs. Keep final DOMPurify
sanitization and shadow-root CSS isolation. A shadow root is not a security sandbox. [9]

Frontmatter/directives override Pele's `options.config`; it is not equivalent to Mermaid's host
`secure` configuration. Source inspection confirms that parse limits come from host options and that
SVG output is checked **after rendering**. The output limit therefore does not bound all computation
or allocation. Test hostile directives/styles and resource-heavy inputs; do not claim a complete
security audit from this review. [9][10]

## Smallest useful trial

This is a proposed check, not work performed in this research.

1. Use an isolated scratch checkout; pin the evaluated Pele release. Change only the implementation
   behind the SVG adapter initially. Keep Markdown fence recognition, copy controls, cancellation,
   source fallback, DOMPurify and the shadow host unchanged.
2. Start with host-owned options such as:

   ```ts
   {
     links: false,
     images: false,
     limit: 50_000,
     maxEdges: 500,
     outputLimit: 4_000_000,
     responsive: false,
     autoDirection: false,
     idPrefix: uniqueDiagramId,
   }
   ```

   Do not pass source-supplied options/config or an icon resolver. Use one import entry point
   consistently. Preserve the asynchronous adapter contract even with synchronous rendering. [3][9]
3. Compare real browser output for flowchart, sequence, class, state, ER, Gantt, mindmap and any
   less-common types used in a consented fixture corpus. Include subgraph directions, Unicode/long
   labels, frontmatter, duplicate diagrams, malformed syntax, and any required 12.2 additions.
   Assert labels and relationships, not pixel parity between different layout engines.
4. Exercise streaming updates, reload, light/dark, copy-source, keyboard scrolling, mobile width,
   and the previously troublesome 12-step horizontal flow. Invalid input must remain readable code;
   stale results must not replace newer content. Check CSS-variable inheritance and sanitization
   together—upstream's raw SVG examples do not prove this integration works.
5. Exercise hostile labels/styles/directives, callbacks, links, image URLs and edge multiplication.
   Confirm no unwanted requests/navigation, host CSS leakage, or host-policy override. Check both
   source and output limits; record that flowchart/agentflow edge caps are not a universal CPU cap.
6. Compare production Vite chunks (compressed sizes and actual first-diagram transfers), cold
   import-to-display time, warm render latency and main-thread long tasks, using identical sources,
   fonts, browser and device conditions. Report failures as well as timings.
7. Only adopt if required diagrams remain semantically correct/readable, security and source-fallback
   contracts hold, and measured benefit warrants maintenance. Run normal typecheck/tests/lint and
   scratch-browser/style evidence for that implementation change. Remove obsolete Mermaid-specific
   overrides only after checking their other dependency consumers.

**Why no speed or bundle-size number here?** Pele's checked-in benchmark times flowchart examples
and generated graphs, optionally against `beautiful-mermaid`, **not Mermaid.js**. It prints its own
bundle size. That cannot establish a speedup or transfer-size saving for Piano's lazy-loaded,
sanitation-inclusive browser journey. No benchmark was executed for this note. [11]

## Research evidence and limits

Read upstream README, package metadata, API/compatibility/security docs, renderer source and benchmark
source from the cached checkout; fetched the public repository page. Reviewed local renderer,
Markdown component, dependency declarations/lockfile and prior evidence. No package installed,
prototype built, application changed, browser run, model call or deployment performed. External
claims are upstream claims unless explicitly described as source inspection. In particular, this
note does not certify full Mermaid compatibility, security, published-package contents or performance.

Documentation-only validation: source/citation review and `git diff --check`; runtime tests are not
needed for this note. Research environment: exe.dev VM `yejun-dev`.

## Sources

Upstream links are pinned to the inspected revision for reproducibility.

1. [Piano source at inspected revision](https://github.com/goofansu/piano/tree/1f98ac6ee29b06d2930ec942de21e64d99323eb6): `web/src/lib/mermaid.ts`, `web/src/components/Markdown.tsx`, `web/package.json`, `package-lock.json`, `package.json`.
2. [Pele package metadata](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/package.json).
3. [Pele API](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/website/src/content/docs/api.md) and [README](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/README.md).
4. [Piano's Mermaid rendering evidence](mermaid-rendering-verification.md).
5. [Current testing policy](../testing.md#browser-tests).
6. [Development invariants](../development-invariants.md).
7. [Pele compatibility](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/website/src/content/docs/compatibility.md).
8. [Pele theming](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/website/src/content/docs/theming.md).
9. [Pele security](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/website/src/content/docs/security.md).
10. [Pele core implementation](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/src/core.ts) and [types](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/src/types.ts).
11. [Pele benchmark](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/scripts/bench.mjs).
