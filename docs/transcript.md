# Transcript rendering and scrolling

The browser feature starts at [`web/src/features/transcript/index.ts`](../web/src/features/transcript/index.ts).
It owns the projection of authoritative messages into rows, row rendering and disclosures,
virtualization, measurement, scroll anchoring and jump navigation. It does not own history,
Pi communication, persistence, composer submission or shared wire contracts (INV-01/03/05).
Markdown, image loading, attachments, navigation and general UI primitives remain shared dependencies.
The end-to-end text contract is [Transcript fidelity](session-transcripts.md).

## Interface and lifetime

`SessionView` supplies immutable messages, pending reply, executions, working state and tool
visibility once to `TranscriptProvider`. It owns the cached projection and viewport. Below it:

- `Transcript` renders the rows or the loading skeleton. Its props supply presentation and
  integration facts: workspace ID, submitted input, activity, placeholder, dispatch parent and
  session-destination lookup. Keep its React key tied to the displayed session/draft: disclosure
  state and measurements survive row unmounts, but must not leak into another session.
- `TranscriptJump` renders the composer's jump control using the same history projection. It needs
  no message/lifecycle props and cannot target a different projection supplied by a caller.
- `useTranscriptWheel` gives the session rail only wheel forwarding, not the viewport controller.
  The rail decides whether its own overflow consumes the wheel and excludes zoom gestures.

The provider can span session changes without remounting the composer or inspection panels;
immutable input replacement invalidates projection, and attaching a new transcript resets viewport
following. Pending-only updates reuse history rows and jump destinations. The provider's stable
viewport context is separate from projection updates so tool folds do not subscribe to text deltas.

Application code imports only the entry point. The existing `piano/layer-imports` rule rejects
private imports (including types, relative paths and aliases) and direct reverse dependencies on
`SessionView`, `Composer`, `SessionRail`, session store and transport. This is a specific transcript
rule, not a generic feature registry. It checks direct imports, not transitive dependency purity.

## Implementation navigation

| Change | Start here | Related obligation |
| --- | --- | --- |
| Message/tool facts, final-turn visibility or jump labels | `transcript.ts`, `messageError.ts` | Fidelity, tool-result pairing, errors, pending completion and cache invalidation |
| Prompt, reply, context or error content | `MessageRows.tsx` | Faithful Markdown, attachment fallback, copy, default folds |
| Tool, nested-call, dispatch, library or answer content | `ToolRows.tsx`; `SessionLinks.tsx` for links | Outcome vocabulary and disclosure content |
| Disclosure mechanics | `Row.tsx`, `useTranscriptDisclosure.ts` | Stable per-row opens, focus return, first-line gutter alignment, fold anchoring |
| Mounted window and measurement scheduling | `Transcript.tsx`, `useVirtualTranscript.ts`, `scrollRenderBudget.ts` | Bounded DOM, prepaint measurements, reader-input render budget |
| Following, corrections and jump landing | `transcriptViewport.ts` | Queued reader motion takes precedence; programmatic corrections preserve intent |
| Integrating these views | `TranscriptContext.tsx`, `index.ts` | One projection shared by rendering and jump navigation |

For example, changing which finished nested calls remain visible in the collapsed tail starts in
`transcript.ts` and `ToolRows.tsx`. It no longer requires finding that renderer inside a file also
implementing the virtual window, nor coordinating `SessionView` and `Composer` projections. If the
change affects height or interaction, follow `FoldRow` in `Row.tsx` and the existing viewport checks;
a folder does not remove that behavioral obligation.

## Preservation contract and checks

Use the [open-session recipe](../.agents/skills/verify-piano/features/open-session.md) and
[verification policy](testing.md). Allocate evidence under `~/piano-evidence/` first. The focused
checks below are not substitutes for `npm run verify -- <evidence-directory>`.

| Claim | Smallest useful falsifier | Limit |
| --- | --- | --- |
| Projection retains message/tool/error semantics, messages-only visibility and jump destinations | `test/Transcript.test.ts` | Pure values, not DOM |
| Pending updates preserve history identity; tools, lifecycle, completion and replacement invalidate correctly | `test/TranscriptProjection.test.ts` | Immutable inputs; not browser scheduling |
| Rows preserve copy/error/image fallback and disclosure defaults; repeated empty/absent executions do not reproject saved history | `test/MessageList.test.ts` through the public feature entry | Static rendering and a provider rerender check; no geometry, focus or resize callbacks |
| Reader intent survives streaming, shrink clamps, corrections, folds and jumps | `test/TranscriptViewport.test.ts` | Controlled geometry, not native browser event ordering |
| Reader input and mounting cost select immediate versus deferred rendering | `test/ScrollRenderBudget.test.ts` | Controlled clock, not frame-rate evidence |
| Public imports and dependency direction remain enforced | `test/lint-boundaries.test.ts`, full lint | Direct import edges, not all transitive dependencies |
| Jumps, remembered folds, tall-tool focus/anchoring, streaming, resize readiness and native-wheel history remain usable | `node test/browser/open-session.mjs <evidence-directory>` | Fake Pi and seeded history; Chromium, including a narrow viewport, not a physical phone |
| Every row's glyph aligns with its first text line; tool headers/bodies remain usable | `node test/browser/transcript-rows.mjs <evidence-directory>` | Fixture row kinds and measured geometry only |
| Original text/newlines survive settled, reloaded, copied and streaming views | `test/browser/message-fidelity.mjs`, invoked by `open-session.mjs` | Synthetic text; no real provider |

Run a focused module with `node --test --import ./test/setup.ts test/<name>.test.ts`.
`transcript-scroll.mjs`, `transcript-resize.mjs` and `message-fidelity.mjs` are helpers invoked by
`open-session.mjs`, not standalone journeys. Do not report running a helper file alone as coverage.
Pure internal modules remain testable without exporting them to application consumers; browser and
static-render checks exercise the integrated feature. Retain distinct obligations rather than
replacing the focused state-machine tests with one expensive browser suite.

## Performance evidence

See [the benchmark method](session-performance.md) and [performance policy](performance.md).
Compare the same `session-perf.mjs` workload and configuration on base and candidate, serially on the
same machine, with fresh browser/backend samples. Report ranges as well as central values, p95 beside
maximum frame interval, and retained heap after forced GC/append. Opening readiness is a usable-view
proxy, not time to interactive. Development-build measurements are not production budgets (INV-09).

The scripted `scrollTop` sweep exercises deferred rendering. The native-wheel trace in
`open-session` separately checks visible content, backward shifts and bounded mounting while idle
and streaming, including a narrow viewport. Neither establishes native touch, WebKit/Firefox,
real-device smoothness or real-model performance.

## What another feature can copy

Copy the decisions, not a scaffold: collect implementation that changes together, expose the
integration points actual callers need, keep shared dependencies outside, and use existing lint to
protect the private implementation. Give the feature one owning document linking its smallest
falsifiers and its integrated journey, with their limits. Here the provider removes duplicated
projection/viewport coordination; it is not a required shape for another feature.
