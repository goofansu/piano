# Image attachment policy

Decision: Pi's events are the source of truth for its queue. Piano does not filter, hide or
reinterpret entries Pi reports, track the queue locally, patch Pi or send operations Pi lacks to
work around this; the fix belongs upstream in Pi.

## Pi owns model preparation

Piano passes accepted images through PiSessions; Pi's preprocessing fits them for the model. Do
not duplicate those policies or modify the user's Pi settings to meet Piano's upload policy. See
the [version-pinned research and sources](../../docs/research/2026-10-06-pi-image-restrictions.md).

## Future changes

Constants live in `shared/session/attachments.ts`; the wire schema and browser use them. Future increases
need concrete user examples plus large-upload checks and a memory/transport review. General file
support needs its own type and policy, not a broader image MIME allowlist.
