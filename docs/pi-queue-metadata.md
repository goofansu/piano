# Pi queue metadata

Piano's pinned Pi 1.2.0 runtime carries the checked-in
[`queue metadata patch`](../patches/@earendil-works+pi-coding-agent+1.2.0.patch).
This is a local compatibility patch, not a released upstream capability. Normal `npm install`
and `npm ci` apply it through [`scripts/apply-pi-patch.mjs`](../scripts/apply-pi-patch.mjs).
Git is required, as for Piano's repository features. If installing with `--ignore-scripts`, run
`npm run postinstall` explicitly before starting Piano.

## Ownership and wire contract

Pi owns the queued user message objects, images and delivery semantics (INV-01/03). The patch
retains each actual message object with a monotonically assigned ID, scoped to that AgentSession.
Delivery removes the entry by object identity, not matching text. This distinguishes duplicate
text, steering versus follow-up, and image-only messages. IDs are not persisted conversation IDs
or retry/deduplication keys, and must not be carried across host generations.

`queue_update` and `get_state` expose `queuedMessages` entries:

```json
{"id":"2","kind":"steering","text":"look here","attachmentCount":1}
```

Counts come from the queued message's image content blocks, after Pi's input processing. The
existing `steering`/`followUp` string arrays and text-returning getters remain compatible.
`clear_queue` still returns only those text arrays; Edit and Stop restore text only.

PiRecords validates the metadata and translates it to Piano's wire vocabulary. Session publication
retains it in the same ordered snapshots and events as queue text (INV-05). The browser displays
a paperclip/count badge only for known positive counts. It does not cache uploads, match text,
or reconstruct queue membership. No image bytes are added to queue snapshots or Piano's database.
A custom, unpatched `PIANO_PI_CLI` still works through the legacy string-array protocol; missing
counts are unknown, not zero, and no badge is shown. Invalid metadata is not accepted as queue facts.

## Refresh and restart

- Once accepted by Pi, queued images and their counts survive browser refresh/disconnect and are
  shared by tabs while the same server-owned Pi process remains alive (INV-02/05).
- A reconnect observes current state; it never resends queued input.
- Unsent image drafts remain browser-memory-only and are lost on a full reload.
- A backend/Pi restart loses pending queues. This patch does not provide durable queues or recovery.
- Consumed images become Pi-owned conversation history; queue metadata is removed before the user
  message is published. Image-only entries are removed too.

## Maintenance and checks

The Pi dependency is exact-pinned. The installer is idempotent, checks the installed version and
fails on patch conflicts. Do not bypass failures when upgrading. Review the new Pi/core queue
implementation, especially whether delivered user messages preserve object identity; regenerate or
remove this patch only after the locked-runtime checks pass (INV-12). The installed declarations
are patched alongside the runtime; no history format or model-facing message fields are added.

- `test/PiQueuePatch.test.ts`: fresh application, repeat application, incompatible source/version.
- `test/RealPiQueue.test.ts`: real Pi with a local model stream; duplicate text with different
  counts, image-only input, stable reattach snapshots, consumption delivering images, text-only
  restoration, and no extra model request from abort/restore.
- `test/PiProjector.test.ts`: metadata in events/initial state, legacy fallback, malformed counts
  and duplicate IDs rejected.
- Scratch browser evidence checks count badges, image-only/text-only rows, refresh without replay,
  two tabs, and text-only Edit. The browser script is deliberately uncommitted.

The patch can be retired when upstream provides an equivalent authoritative queue identity and
attachment-metadata contract. Do not replace it with browser-side or text-matched count tracking.
