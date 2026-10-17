# Piano tool prompt metadata

## Finding

The proposed split is appropriate for Piano: **description = capability, snippet = short action,
guidelines = usage policy**. Pi supports that separation but does not enforce the writing style or
turn prompt guidelines into permission checks. This recommendation concerns metadata only; it does
not change dispatch behavior.

Scope: installed `@earendil-works/pi-coding-agent` **1.3.0**, Piano revision
`7309ce73fdb697a91e10b9ee43b0a7ce8ecb9f5d`, inspected on 2026-10-17. Sources below are the installed
release and this checkout, not assumptions about upstream's latest release.

## What the fields actually do

| Field | Pi contract | Recommended writing |
| --- | --- | --- |
| `description: string` | Required model-facing tool description. | One or two sentences identifying capability and essential result semantics. Not the whole workflow. |
| `promptSnippet?: string` | Optional one-line entry in the default system prompt's tool list. A custom tool without it is omitted from that list, **not disabled or removed from model tool declarations**. | Short action phrase; Pi supplies the tool name. |
| `promptGuidelines?: string[]` | Optional rules contributed while the tool is declared in the default system prompt. | Start usage guidance with `Use <tool_name> ...`; describe invocation conditions, non-obvious input structure, result handling and hard guardrails. |

Sources: [ToolDefinition](../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts)
(lines 451–463), [prompt construction](../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js)
(`buildRules`, `buildSystemPromptSections`), and the official
[dynamic-tools example](../../node_modules/@earendil-works/pi-coding-agent/examples/extensions/dynamic-tools.ts).
The action-phrase and `Use` conventions are writing recommendations, not API validation rules.

Important boundaries:

- Pi collapses snippet whitespace into one line; it trims guidelines, removes empty ones and
  deduplicates exact normalized strings. Write each guideline as a complete bullet, without a
  leading `-`. [Normalization](../../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js),
  `_normalizePromptSnippet` and `_normalizePromptGuidelines`; `buildRules` also deduplicates across tools.
- A custom system prompt skips the default tools/rules sections; a forced prompt replaces the
  structured prompt. Do not treat these fields as an unconditional security boundary.
  [Prompt construction](../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js).
- In codemode's normal `on` mode, direct tools retain declarations and default-prompt rules.
  In `only` mode, hidden tools lose those list entries/rules; codemode carries their guidelines
  alongside their descriptions instead. Discovery via `describeTool()` and `ALL_TOOLS` also carries
  guidelines. A short snippet is therefore **not** a substitute for a useful description.
  [Codemode docs](../../node_modules/@earendil-works/pi-coding-agent/docs/codemode.md#call-tools),
  [implementation](../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/tool.js)
  (`toCodemodeDeclaration`, `prepareCodemodeLoadout`).
- Concise descriptions do not necessarily reduce total prompt tokens: moving text to guidelines
  mostly changes placement. Prune duplicate meanings and keep each tool's guidance self-contained
  for independent discovery. Codemode's inline catalog is budgeted, so not every tool is always
  listed. [Codemode docs](../../node_modules/@earendil-works/pi-coding-agent/docs/codemode.md#call-tools).

## Piano audit

Current definitions: [extensions/piano-sessions/index.ts](../../extensions/piano-sessions/index.ts).
Behavioral reference: [session dispatch](../session-dispatch.md).

| Tool | Current configuration | Recommendation |
| --- | --- | --- |
| `piano_start_session` | Long description mixing capability, brief structure, defaults, concurrency and retry rules; one authorization guideline; no snippet. | Add an action snippet. Move workflow instructions and retry guardrails into named guidelines. Keep the fresh-session capability and initial-submission result in the description. |
| `piano_wait_sessions` | Long description mixing observation, input rules and lifecycle caveats; no guidelines or snippet. | Add a snippet and its own guidelines. Preserve opaque handles, observation-only cancellation and the distinction between settlement and successful work. |

Keep `parameters`, `outputSchema`, `structuredContent` and execution logic. They already provide
structured input/output; prose should explain semantic constraints the schema cannot express, not
repeat every property. Add short schema descriptions for `cwd`, `model`, `sessions` and `timeoutMs`
so their defaults and meanings stay adjacent to the inputs. Keep ranges and enum values in schemas.

## Suggested metadata

These are proposed replacements for the three metadata fields, **not an applied extension change**.
The existing schemas and implementations remain authoritative.

### `piano_start_session`

```ts
description:
  "Creates a fresh, visible Piano session and submits its initial work brief. Returns creation and submission outcomes, an observation handle when available, and an Open session link.",
promptSnippet: "Dispatch work to a new Piano session",
promptGuidelines: [
  "Use piano_start_session only when the user explicitly asks to dispatch work through Piano; otherwise work in the current session. Do NOT dispatch autonomously.",
  "Use piano_start_session with a non-empty prompt containing the objective, relevant decisions/files, constraints, expected output and necessary checks; the child does not inherit this transcript.",
  "Use piano_start_session with separate prepared worktrees for concurrent writing tasks. Do NOT use it to create a worktree; cwd selects an existing directory.",
  "Use piano_start_session with an optional provider/model and a thinkingLevel supported by that model. Omitted model and effort use normal new-session defaults, not the parent's settings.",
  "Use piano_start_session results to check creation and initial submission separately; neither establishes task completion. Pass a returned non-null handle unchanged to piano_wait_sessions.",
  "Do NOT automatically repeat piano_start_session after uncertain delivery; inspect Piano, using the child link when available, before deciding whether another dispatch is needed.",
],
```

Suggested input descriptions:

- `cwd`: `Existing working directory; defaults to the current session's cwd.`
- `model`: `Optional provider/model identifier; defaults to normal new-session selection.`

### `piano_wait_sessions`

```ts
description:
  "Observes dispatched Piano sessions and returns per-session status, an attributable answer when available, and Open session links. Observation does not control child execution.",
promptSnippet: "Wait for dispatched Piano sessions",
promptGuidelines: [
  "Use piano_wait_sessions to observe work explicitly dispatched through Piano; waiting is part of that authorized request.",
  "Use piano_wait_sessions with sessions containing the exact non-null handles returned by piano_start_session. Do NOT substitute session IDs or reconstruct handles.",
  "Use piano_wait_sessions results as partial observations: ending=deadline limits observation, and cancelling the wait does not stop children. Do NOT infer child failure or cancellation from either.",
  "Use piano_wait_sessions answers and reported checks to assess the work. Do NOT equate settled with task success; handled input can have no answer.",
  "Use piano_wait_sessions again while observation is needed; child completion does not automatically wake the parent. If later input, a host restart or missing evidence prevents attribution, inspect the linked session instead.",
],
```

Suggested input descriptions:

- `sessions`: `Exact observation handles returned by piano_start_session, passed unchanged.`
- `timeoutMs`: `Maximum observation wait in milliseconds; defaults to 30000.`

The explicit `Do NOT` statements protect consequential boundaries: unrequested delegation,
duplicate dispatch, unsupported worktree creation, invalid handles and false success claims.
Each is paired with the supported action rather than a general list of prohibitions.

## Verification and limits

Research-only change: no extension edits, deployment, session dispatch or model calls.

On the revision above, an inline Node script imported the installed `buildSystemPromptSections`
and `toCodemodeDeclaration` functions. Seven assertions passed:

1. Missing snippet omits the tool-list entry.
2. A declared tool's guideline appears even without a snippet.
3. Duplicate guideline text contributes one rule.
4. Adding a snippet adds the named tool-list entry.
5. Hiding the declaration removes its default-prompt guideline.
6. A custom prompt omits the default rules section.
7. Codemode's declaration includes the supplied guideline.

This establishes metadata placement, not improved model compliance. Source and relative-link review
are the appropriate checks for this note; application tests and browser runs are not required for
documentation-only work. If the recommendation is implemented, inspect the actual registered
metadata in direct and codemode-only configurations, then run the repository's code-change gates.
Retain the existing dispatch tests for execution contracts; avoid snapshots of exact wording.
