# ADR 0005: Faithful display content

- Status: Accepted
- Related: [INV-01 and INV-11](../development-invariants.md), [transcript contract](../session-transcripts.md)

Piano displays what Pi provides rather than guessing which text is sensitive. Heuristic redaction
changed ordinary examples, partial words, tool arguments and approval proposals, making the browser
disagree with Pi's authoritative history. Remove Piano's content-redaction layer entirely, not just
for conversation messages: HTTP/WebSocket responses, dialogs, file previews, webhook payload text,
preview logs and opt-in Pi transport diagnostics retain their source content within existing size
limits. This supersedes INV-11's previous blanket instruction to redact browser/export content.

Private authenticated access, origin checks, safe rendering, explicit save/cancel approval and
credential-specific APIs remain required. Credential storage stays write-only where specified;
peer authentication tokens remain private transport configuration. These controls do not rewrite
message content. Markdown continues to treat HTML and unsafe links as untrusted.

Content may contain real secrets, including in logs and external webhook deliveries. Users must
review it before sharing, publishing evidence or configuring receivers; Piano does not promise
sanitized exports. Keeping selective heuristic redaction was rejected because the same content
would still change depending on its delivery path.
