# Composer @session mentions: feasibility and performance

Date: 2026-10-09. Source inspection at `4eb0a1282f0412665e90ea229988db1109fed699`.
Research/proposal only; no runtime, schema or product decision changed.

## Recommendation

Yes: scoped session autocomplete is a small-to-medium feature, and SQLite is adequate.
The harder work is reference identity, editing behavior and deciding what context a mention
supplies—not finding matching titles. Start with metadata-only lookup and the existing textarea
completion interaction. Do not add a rich-text editor, transcript search, FTS or model-generated
summaries for the first slice. These are engineering recommendations, not measured performance claims.

Separate two deliverables:

1. **Reference:** `@` searches sessions and inserts an unambiguous reference. This alone does not
   give the model the other conversation.
2. **Context:** explicitly resolve selected references into bounded, attributed context at submission.
   This is a medium-sized end-to-end change, especially with steering, queue restoration and history.

For a useful AI-facing version, ship both with a deliberately small context contract rather than
implying that a clickable title lets Pi read another session automatically.

## What Piano already has

- [`RegistryDatabase.ts`](../../server/RegistryDatabase.ts) stores session title, activity times,
  archive state and outcome `project_id`. Session identity is `(cwd, session_id)`; workspaces have
  stable IDs and `folder_path`. Existing indexes include `(archived, updated_at DESC)` and
  `(project_id, updated_at DESC)`. **SQL projects are outcome Projects, not Folders.**
- [`Registry.ts`](../../server/Registry.ts) serves `get` from an in-memory `Ref`; SQLite persists
  changes, but reads are not currently a scoped SQL query API. Adding an index alone therefore
  will not accelerate the existing browser lookup path. See the
  [migration limitations](sqlite-registry.md#limits-and-operations).
- [`Views.ts`](../../server/Views.ts) already builds Folder session lists and outcome-project
  references. Do not call those builders on each keystroke: they also discover worktrees or inspect
  history availability. Mentions need only registry metadata.
- [`Composer.tsx`](../../web/src/components/Composer.tsx) uses
  [`SlashTextarea.tsx`](../../web/src/components/SlashTextarea.tsx), which already handles a
  textarea, anchored Popover/listbox, caret selection, IME, keyboard acceptance and stale-range guards.
  Slash discovery happens once per opening with local filtering. This is a good interaction seam,
  not a reason to reuse its command-discovery endpoint for sessions.
- [`shared/wire.ts`](../../shared/wire.ts) currently models prompt text and image attachments,
  not typed session mentions. A title string is not a durable reference.
- [`ConversationHistory.ts`](../../server/ConversationHistory.ts) demonstrates bounded history
  projections and redaction. Its detail projection can include thinking/tool-related content;
  **do not reuse it wholesale as a cross-session context policy**.

## Scope: define “same project/folder” explicitly

Recommended initial behavior (requires product confirmation):

- A session in an outcome **Project** defaults to sessions in that Project, including other Folders.
- An ungrouped session defaults to its **Folder**, including registered worktrees belonging to it.
- Let the user switch Project/Folder scope inside the picker when both exist. Never silently search
  every session or silently broaden an empty Project search to unrelated Folder sessions.
- For a new draft without a session, derive scope from the explicitly selected Project and workspace.
- Exclude self and archived sessions by default. Search only registered references, not every Pi file
  found on disk. Defer checkout/history availability checks until selection/submission.
- Use recorded workspace-to-Folder membership, not path-prefix matching: sibling paths, worktrees
  outside the root and closed Folders make prefix matching incorrect.

Keep this independent of sidebar display mode. Titles can repeat and change; identity cannot be the
label. Browser references should carry `{ workspaceId, sessionId }`, resolved server-side to canonical
`(cwd, sessionId)`. Show title plus a short workspace label where disambiguation helps. Paths must not
appear in HTTP URLs. These choices preserve INV-01 and INV-07; grouping is not execution identity.

## Picker and draft representation

Proposed interaction:

1. Typing `@` at a token boundary opens recent sessions; typing filters titles. Do not trigger inside
   email addresses. Define behavior in code spans, pasted text and multiline queries explicitly.
2. Return at most 20 visible suggestions. Rank title-prefix matches before substring matches, then
   recent activity, with stable identity as a tie-breaker. Blank queries show recent candidates.
3. Arrow keys select; Enter/Tab accept without sending; Escape closes before existing queue/stop
   behavior. Preserve native text editing, touch selection and IME composition.
4. Keep focus in the textarea and expose the active listbox option through `aria-activedescendant`.
   This follows the [WAI-ARIA focus contract](https://www.w3.org/TR/wai-aria/#aria-activedescendant).
   Test the existing multiline textarea pattern with assistive technology rather than assuming
   generic single-line combobox examples prove it accessible.

Extend the existing completion component so only one provider owns the active token/popover. Compose
existing shadcn primitives; before implementation, search the registry and check current component
APIs. Avoid replacing the textarea merely to render inline chips.

For the first version, prefer a visible, copyable reference token containing opaque workspace/session
IDs and an escaped display label, rather than hidden offsets attached to `@title`. A proposed format
such as `@[title](piano-session:<workspaceId>/<sessionId>)` needs a specified parser/escaping contract;
it is not an existing supported link. Rename changes only the display label, not resolution. An edited
or incomplete token must not accidentally refer to another session. If polished inline chips are
required, budget separately for structured draft persistence, undo, paste and range transformations.
Server-side validation is required even for tokens inserted by the picker.

## Cheapest lookup path first

**Initial recommendation:** filter already-available registry projections in the browser, if they
contain the complete selected scope. Build the scope's candidate list once per relevant metadata
change, normalize titles once and render only the top results. This avoids both SQL and network
roundtrips per keystroke. Do not silently search only the latest 20 sessions: apply matching to the
whole scope before limiting results.

If complete metadata is not already present, expose a lightweight registry-only suggestion operation:
input current workspace/session IDs (or explicit new-draft Project), scope, query and bounded limit;
output IDs, title, workspace label and activity time. Initially it can query the cached Registry
snapshot, without disk reads. Validate membership on the server, especially when later resolving
content. Cache by scope/query and invalidate on rename, membership/archive changes and workspace
switches. A short debounce (suggested starting point: 100–150 ms) is useful only for remote lookups;
cancel requests and reject stale responses after scope/query changes.

This remains O(N_scope) matching without a title index. That is a reasonable first design for short
metadata lists, not a promise about unlimited scale. Cap query length and response bytes as well as
result count. Keep opening the picker free of Git commands, transcript I/O, Pi child starts and LLM calls.

## SQL path if measurements justify it

Add scoped reads **behind Registry**, not direct database access from route/UI code. Preserve its
single-backend ownership and read/write consistency. Candidate indexes to evaluate in a versioned
migration (not proposed as mandatory changes now):

```sql
CREATE INDEX sessions_active_project_recent
  ON sessions(project_id, updated_at DESC, cwd, session_id)
  WHERE archived = 0;
CREATE INDEX sessions_active_workspace_recent
  ON sessions(cwd, updated_at DESC, session_id)
  WHERE archived = 0;
CREATE INDEX workspaces_folder_path ON workspaces(folder_path, path);
```

Representative Folder lookup, with `:workspace_id` being the selected workspace and `:pattern` a
bound, escaped `%query%` string (`%`, `_`, and the escape character escaped as literals):

```sql
SELECT w.id AS workspace_id, s.session_id, s.title, s.updated_at
FROM workspaces AS w
JOIN sessions AS s ON s.cwd = w.path
WHERE w.folder_path = (
  SELECT folder_path FROM workspaces WHERE id = :workspace_id
)
  AND s.archived = 0
  AND COALESCE(s.title, '') LIKE :pattern ESCAPE '\'
ORDER BY s.updated_at DESC, w.id, s.session_id
LIMIT :limit;
```

This illustrates scoping, not the final query: add self-exclusion and prefix ranking before LIMIT;
use a separate blank-query path so untitled sessions can still appear with a fallback label. Project
lookup filters `s.project_id` directly. The Folder join may need a temporary sort across workspaces;
these indexes do not guarantee a sort-free global result. Inspect `EXPLAIN QUERY PLAN` with realistic
scope sizes, no-match queries and rare old matches before choosing indexes.

SQLite's [optimizer documentation](https://www.sqlite.org/optoverview.html#the_like_optimization)
explains the important distinction: `LIKE 'term%'` can use a suitable title index under its collation
conditions; `LIKE '%term%'` cannot use that B-tree range optimization. A scope index can still narrow
the rows being scanned. LIMIT bounds output, **not necessarily scanned rows or sorting work**. SQLite's
built-in case-insensitive LIKE is ASCII-oriented; define and test non-ASCII matching consistently
between client and SQL rather than assuming JavaScript normalization is identical.

Only consider [FTS5](https://www.sqlite.org/fts5.html#the_trigram_tokenizer) after measurement:
ordinary token/prefix search and arbitrary substring search have different semantics. Trigram indexing
supports substring matching, but full-text queries shorter than three Unicode characters do not
match. Short `@a`/`@ab` queries still need a policy. FTS also adds index synchronization and storage
cost. If used, index registry titles first; transcript indexing is a separate architectural proposal.

## What a mention sends to the model

A session ID or browser link does not, by itself, supply context. Proposed bounded-context contract:

- At submission, resolve only the explicitly selected unique references and validate scope again.
  If membership changed or history is unavailable, keep the draft and ask the user to remove or
  update the reference; do not quietly submit without the requested context.
- Read Pi-owned history through the session/history seam; do not copy transcripts into the registry
  or start an otherwise inactive session just to inspect it. Extend the PiSessions wire interface
  as needed; do not expose Pi protocol details to the composer.
- Capture the selected source's current branch/leaf and entry IDs. Include a deterministic bounded
  excerpt of user/assistant text, excluding thinking, tool payloads and images initially. Clearly
  mark omissions and truncation. A starting product budget might be three sessions and a combined
  12,000 characters, with an additional model-token budget check; these are proposed limits, not
  benchmark results or an assertion that characters equal tokens.
- Attribute source title, workspace/session identity, leaf and capture time. Treat source text as
  quoted reference material, never higher-priority instructions. Apply appropriate redaction;
  heuristic redaction is not a security boundary (INV-11).
- Snapshot once at submission, including steering/follow-up submission; do not silently refresh
  source context while a message waits in Pi's queue. Ensure rendered history shows what actually
  went to Pi and queue-to-draft restoration cannot double-expand the same reference. Define whether
  an edited/restored message deliberately captures a fresh snapshot on resubmission.
- Do not recursively expand mentions found inside source text. No automatic LLM summarization is
  necessary for v1. If summaries are added later, specify provenance, staleness and cost explicitly.

This preserves Pi's history authority (INV-01), existing session lifecycle (INV-02), workspace
identity (INV-07), trust boundaries (INV-11) and protocol encapsulation (INV-12). It is not the
same as project-wide implicit shared instructions, which remain deferred in the
[roadmap](../roadmap.md#outcome-based-projects).

## Verification and effort

Qualitative effort: **small-to-medium** for a title picker/reference insertion; **medium** for a
reliable AI-context feature with draft/queue/history integration. No fixed-day estimate is justified
without choosing reference-only versus bounded context, and plain tokens versus inline chips.

Before implementation, establish performance with synthetic registries (e.g. 1k, 10k and 100k total
sessions, including one unusually large Folder/Project). Measure picker input-to-paint, scope/filter
cost, response bytes, SQL plan/time if applicable and bounded source-resolution time separately.
A suggested target is under 50 ms local filtering and under 150 ms warm end-to-end suggestions at
p95 on the actual development device; these are acceptance targets, **not observed timings**.

Meaningful checks: duplicate/renamed titles, root plus external worktree membership, cross-Folder
Project membership, self/archive exclusion, missing source history, scope switch races, non-ASCII
queries, malformed tokens, IME/touch, slash coexistence, Enter not sending on acceptance, draft
restore and queued-message roundtrip. Assert autocomplete performs no history reads or child starts.
Observe the journey in a scratch browser; run the repository's test/typecheck/lint gates for the
implementation. No model call is needed to benchmark title lookup.

Research verification: inspected the linked source files and primary SQLite/W3C documentation;
reviewed local document links and whitespace. No app change, benchmark, browser run, production
registry access, model call, build or deployment was performed. No background-agent tool was
available, so this research was conducted directly.
