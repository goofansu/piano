# shadcn CodeBlock for Changes and the transcript

Research date: 2026-10-29. Piano inspected at `0da04f191889bdea2608ccf8e6e5850e8fc85981`
with a clean working tree. Source/documentation review only; no component installed or browser
prototype run. Commands ran on the exe.dev Linux workspace with Node `v24.22.1` and
`npx shadcn@latest` resolving to `4.23.0`.

## Recommendation

**Changes: keep the specialized renderer.** CodeBlock is a presentation primitive, not a Git
diff viewer. Its one line counter cannot carry old/new positions, and it has no large-diff
chunking, so a `PianoDiff` adapter would rebuild both gutters, the marks between them and the
500-row blocks: about the ~110 lines of `Hunks` / `DiffRowView` it would replace, now working
against a stock component. What it would add (gutters and marks excluded from a selection,
keyboard scrolling, `dir="ltr"`) the current table already has or gains with `tabIndex={0}`
and `dir="ltr"` on its scroll container. Do not use `CodeBlockContent lineNumbers` for diffs:
those numbers are patch-row numbers, not source locations. [S1–S3, S6]

**Transcript: adopt for Markdown code fences only if syntax highlighting is wanted.** Fences
are what CodeBlock is designed for, and with `useHighlightedCode` they gain highlighting the
transcript lacks today. Without highlighting the gain is again two attributes and a focus style
on the existing `<pre>`, too little for a new component, two generated files and a style review.
Tool arguments may follow in the same pass; tool output and the other plain-text `<pre>`s should
stay as they are. See [Transcript](#transcript). [S2, S12]

The sections below on Changes describe the adapter that would be needed if that recommendation
is revisited.

## What upstream actually supplies

The pasted documentation matches the current official Radix documentation. Piano uses
**Radix Vega**, not the Rhea preview style, so the project-specific registry output is the
relevant implementation. The CLI finds `@shadcn/code-block`; it is not installed in Piano. [S1, S2, S5]

| Requirement | Upstream behavior | Consequence for Changes |
| --- | --- | --- |
| Added/removed rows | `CodeBlockLine variant="added"` / `"removed"`; generated `+` / `−` marks | Map `add` → `added`, `del` → `removed`, `context` → `default`. Pass `line.text`, not a prefixed patch line, to avoid duplicate marks. |
| Old/new line numbers | One CSS counter, incremented for each numbered row; `startLine` initializes that counter | Keep custom gutters from `DiffLine.old` / `.new`. A deletion must not advance the new side, an addition must not advance the old side, and each hunk can jump. |
| Hunk and metadata rows | No Git-specific model or slots | Preserve `@@ … @@` and `\ No newline at end of file` explicitly; do not number them as source lines. |
| Wrapping and keyboard scrolling | `pre > code`, `dir="ltr"`, `tabIndex={0}`, `wrap`, overflow scrolling | Useful standard behavior; connect the existing wrap preference and retain one coherent scrolling surface per file. |
| Selection | Generated numbers/marks use `select-none`; empty lines render a newline | Promising improvement, but custom gutters and block boundaries need actual clipboard checks. |
| Colors and density | Vega additions use neutral `bg-muted`; removals use `bg-destructive/10`; small size is `text-xs` | Not identical to Piano's green/red rows and `leading-5`. Put deliberate differences in Piano wrappers/tokens, never patch upstream. |
| Large output | Plain string children can render as one text node; explicit lines create individual elements | Changes needs explicit lines. Neither this path nor streaming token caching supplies virtualization/content-visibility chunking. |
| Diff computation | No patch parser, file metadata, fetching or comparison logic | Retain `diff.ts` and the existing Changes observation/view model. |

Sources: upstream component source [S2], API/accessibility documentation [S1], current renderer
and parsed line model [S3]. A separate block per hunk with `startLine` still cannot implement
both old/new counters correctly.

## Current behavior that must survive

`parseUnifiedDiff` already supplies file status, binary flags, mode notes, raw patches, hunks,
and separate old/new positions. The renderer calculates gutter width from the largest position,
shows hunk headers and no-newline metadata, and leaves the inapplicable side blank. Its
`lineBlocks` groups at most **500 rows** per `lazy-lines` block so offscreen layout can be skipped;
this is not DOM virtualization. The unwrapped layout shares the widest width across blocks.
[ S3, S6 ]

`LiveFile` fetches a patch when expanded and retains the loaded result until a fresh observation
remounts it. `changesView.ts` handles large-file opening, partial patches and the provenance used
by Ask. A rendering migration must not discard those policies or turn a partial preview into
an apparently complete file. [S3, S4]

This preserves **INV-01** (Git owns repository facts), **INV-07** (workspace-scoped observations)
and the distinction between live observations and content identity in **INV-08**. This research
establishes API fit, not runtime success (**INV-09**). [S7]

## Changes: integration shape if revisited

Proposed, not implemented:

1. Install the project-configured component through the CLI after reviewing all generated files.
   Keep `ui/code-block.tsx` upstream-owned. Add exact Biome exclusions for the generated hook
   and highlighter if retained, as required by the ownership guide. [S8]
2. Create `web/src/components/PianoDiff.tsx`, taking the existing `DiffFile` and wrap value.
   Compose `CodeBlock size="sm"`, `CodeBlockContent` with **`lineNumbers={false}`**, and
   `CodeBlockLine` variants. Do not add a second file title or an inner card-like header.
3. Supply Piano-owned old/new gutter markup with fixed shared widths, top alignment under
   wrapping, nonselectable numbers and suitable accessibility semantics. The upstream line
   wraps children in `code-block-line-content`, and its marker is an absolutely positioned
   pseudo-element at the start of the line. The adapter must account for both: simply prepending
   numbers will not position a marker between the gutters and the code. Keep this customization
   in the wrapper and inspect it against generated source. [S2]
4. Preserve hunk/meta text, blank rows and the current large-diff layout skipping. Use valid
   phrasing markup inside `pre > code`; do not transplant the existing tables into it. Confirm
   shared widths and selection across chunks before removing `Hunks` / `DiffRowView`.
5. Keep existing Changes controls. Do not add Copy, Wrap or Show more per hunk: the screen
   already has file disclosure and a wrap control. This first slice adds no new user-facing
   strings or actions, only a different presentation and keyboard-focusable diff content.

**Stop condition:** if preserving the two gutters and chunked layout needs invasive slot/CSS
rewrites that recreate the current renderer, keep the specialized renderer. A component with
`added`/`removed` variants does not make Git's numbering model a standard supplied feature.
Update the old “no shadcn component renders a unified diff” comment to name the actual gap
if that renderer is retained. [S2, S3]

## Dependencies, highlighting and copy semantics

The observed `add code-block --dry-run` proposed:

- create `src/components/ui/code-block.tsx`;
- create `src/hooks/use-highlighted-code.ts`;
- create `src/lib/highlighter.tsx`;
- skip `src/components/ui/button.tsx` as identical;
- dependencies `cn` and `shiki`, both already declared in Piano's web package.

No CSS change was listed. Piano already imports `shadcn/tailwind.css`; the installed stylesheet
contains the scroll-fade utilities. Their visual behavior remains unverified, especially under
Piano's motion reset. Review the lockfile rather than assuming the eventual install is a no-op.
[S5, S8; CLI observations below]

**Start without syntax highlighting.** `CodeBlock` does not import the optional highlighting
hook. The generated highlighter uses Shiki's JavaScript engine and language-specific dynamic
imports; the hook caches complete prefix lines while code is appended. Changes refreshes parsed
patches rather than streaming append-only source, so that optimization is not evidence of a
faster diff view. Piano also already has `lib/file-highlight.ts` using Shiki; importing a second
highlighter should be deliberate. [S2, S9, S10]

If highlighting is later desired, the `diff` grammar highlights patch syntax, not the underlying
TypeScript/Python/etc. with independently correct old/new grammar state. Deleted and added code
must not be concatenated and treated as one valid source file. The current proposal needs no
Shiki import, Markdown renderer or server-rendering change. Piano is a client-side Vite app;
`rsc: true` in its CLI configuration preserves directives, not a Server Component runtime.
[S5, S8, S9]

**Do not add Copy by default.** Selection of displayed source excludes diff marks; copying a
patch must instead use the original `file.raw` with its ASCII patch prefixes and headers. Never
reconstruct a patch from the rendered Unicode minus signs. A future copy action must state its
scope, preserve partial-patch disclosure, use Piano's button sizing/feedback policy, and handle
clipboard rejection. Upstream's inspected copy button swallows clipboard errors. [S2–S4, S8]

## Smallest useful implementation evidence

Claim: adopting a standard presentation primitive preserves Changes' review information and
interaction, without a large-diff regression.

- Keep existing `test/Diff.test.ts`, `test/ChangesView.test.ts`, `test/SessionChanges.test.ts`
  and `test/WorkspaceChanges.test.ts`; do not duplicate parser tests to test shadcn.
- On a scratch instance, inspect a multi-hunk file containing context, additions, deletions,
  blank lines and a no-newline marker. Assert exact old/new positions, including a hunk above
  line 999. Check selection/clipboard output with blank rows and across a chunk boundary.
- Exercise wrap on/off, keyboard horizontal scrolling, file collapse/expand, Ask, refresh,
  partial-patch disclosure, binary/mode-only files, and workspace switching. These should keep
  the existing labels/actions, not gain duplicates.
- Compare before/after screenshots in light/dark and narrow/touch layouts, and the repository's
  style shots. Inventory every changed control/string and take each action once with its answer.
- Compare expanding, scrolling and toggling wrap on a large multi-block patch. Do not remove
  chunking based on upstream's plain-string streaming claim. Check browser find/selection too.
- For implementation, run `npm run typecheck`, `npm run lint`, `npm test` and the ownership
  guide's browser checks; retain revision/environment and browser evidence. [S8, S11]

No implementation gates or browser checks were run for this documentation-only research.

## Transcript

The transcript renders code and plain output in hand-written `<pre>` elements. Each was judged
against what CodeBlock supplies: a bordered block, optional header, floating actions revealed on
hover or focus, keyboard scrolling with a focus ring, `wrap`, and optional highlighting that
tokenizes only new lines while text streams. [S2, S12]

| Surface | Today | Fit |
| --- | --- | --- |
| Markdown code fences (`MarkdownPre` in `Markdown.tsx`) | `pre > code` styled by `.prose-chat pre`, an always-visible `CopyCode`, a Mermaid host for closed `mermaid` fences | **Good.** Its intended use; gains highlighting, focus ring and keyboard scrolling. |
| Tool call arguments (`Tool` in `MessageList.tsx`) | Rounded `bg-fill` `<pre>`, unwrapped, scrolls sideways | **Acceptable.** `size="sm"` without a header looks nearly the same and adds keyboard scrolling. Only worth doing alongside fences. |
| Tool output (`FoldedOutput`) | Text on a left rule, folded to five lines with "… N more lines" | **Poor.** A bordered block per tool row adds weight against [quiet UI](../../AGENTS.md#quiet-ui). ANSI highlighting does not apply: `transcript.ts` strips ANSI before rendering. |
| Context cards, error details, nested tool calls, dispatch parameters | Wrapped plain text inside a row | **None.** Prose-like output, not code; a block adds only chrome. |

For fences, Piano keeps:

- **Copy.** Put the existing `CopyCode` inside `CodeBlockActions`, not `CodeBlockCopyButton`:
  upstream swallows clipboard rejection, labels itself "Copy"/"Copied" and sizes itself with
  `icon-xs`, while Piano's shows the error toast, says "Copy code"/"Code copied" and uses
  `size="inline"` per the icon-button sizing rule. Hover reveal replaces today's always-visible
  button; upstream keeps it visible on coarse pointers.
- **Fence states.** The Mermaid host, the incomplete-fence check and the diagram fallback stay
  around the block; CodeBlock replaces only the `<pre>`.
- **Highlighter.** The generated `lib/highlighter.tsx` runs Shiki's JavaScript engine on the main
  thread with 13 bundled languages; `lib/file-highlight.ts` already runs Shiki in a worker for
  file previews. Choose deliberately between the generated loader and one shared grammar loader,
  and measure a long transcript with many fences ([session performance](../session-performance.md)).
- **Look.** CodeBlock's border, `dark:bg-input/30` and padding differ from `.prose-chat pre`
  (`index.css`). Settle differences in a Piano wrapper or tokens and compare style shots.

Evidence for an implementation: a fence streaming in, a closed Mermaid fence, copy success and
clipboard rejection, keyboard scrolling of a long line, light/dark and touch screenshots, the
transcript-rows journey (row alignment), style shots before and after, and the code gates.

## Sources and command outcomes

Primary upstream sources (mutable; inspected 2026-10-29):

- **S1:** [Official Radix Code Block documentation](https://ui.shadcn.com/docs/components/radix/code-block).
- **S2:** [Radix Vega CodeBlock registry source](https://ui.shadcn.com/r/styles/radix-vega/code-block.json),
  inspected through `npx shadcn@latest view @shadcn/code-block` and the CLI-generated diff.
- **S9:** [Highlighting hook registry](https://ui.shadcn.com/r/styles/radix-vega/use-highlighted-code.json),
  with transitive highlighter inspected through CLI dry-run diffs.

Piano sources at the revision above:

- **S3:** [`Changes.tsx`](../../web/src/components/Changes.tsx), especially `LiveFile`, `Hunks`
  and `DiffRowView`; [`diff.ts`](../../web/src/lib/diff.ts).
- **S4:** [`changesView.ts`](../../web/src/lib/changesView.ts),
  [`ChangesHeader.tsx`](../../web/src/components/ChangesHeader.tsx).
- **S5:** [`components.json`](../../web/components.json), [`web/package.json`](../../web/package.json).
- **S6:** [`lineBlocks.ts`](../../web/src/lib/lineBlocks.ts), [`index.css`](../../web/src/index.css).
- **S7:** [Development invariants](../development-invariants.md).
- **S8:** [shadcn ownership and upgrades](../shadcn-ui.md), [project instructions](../../AGENTS.md).
- **S10:** [`file-highlight.ts`](../../web/src/lib/file-highlight.ts).
- **S11:** [Testing policy](../testing.md), [`Diff.test.ts`](../../test/Diff.test.ts).
- **S12:** [`Markdown.tsx`](../../web/src/components/Markdown.tsx) (`MarkdownPre`, `CopyCode`),
  [`MessageList.tsx`](../../web/src/components/MessageList.tsx) (`Tool`, `FoldedOutput`,
  `ContextCard`, `ErrorMessage`, `DispatchRow`), [`transcript.ts`](../../web/src/lib/transcript.ts),
  `.prose-chat pre` in [`index.css`](../../web/src/index.css).

Successful read-only CLI observations, from `web/` except the initial docs lookup:

```sh
npx shadcn@latest docs code-block
npx shadcn@latest info --json
npx shadcn@latest search @shadcn -q code-block
npx shadcn@latest view @shadcn/code-block
npx shadcn@latest add code-block --dry-run
npx shadcn@latest add code-block --dry-run --diff code-block.tsx
npx shadcn@latest add code-block --dry-run --diff highlighter.tsx
npx shadcn@latest add code-block --dry-run --diff use-highlighted-code.ts
```

The initial root-directory `docs` lookup returned the Base documentation; project `info` and
registry metadata identified Radix, whose public documentation was fetched instead. All listed
CLI commands succeeded. Ignored scratch captures are in `.scratch/code-block-research/`;
the captured `registry.json` SHA-256 is
`597794fe1ec76f4ff6e7e439b6a699d5e40610045ec20ff7391a12f8f63d4f11`.
These captures are local aids, not committed runtime evidence. No application, dependency,
configuration or upstream-owned source files were changed.
