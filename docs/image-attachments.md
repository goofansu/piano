# Image attachment policy

Decision: Pi's events are the source of truth for its queue. Piano does not filter, hide or
reinterpret entries Pi reports, track the queue locally, patch Pi or send operations Pi lacks to
work around this; the fix belongs upstream in Pi.

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

Constants live in `shared/attachments.ts`; the wire schema and browser use them. Future increases
need concrete user examples plus large-upload checks and a memory/transport review. General file
support needs its own type and policy, not a broader image MIME allowlist. The
[text-file checking research](research/2026-10-15-text-file-validation.md) proposes sharing the
workspace preview's strict UTF-8, NUL-free, 1 MiB text rule. Composer text uploads and their
aggregate/context budget remain unimplemented; this does not change the image policy above.

Activation requires a UI build, `piano.service` restart for server validation, and browser reload.
No build, deployment or restart was performed as part of this change; no proxy restart is needed.
