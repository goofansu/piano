# Transcript fidelity

Pi owns session content (INV-01). Piano does not redact text, tool arguments/results, context,
dialogs or metadata; [ADR 0005](adr/0005-faithful-display-content.md) records the trust trade-off.
History files remain untouched. Existing structural projections, size limits and folding still
apply; the UI is not a byte-for-byte rendering of the whole Pi session file.

Ordinary single newlines in transcript Markdown produce visible line breaks, in user messages,
streaming and settled assistant replies, context, skill expansions, inline questions and dispatched answers. No
code fence, trailing spaces or blank lines are required. Markdown lists, tables, links and code
keep their grammar; copying a response uses its original Markdown source. Static file Markdown
keeps standard soft-break behavior. HTML and unsafe links remain inert.

## Owners and checks

- `server/PiSessions.ts` exposes `SessionAction`/`SessionEvent`; `PiRecords.ts` translates Pi
  records and `PiHistoryWorker.ts` reads saved history. `SessionPublication.ts`, `WsClient.ts`
  and `Router.ts` deliver content without a redaction pass.
- `web/src/components/MessageList.tsx` opts into `Markdown.tsx`'s `preserveLineBreaks` rendering;
  `remark-breaks` converts soft breaks in the parsed tree, never in the source string.
- `test/SessionProjection.test.ts`, `SessionDelivery.test.ts`, `SessionHistory.test.ts` and
  `PiProjector.test.ts` cover live, partial, reattachment, saved and tool content. `Api.test.ts`
  and `SocketEgress.test.ts` cover HTTP and WebSocket delivery. `PiRecords.test.ts` retains
  dialog option validation and explicit approval/cancellation.
- `test/Markdown.test.ts` checks soft/hard breaks, CRLF, Markdown structure and unchanged file
  rendering. The [open-session journey](../.agents/skills/verify-piano/features/open-session.md)
  runs `test/browser/message-fidelity.mjs`: actual line positions for `a: 1\nb: 2\nc: 3`,
  original token-like text, streaming, reload and source copying (clipboard check on Linux).
