# Pi exported-session message counts

Question: what does the message count in a Pi export include, and can it name Piano's message-jumper footer?

Inspected the installed, locked `@earendil-works/pi-coding-agent` **1.0.2** on 2026-10-06. Findings concern that version, not an unverified newer release. Relevant invariant: **INV-01**, Pi owns history; UI counts are projections, not another history source.

## Findings

- **The HTML export header has a role breakdown, not a chat or turn count.** `computeStats()` counts every persisted user message, every assistant message (including tool-only/intermediate responses), and every tool-result message. Custom messages, compactions and branch summaries have separate counters. `renderHeader()` displays these under “Messages”; “Tool Calls” is a separate count of assistant content blocks. System messages are not displayed in that role breakdown. Source: [export template](../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.js), `computeStats` and `renderHeader`, lines 1345–1421.
- **Export statistics cover the whole session file, not just the current visible conversation.** Export uses `SessionManager.getEntries()`, which returns all entries except the session header, including branches and compacted history. Source: [HTML exporter](../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/index.js), `exportSessionToHtml` / `exportFromFile`; [SessionManager](../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js), `getEntries`, lines 1102–1109.
- **Pi RPC's `totalMessages` is broader still:** `getSessionStats()` increments it for every `type: "message"` entry, including system messages. It separately returns `userMessages`, `assistantMessages`, `toolResults` and `toolCalls`. It is not simply the export's displayed user + assistant counts. Source: [AgentSession](../../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js), `getSessionStats`, lines 3340–3399.
- **Export navigation has a different count.** The tree footer displays `filtered.length / flatNodes.length` **entries**. Filtering normally hides textless assistant responses unless exceptional, can exclude tool results/settings, and always retains the current leaf. This is a navigation-filter count, not the header's message statistics. Source: [export template](../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.js), `filterNodes`, lines 371–420, and tree status, line 784.
- **A Pi turn is one assistant response and its tool calls/results**, not a user/assistant exchange and not each tool call. Source: [JSON event documentation](../../node_modules/@earendil-works/pi-coding-agent/docs/json.md), “Agent and turn events”.

## Small check

Executed the installed export template's actual `computeStats()` function in a Node VM against a synthetic session with one system message, one user prompt, an assistant response containing two tool calls, two tool results, and one final assistant reply. Output retained at `/tmp/piano-export-message-count.json`:

| Quantity | Count |
| --- | ---: |
| Persisted `message` entries | 6 |
| Export user messages | 1 |
| Export assistant messages | 2 |
| Export tool results | 2 |
| Export tool calls | 2 |

The source-defined Pi turn count for that example is 2. Piano's original jumper offers two message destinations: the user prompt and final reply; top/end are controls, not messages. Source: [Piano transcript navigation](../../web/src/lib/transcript.ts), `jumpEntries`.

## Footer implication

These are distinct metrics:

- **User prompts**: one per user-role message; “chats” would be a Piano-specific name, not Pi terminology.
- **Jumper messages**: the count of existing user/final-reply destinations, excluding top/end. This matches what the popup actually offers; label it **messages** if that is the desired metric.
- **Pi assistant turns / export message statistics**: include intermediate responses that the jumper deliberately does not list.

Do not rename an assistant-response count to “chats” without changing its definition. If the footer is meant to summarize the popup, prefer its existing destination count and keep the preview-selection behavior unchanged. Neither a jumper count nor a count of loaded user prompts is guaranteed to equal Pi's full-session export totals after compaction or branching.

No live-session file was inspected or changed. This research does not establish this particular session's numeric totals or prescribe a new list preview.
