# Image attachment policy

Decision: **accepted, 2026-10-06**. Supersedes the initial 5 MiB-per-image / 10 MiB-total
upload policy. This is a Piano input-safety policy, not a new Pi or provider restriction.

## Limits

| Constraint | Limit |
| --- | --- |
| Original file size | **10 MiB per image** (10,485,760 bytes) |
| Image count | **4 per message** |
| Combined original file size | **20 MiB per message** (20,971,520 bytes) |
| Formats | PNG, JPEG/JPG, WebP, GIF |

All three limits apply together; exact boundaries are accepted. Sizes count the original binary
files, before base64 encoding or Pi's processing. A recognized raster signature and matching MIME
are required; arbitrary files and SVG are not supported. GIF acceptance does not guarantee that a
provider supports animation.

Use the attachment button, paste, or drop images into either composer. Previews can be removed
before sending. Image-only messages work. While Pi is working, images can queue with text or alone
as steering or follow-up input. Editing queued messages or stopping restores only text, not images,
matching Pi's queue-restoration API. Unsent image drafts stay in browser memory per session; a full
reload discards them. Queued images survive browser refresh while Pi stays alive; pending queues
do not survive a backend/Pi restart. The queue displays only Pi's text, without attachment counts.

Piano uses the unmodified Pi runtime and takes its queue from Pi's events. Pi 1.2.0 removes a
delivered queue entry by matching its text, so after it delivers an image-only queued message it
still reports an empty entry in `queue_update` and `get_state`'s `pendingMessageCount`. Piano shows
what Pi reports: an empty queue row, and a session that counts as working. Until the row is gone,
Piano does not retire the idle Pi process, refuses to share the session ("Wait for this session to
finish before sharing.") and, if it closes, reports that Pi was released during work. Edit (Pi's
`clear_queue`) or Stop clears the row; including text with an image avoids it.

Decision: Pi's events are the source of truth for its queue. Piano does not filter, hide or
reinterpret entries Pi reports, track the queue locally, patch Pi or send operations Pi lacks to
work around this; the fix belongs upstream in Pi.

Checkouts previously using the queue-metadata patch should run `npm ci` after updating to replace
their patched `node_modules`. The patch installer and its npm postinstall hook have been removed.

## Why this combination

- **10 MiB each:** accommodates typical screenshots and phone photos with fewer manual compression
  steps. The earlier 5 MiB limit rejected files that Pi can successfully resize; the
  [Pi research](research/2026-10-06-pi-image-restrictions.md) demonstrated this with an 8.24 MiB PNG.
- **Four images:** retains a focused, useful allowance for comparisons and multi-screen bug reports
  while limiting simultaneous decoding and model-input growth.
- **20 MiB combined:** allows two maximum-size files or four averaging 5 MiB. The separate total cap
  prevents four 10 MiB files from doubling the intended transfer budget.
- **Not 20 MiB each / ten images / 50 MiB combined:** that earlier suggestion was unnecessarily
  generous for the coding workflow. Base64 alone expands 50 MiB to about 67 MiB, versus about
  **27 MiB** for this decision. JSON parsing, browser previews, process I/O and decoding can hold
  additional copies; the total upload cap is not a claim that memory consumption is only 20 MiB.

## Pi owns model preparation

Piano passes accepted images through PiSessions. Pi's default preprocessing fits each image within
2000×2000 pixels and under 4.5 MiB of **base64-encoded image data**, with model-specific overrides.
These are processing targets, not original-file upload ceilings. Pi settings can disable resizing
or block images. Do not duplicate those policies or modify the user's Pi settings to meet Piano's
upload policy. See the [version-pinned research and sources](research/2026-10-06-pi-image-restrictions.md).

This combination is compatible with Pi's processing, **not a guarantee of provider acceptance**.
Providers also constrain the whole request, including images retained from previous messages,
context tokens and endpoint-specific behavior. A successful local preview does not prove the model
received the image; Pi's omission hints and provider errors remain authoritative.

The registry stores no image bytes (INV-01); Pi owns its processed conversation images. Bounded
preview URLs keep image bytes out of WebSocket snapshots (INV-05). Validation remains in both the
browser and server; the service stays behind private access (INV-11). Protocol translation and
processing remain at the PiSessions seam (INV-12).

**Development environment only.** `npm run dev` runs the backend under `node --watch`, which sets
`WATCH_REPORT_DEPENDENCIES=1` in the process environment. Pi 1.0.2's image-resize worker treats
Node's dependency-watch message as its result, so every attached image was reported as
"could not be resized below the inline image size limit" regardless of size. PiSessions strips
that variable when spawning Pi; `npm start` and the hosted service never set it, so built and
deployed instances were unaffected. A regression test spawns a child with the variable set in the
parent and checks the installed Pi accepts an image.

## Verification and future changes

- A boundary regression failed under the former limits, then passed with 10 MiB each / 20 MiB total.
  It checks exact boundaries, one-byte overflow, four images and rejection of five.
- `npm test`: **57 passed**. `npm run typecheck`: passed.
- `test/browser-attachments.mjs` through `npx agent-browser` on scratch ports 7271/7272: passed.
  Two distinct, valid PNGs of exactly 10 MiB each traversed browser → WebSocket → fake Pi → preview
  route; each read back as exactly 10,485,760 bytes, and reconnect/reload retained the transcript.
  The same journey verifies per-file/count/aggregate rejection and preserves valid draft attachments
  after an over-limit addition.
- The large PNG fixtures use ancillary metadata to reach exact sizes. This proves transport and
  validation, not worst-case pixel decoding, phone-browser memory use or live provider acceptance.
  No paid model call or user-instance mutation was needed.
- Evidence: `/tmp/piano-upload-limits-{red,tests,typecheck,browser}.log` and
  `/tmp/piano-upload-limits-browser/`. Checked against `a615429` plus these changes, Node 24 and
  locked dependencies.

Constants live in `shared/attachments.ts`; the wire schema and browser use them. Future increases
need concrete user examples plus large-upload checks and a memory/transport review. General file
support needs its own type and policy, not a broader image MIME allowlist.

Activation requires a UI build, `piano.service` restart for server validation, and browser reload.
No build, deployment or restart was performed as part of this change; no proxy restart is needed.
