# Radius artifact tools

Ask “Create an artifact containing this report.” With the Radius provider signed in, Piano's
bundled `radius-artifacts` Pi extension publishes the document to Radius and returns its confirmed
viewing URL, artifact ID, revision, visibility and expiration. “Update that artifact” keeps the ID
and URL; “View that artifact” reads the publication, not a file on the Piano host.

The session header counts the artifacts a session published and lists them by title; each opens
its Radius URL in a new tab. The list reads confirmed publication receipts from Pi's active branch,
including publications made inside codemode and before compaction. Legacy direct create/update
results remain supported. Piano keeps no separate publication database.

Artifact requests mean Radius by default. Local files are only staging unless the user explicitly
asks for local delivery. A failed publication is never silently delivered as a local file.

### Use without Piano

This is a standalone Pi package with no Piano imports or environment requirements. From a checkout
with `npm install` completed, try it for one invocation:

```sh
pi --extension /absolute/path/to/piano/extensions/radius-artifacts/index.ts
```

To keep it in standalone Pi's setup, explicitly install the local package:

```sh
pi install /absolute/path/to/piano/extensions/radius-artifacts
```

The package's `pi.extensions` manifest exposes only `index.ts`; `RadiusClient.ts` is a helper,
not another extension. Runtime dependencies belong to the package; Pi supplies its peer packages.
The package is currently private/local, not published to npm. Do not install a second copy into a
Piano session: Piano already supplies it. This change does not install into or restart a running
Piano.

## Confirmation, identity and uncertainty

A successful upload response alone is insufficient. The extension reads artifact metadata and the
pinned new revision, checking identity, canonical URL, visibility, a non-empty manifest and the
unique publication note before returning `status: confirmed`. `view` reads the current metadata
and the selected revision. A confirmed older revision can coexist with newer work; both `revision`
and `latestRevision` are returned.

Give each intended publication a stable `operationKey`, such as `release-report` or
`release-report-revision-2`. Reuse it with identical arguments to reconcile an uncertain call.
A new key is for new, reviewed work, never a retry workaround. The expected revision protects an
update against an already-stale observation; Radius does not provide an inspected atomic
compare-and-swap contract, so concurrent writers can still race. The publication note detects a
different writer at the expected revision rather than claiming that writer's work as ours.

Before a mutation, Pi appends a `radius-artifact-intent-v1` entry to its own history containing the
key, content fingerprint, publication note and known identity. A received identity is appended
before confirmation reads. **An intent is not confirmation.** Only after all read-back checks pass,
the extension appends a `radius-artifact-publication-v1` receipt containing `artifactId`, `title`,
`url`, `revision` and `operationKey`, never document content. Each operation leaves at most one
receipt on the active branch. Live `entry_appended` events and saved branch reads populate the
same header and Artifacts command; a later failure in the outer codemode script does not undo a
publication. Updates retain one entry per artifact ID; reconciling an older revision cannot
replace a newer title. Views, failures and unconfirmed writes add no receipt.

Tool results also carry usable publication metadata in content, structured content and details.
There is no Piano database table or separate identity store.
Intents are reconstructed from the active Pi branch, including after reload/resume; a conversation
fork is not a fork of the external artifact. Keep identity and operation keys in conversation
summaries when compacting. Another session needs the artifact ID and a fresh `view` before updating.

**No mutation is automatically retried.** Repeating an operation key only reads to reconcile.
A lost update reply can be confirmed by its unique note on the pinned revision. An interrupted or
malformed create response that leaves no ID cannot be safely reconciled automatically: the tool
returns `unknown` and asks the user to inspect Radius's Artifacts page. It will not create again.
An unresolved intent stays blocked, even if a request may never have reached Radius. Errors and
unknowns are failed Pi tool results, not successful publication. No local-file fallback exists.

## Contract sources and verification boundary

Implementation follows Pi 1.5.2's extension lifecycle, `ModelRegistry` auth API and package
manifest conventions, the [Radius MCP setup](https://radius.earendil.com/docs/extensions),
[artifact documentation](https://radius.earendil.com/docs/artifacts), and inspected live MCP schemas
for `artifacts_create`, `artifacts_versions_publish`, `artifacts_read`,
`artifacts_versions_read` and `artifacts_files_download`. The SDK discovers server spellings,
including dotted names, instead of assuming Pi's sanitized MCP tool names are wire names.

Regression tests exercise the extension entry point, real Pi credential resolution and the real
MCP SDK against an isolated HTTP adapter. Scratch evidence uses fake credentials and scripted
local model replies. No real publication, account mutation or paid inference is part of these
checks. Live Radius publication, private-link browser access, quotas and transfer-host behavior
remain unverified until separately authorized. INV-01/09/11/12 apply.
