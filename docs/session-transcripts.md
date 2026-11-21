# Transcript fidelity

Pi owns session content (INV-01). Transcript messages show Pi's text without secret redaction:
user and assistant messages, streaming replies, tool arguments and results, context rows, and
queued messages, including those Stop restores to the composer
([ADR 0005](adr/0005-faithful-transcript-messages.md)). Piano still strips terminal control
sequences. Other surfaces keep redaction, including dialog titles, messages and options, extension
status and widgets, notices, errors, HTTP responses other than voice transcripts, file previews and
webhooks. History files remain untouched; structural projections,
size limits and folding still apply.

Ordinary single newlines in transcript Markdown produce visible line breaks in user messages,
streaming and settled assistant replies, context rows and dispatched answers. No code fence,
trailing spaces or blank lines are required. Markdown lists, tables, links and code keep their
grammar; copying a response uses its original Markdown source. File Markdown, including expanded
skill bodies, keeps standard soft-break behavior. HTML and unsafe links remain inert.

## Owners and checks

- `server/features/sessions/pi/PiRecords.ts` builds transcript rows with `stripControls()` from
  `server/shared/DisplayProjection.ts`, which strips control sequences only, including any that one strip
  reassembles. That module's `projectSnapshot()`, `projectSessionEvent()` and
  `projectServerMessage()` apply only `stripControls()` to queued messages and `queue_restored`
  results, and `compileRedaction()` to everything else they carry. Its `SAVED_BACK_FIELDS` names
  the text the UI saves back (project names and instructions, session titles and names, editor
  dialog prefills and extension editor text), which gets the same control stripping without
  redaction. The voice `transcribe` endpoint in `shared/features/voice-input/http.ts` sets `redact: false`. `server/features/sessions/pi/PiSessions.ts` returns action results
  unredacted; they are redacted where they leave the server.
- `web/src/features/sessions/transcript/MessageList.tsx` opts into `Markdown.tsx`'s `preserveLineBreaks` rendering;
  `remark-breaks` converts soft breaks in the parsed tree, never in the source string.
- `test/features/sessions/pi/SessionProjection.test.ts` checks original text in live, partial and reloaded messages and
  redaction of statuses, widgets, notices, dialogs, errors and exits. `SessionDelivery.test.ts`,
  `SessionHistory.test.ts`, `PiProjector.test.ts` and `PiIdentity.test.ts` cover streaming,
  reattachment, saved history and tool content. `DisplayProjection.test.ts` and `PiSessions.test.ts`
  check queued and restored text, session titles, dialog prefills and extension editor text as
  typed beside redacted state, results and notices; `VoiceInputHttp.test.ts` checks a transcript
  comes back as heard.
- `test/Markdown.test.ts` checks soft and hard breaks, CRLF, Markdown structure and unchanged file
  rendering. The [open-session journey](../.agents/skills/verify-piano/features/open-session.md)
  runs `test/browser/message-fidelity.mjs`: line positions for `a: 1\nb: 2\nc: 3`, original
  token-like text, streaming, reload and source copying (clipboard check on Linux).
