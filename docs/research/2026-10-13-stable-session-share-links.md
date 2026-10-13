# Stable Radius links for session sharing

## Claim and policy

Repeated, explicit shares of one registered session publish new Radius versions at one URL,
including after a Piano restart. Separate sessions have separate destinations. A failed revision,
missing/expired artifact, changed organization, changed visibility or lost access must never silently
allocate a replacement link. Earlier published versions remain available; the dialog says so.

Preserves **INV-01/02/07/11/12**: Pi owns the saved branch; Radius owns artifacts and revisions;
Piano owns the session-to-integration association and confirmation policy. No model call, MCP
configuration, second Pi child, transcript copy or credential storage is added. Sharing reads a
saved snapshot once per invocation; later versions include newer saved messages.

## Implementation

- SQLite schema **4** adds nullable `sessions.radius_share`; existing schemas 1–3 upgrade in one
  transaction. The record holds only organization ID, artifact ID and canonical URL. It survives
  title/project/pin changes and restart, and is excluded from sidebar projections/discovery triggers.
- The signed-in provider credential resolves through Pi as before. Radius
  `GET /v1/organization/settings` identifies the organization bound to that request's credential.
- First share allocates an **empty** artifact with JSON `POST /v1/artifacts`, organization visibility.
  A compare-and-set saves the destination before any transcript can be uploaded. Failed persistence,
  session deletion/archive, or competing allocation publishes no transcript; an orphan can only be empty.
- First and later content publications use `POST /v1/artifacts/{id}/versions` with
  `application/x-ndjson`, `fresh=1`, and explicit organization visibility. Fresh publication replaces
  the revision's file set rather than inheriting extra files. Later shares first verify the saved
  artifact's identity, URL, visibility and revision permission. They never fall back to creation.
- Only a matching organization-only response at the saved URL counts as success. Uncertain version
  responses retain the destination. Overlapping requests join one operation; there is no automatic
  publication retry. A deliberate retry can create an extra revision, but not a new published URL.

API source: the official Radius MCP catalog inspected in this session (descriptions/schema only,
no operations executed): `organizations_settings_read`, `artifacts_create`, `artifacts_read`, and
`artifacts_versions_publish`. The create schema explicitly permits a JSON body to allocate an empty
scratch artifact; revision publication accepts the artifact identifier, optional `fresh=1`, visibility
and JSONL media type. Public background: [Radius artifacts](https://radius.earendil.com/docs/artifacts).

## Verification

Tested `50bccca` plus this patch on Linux, Node 24.21.0, installed Pi 1.1.0, agent-browser/Chromium.

- `npm test`: **480 passed**, 0 failed/skipped; `/tmp/piano-share-version-tests.log`.
- `npm run typecheck` and `npm run lint`: passed; `/tmp/piano-share-version-{types,lint}.log`.
- Final focused rerun: 26 tests passed across SessionSharing, Registry and SidebarViewUpdates;
  `/tmp/piano-share-version-focused.log`. Includes a newer saved message on subsequent revisions.
- Module/HTTP coverage: stable URL and distinct session identity; fresh persistence/sharing service
  reuse; allocation-before-upload persistence; initial and subsequent revision failures; concurrency;
  403/404/410/503, wrong organization, public/private visibility, denied revision capability, wrong
  returned identity, unsafe URLs and timeout; failed database writes and deletion during allocation;
  schema 1–3 upgrades, restart, immutable association and no session resurrection; no extra sidebar
  traffic or link disclosure. Existing redaction, saved-branch and Pi-ownership checks remain.
- Scratch browser, backend **7171** and Vite **7172**: shares from an unselected sidebar row reuse one
  URL through versions 1–4, including a **full scratch-backend restart** and browser reload. A failed
  version can be retried at the same link; an unavailable artifact neither uploads nor creates a
  replacement; the selected session's palette Share creates a distinct destination. Copy, Cancel and
  desktop/mobile confirmation were observed. No model prompts were submitted.
  `/tmp/piano-share-versions-browser/run.log` and `/tmp/piano-share-versions-browser/evidence/`.
- Both critical browser journeys passed using the current database schema; output in
  `/tmp/piano-share-versions-browser/critical.log`, with `start-evidence/` and `open-evidence/` alongside.

The scratch scripts stay uncommitted. The harness stopped only its owned processes and removed its
repositories, database and isolated Pi history. No user's database, backend or account was changed.

## Limits

Radius HTTP responses were simulated; the browser used Pi's real credential resolver with synthetic
scratch credentials. No live upload or Radius viewer test was performed. Server endpoint compatibility,
actual permissions and retention remain subject to the real service; no live-upload success is claimed.

Previously created links cannot be adopted automatically because older Piano did not retain their
identities. The first share after this update establishes the reusable destination. A deleted/expired
artifact has no replacement workflow yet: sharing refuses to change its URL. Deleting the local session
removes its association, not the external artifact. Restoring an old database backup can lose associations.
A failed initial empty allocation/save can leave an empty orphan; it cannot leave a transcript at an
unrecorded destination. Concurrent edits or visibility changes performed directly in Radius remain
Radius's policy boundary. No deployment is implied.

## Success-dialog icon actions

On `4d94f14` plus the UI-only patch, Copy and Open moved into the URL's InputGroup with tooltips
and accessible names. Copy shows a checkmark for two seconds and announces success inline; failure
keeps the manual-copy fallback. Open uses a new-tab link. The success footer is gone, replaced by
the standard top-right close control; confirmation and error actions are unchanged.

`npm test` (480 passed), typecheck and lint passed; logs are `/tmp/piano-share-icons-{tests,types,lint}.log`.
The scratch-browser journey observed exact clipboard contents, checkmark/reset, denied clipboard
access, selectable URL, both tooltips, native new-tab opening, close ×, Escape, keyboard order,
and desktop light/mobile dark layout. The viewer navigation was intercepted, and Radius uploads
used the same synthetic boundary as above. Evidence: `/tmp/piano-share-icons-browser/run.log` and
`/tmp/piano-share-icons-browser/evidence/`. Scratch resources were cleaned up. No new module test
was added: the changed contracts are browser interactions composed from existing controls.

## Artifact titles

On `fb3c6db` plus the title patch, creation and revision requests name the artifact
`Pi session <full session ID>` (INV-07). Existing request-boundary tests now assert the title on
initial allocation and every revision, including a different session. All 480 tests, typecheck and
lint passed; `/tmp/piano-share-titles-{tests,types,lint}.log`. A scratch-browser share confirmed the
new title, then updated a simulated old “Pi session” title at the same URL on re-share:
`/tmp/piano-share-titles-browser/run.log` and `evidence/`. Same Linux/Node/Pi environment and
synthetic Radius boundary as above; no real artifact was published or renamed, and no deploy.

## Remove the repeated success description

On `7392635` plus the UI-only patch, success omits the audience/version description and its ARIA
reference; confirmation keeps its description. All 480 tests, typecheck and lint passed
(`/tmp/piano-share-no-description-{tests,types,lint}.log`). The desktop/mobile scratch journey
confirmed description presence before sharing, absence after success, no dangling `aria-describedby`,
and unchanged copy/open/close/keyboard behavior. Evidence:
`/tmp/piano-share-icons-browser/no-description-run.log` and `no-description-evidence/`.
Same isolated environment and synthetic upload boundary; no new deployment or live publication.
