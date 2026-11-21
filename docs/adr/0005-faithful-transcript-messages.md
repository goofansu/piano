# ADR 0005: Faithful transcript messages

- Status: Accepted
- Related: [INV-01 and INV-11](../development-invariants.md), [transcript contract](../../features/sessions/session-transcripts.md)

Transcript messages show what Pi wrote. Heuristic secret redaction changed ordinary examples,
partial words and tool arguments, so the conversation in the browser disagreed with Pi's
authoritative history. Messages, streaming replies, tool calls and results, and context rows
therefore skip secret redaction; terminal control sequences are still stripped. Queued messages,
and those Stop restores to the composer, are the user's own text on its way into the transcript, so
they are faithful too: a redacted restore would resend altered text to Pi. Session titles, like
project names and instructions, are the user's own text that the UI saves back: Rename starts from
the shown title, and the registry mirrors Pi's name from session state. They leave as written,
controls stripped; a redacted title would be stored with `[REDACTED]` in it. The same holds for
text the UI hands back as a starting draft: an editor dialog's prefill, which the reply starts from
and returns to Pi, the editor text an extension offers to append to the composer, and a voice
transcript placed in the composer.

Everything else keeps the existing redaction: dialog titles, messages and options, library
proposals, extension status and widgets, notices, errors and session-closed details, other HTTP
responses, file previews, webhook payloads, preview logs and transport diagnostics.

A transcript can now contain real secrets. Users must review it before sharing screenshots or
copied text. Removing redaction everywhere was rejected because only the conversation needs to match
Pi's history.
