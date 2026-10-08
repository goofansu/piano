# File links

Assistant Markdown links such as `[Open notes](file:///absolute/path/notes.md)` open a browser dialog.
The path refers to the machine running Piano, not the browser's computer. Piano never launches a
server application or claims to open the original in a local default app.

- UTF-8 Markdown and supported text files preview in the dialog.
- PNG, JPEG, GIF and WebP preview as images.
- Other formats (including PDF and SVG) offer **Download a copy**. HTML is plain text, not an app.
- Previews are limited to 2 MiB; downloads to 64 MiB. Downloads contain the copied bytes, not a live
  connection to the original file. Local edits do not update the server.
- Files outside the session workspace require **Allow this file**, naming the exact server path.
  Links that escape through symlinks also require approval. Merely rendering a link reads no file.
  Approval is one-use and expires after five minutes; there are no persistent directory grants.
- Missing, unreadable or changing files fail with guidance instead of launching a native application.

File paths travel in POST bodies. Preview/download URLs use opaque, short-lived capability IDs;
anyone holding such a URL within the private Piano deployment can retrieve that copied file.
Copies expire after ten minutes, may be evicted earlier from the bounded memory cache, and disappear
on server restart. Reopen the link to prepare a new copy.

This preserves the trusted-developer deployment model (INV-11), not multi-user authorization or a
filesystem sandbox. Keep Piano on loopback behind private authenticated access. Session/workspace
identity is checked when preparing a file (INV-07); browser requests require same-origin metadata.
Generated previews do not run HTML or SVG scripts. Requested file contents and exact file identity
metadata are not display-redacted; transcript/error redaction is unchanged. Review files before sharing them.
