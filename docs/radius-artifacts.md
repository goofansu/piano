# Radius artifact tools

Ask “Create an artifact containing this report.” With the Radius provider signed in, Piano's
bundled `radius-artifacts` Pi extension publishes the document to Radius and returns its confirmed
viewing URL, artifact ID, revision, visibility and expiration. “Update that artifact” keeps the ID
and URL; “View that artifact” reads the publication, not a file on the Piano host.

Artifact requests mean Radius by default. Local files are only staging unless the user explicitly
asks for local delivery. A failed publication is never silently delivered as a local file.

## Loading and authentication

Piano loads `extensions/radius-artifacts/index.ts` by absolute `--extension` path for every Pi
child. At `session_start`, **before registering any tools**, the extension checks the Radius
provider's configured-auth status and resolves its credential through Pi's `ModelRegistry`.
Signed-out sessions expose none of these tools. Unresolvable credentials also fail closed.
Sign in through Piano's Providers settings (or Pi's `/login radius`) and start a new session;
standalone Pi can also `/reload`. The extension re-resolves authentication on each invocation.
Pi owns OAuth refresh, stored credentials and API-key resolution, including `RADIUS_API_KEY`.
Having a configured credential is not proof that Radius will accept it; revoked credentials and
permission failures are reported when connecting or calling the service.

No configuration or credentials are installed by the extension. It uses the official
`https://radius.pi.dev/mcp` with the Radius provider credential, independent of the user's optional
Radius MCP configuration. It neither enables the entire MCP catalog nor depends on its exposed
names. It discovers the actual names with `tools/list` and calls only artifact operations through
the MCP SDK. Credentials, provider error bodies and presigned transfer URLs are never tool
arguments, log messages or returned results. Redirects are refused. Custom gateways and non-Radius
transfer hosts are deliberately unsupported, rather than silently sending credentials elsewhere.

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

## Tool contract

| Tool | Inputs | Successful result |
| --- | --- | --- |
| `radius_artifact_create` | `operationKey`, `title`, `content`, `contentType` | Confirmed private publication, ID, revision, Radius URL, visibility, expiry. |
| `radius_artifact_update` | Same document inputs, existing `artifactId`, `expectedRevision` | Confirmed new revision, same ID and URL; existing visibility retained. |
| `radius_artifact_view` | `artifactId`, optional `revision` and artifact `path` | Metadata, pinned revision manifest, URL and textual content for the selected file (automatically selected for single-file artifacts). |

New artifacts explicitly use **private**, irrespective of an organization's public default.
Only the publisher can view a private artifact, subject to Radius's organization ownership and
transfer policies. These tools do not widen access. Updates omit the visibility parameter and
verify visibility is unchanged on read-back. A concurrent visibility change is reported as
unconfirmed, not silently reversed. To share more widely, explicitly use Radius's own visibility
controls; do not confuse this tool with Piano's organization-only session-sharing feature in
`server/RadiusArtifacts.ts`, whose policy is unchanged.

Supported publication inputs are UTF-8 Markdown, HTML, Mermaid, CSV, NDJSON and asciinema text,
up to **128 KiB**. These are extension limits, not claims about Radius quotas. Update replaces the
file set (`fresh=1`); previous revisions remain available, so an update is not a way to erase old
sensitive content. Multi-file/binary upload, deletion, TTL and visibility management remain Radius
MCP/UI operations, not these three tools. View can inspect other artifacts' manifests, but reads
text only, at most 128 KiB; larger or unsupported content must be opened at the viewing URL.
Returned content is untrusted data, not instructions. No content is staged automatically on disk.

The tools leave TTL unspecified, preserving the artifact's configured lifetime or Radius's
organization default. They report the actual `expires_at`. Radius normally expires artifacts
90 days after publication; organization policy can change that, up to the service maximum of
365 days. Expired/deleted publications are not permanent archives. Review content for secrets
before publishing; the extension does not claim automatic content redaction.

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
before confirmation reads. Tool results carry the usable publication metadata in content,
structured content and details. There is no Piano database table or separate identity store.
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

Implementation follows Pi 1.4.0's extension lifecycle, `ModelRegistry` auth API and package
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
