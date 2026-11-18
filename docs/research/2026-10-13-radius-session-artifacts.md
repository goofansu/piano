# Radius artifacts for sharing Pi sessions

Research date: 2026-10-13. Scope: official Radius documentation, the connected Radius MCP tool descriptions/schemas, and the prior installed Pi 1.1.0 source inspection. No artifacts were created, account settings inspected or changed, or sessions uploaded. Research was performed directly because no background research agent was available.

## Conclusion

**Yes: Pi's Radius `/share` path creates a Radius artifact.** It uploads the current session branch as `application/x-ndjson` to `POST /v1/artifacts`, explicitly selects `visibility=organization`, and returns `artifact.canonical_url`. It also includes the current system prompt and tool schemas. This is not a separate session-sharing service. [1]

**Assessment:** a good fit for deliberate, temporary session sharing, especially with an existing Radius organization. It already supplies a native Pi conversation viewer, hosting, access control, revisions, expiry, and deletion. It is not a permanent archive or an immutable evidence store. Public sharing is supported by Radius, but is not what installed Pi's built-in `/share` selects. [1][2][6]

## Benefits

| Benefit | Evidence and implication |
| --- | --- |
| Native Pi session viewer | Radius explicitly renders uploaded Pi session files as readable conversations. No Piano-hosted transcript viewer is required for this use case. [2] |
| Access controls | Private means only the publisher; organization means members of the organization; public means anyone with the link. The owner can change visibility later. [2][6] |
| Existing account boundary | Artifacts belong to the organization selected at Pi login. API keys are also organization-scoped. [2][3] |
| Revision history | Existing artifacts can receive new revisions, with earlier versions and publisher attribution retained. The API exposes revision metadata and original file download. [2][6] |
| Explicit lifecycle | Per-artifact retention and deletion are supported, alongside organization defaults. Metadata includes `expires_at`, `visibility`, revision number, byte counts, and caller capabilities. [2][6] |
| More than transcripts | HTML, Markdown/Mermaid, CSV, JSON/JSONL, terminal recordings, and multi-file sites are supported. The same service can hold reports associated with a session. [2] |

## Limitations and trade-offs

### 1. Links expire; this is not a backup

The documented baseline is **90 days after the latest publication**. Organization defaults and per-artifact lifetimes can change this. The service-wide maximum lifetime is **365 days / 31,536,000 seconds**, and a requested lifetime must fit the organization's configured maximum. A revision publication refreshes expiry; the TTL update operation resets expiry from the current time. This is a maximum lifetime per reset/publication, not proof that an artifact cannot be renewed beyond a year. Expired or deleted artifacts cannot be restored. [2][6]

Organization retention-policy changes do not recalculate existing expiry timestamps; lower maxima cap stored custom TTL overrides for future publishes. Visibility-default changes likewise do not retroactively change existing visibility. Use actual returned metadata rather than assuming every link lives 90 days. [6]

### 2. Public is link-accessible, not restricted sharing

Radius defines public as **anyone with the link can view it**. There is no documented per-recipient invitation, password, or group-level artifact ACL in the inspected artifact interfaces. Private/organization/public are the documented choices; indexing behavior is unspecified. A recipient can copy the data, so later deletion or visibility reduction cannot retract their copy (general sharing risk). [2][6]

Pi 1.1.0 explicitly chooses organization visibility, overriding the organization's default. Its `/share` command does not expose a public/private or TTL selector in the inspected implementation. Radius itself supports explicit visibility and `ttl_seconds` on publication. [1][6]

### 3. Shared artifacts are collaboratively revisable

Any member of the owning organization can publish a new revision to an organization-visible **or public** artifact. This does not mean arbitrary public viewers can edit. Only the artifact owner can change visibility. Do not represent the latest shared artifact as an immutable transcript controlled solely by the original publisher. Revision attribution and pinned revision metadata are available. [2][6]

Visibility changes affect **every revision**. Earlier versions remain available: uploading a redacted replacement is not enough to remove sensitive content from older versions. The exposed delete operation removes the artifact and all revisions; no single-revision deletion operation appeared in the inspected MCP catalog. [2][6]

When a member leaves or is removed, their artifacts transfer to an organization owner. Thus private visibility should not be mistaken for permanent ownership independent of the organization. [2]

### 4. It publishes a snapshot, not a live session

Pi's built-in share path makes a fresh `POST /v1/artifacts` request on each invocation; it does not remember an artifact ID or publish revisions to an existing share. Radius supports revision publication, but that is additional behavior beyond Pi's current command. Nothing in this path continuously synchronizes later messages. [1][6]

Pi uploads the **current branch**, not the full branching session file, and adds current system-prompt/tool-schema metadata. The export is not just the rendered user and assistant messages. The inspected serialization contains no redaction step: prompts, tool output, file contents, paths, and exposed credentials need review before publishing. [1]

### 5. Radius is an external dependency

The service is currently closed source and deployed with Cloudflare. Availability, viewer compatibility, account permissions, and continuing service operation remain external dependencies. The inspected docs do not give an artifact SLA or a self-hosted option. [5]

The pricing page's no-persistence/ZDR discussion applies to **inference data**, not artifacts deliberately stored for later viewing. It must not be presented as an artifact data-handling guarantee. Artifact-specific storage region, backup erasure timelines, encryption details, and training-use terms were not established by this research. [2][4]

### 6. RPC integration still needs work

Installed Pi 1.1.0 does not expose built-in `/share` or a JSONL-export command through RPC. It does expose HTML export, but that has different scope: the HTML contains all session entries rather than only the current branch. Radius's artifact API/MCP supplies upload operations; that does not automatically make Pi's interactive command callable from Piano. This note makes no implementation choice. [1]

## Operational limits: known versus unknown

| Area | Finding |
| --- | --- |
| Retention | Baseline 90 days since publication; service maximum 365 days per lifetime setting, constrained by organization policy. [2][6] |
| Transfer URLs | MCP file upload/download operations return presigned URLs valid for at most 10 minutes; a separate HTTP transfer moves the bytes. This is separate from the share link's expiry. [6] |
| Upload/file size | **Not established.** No numeric maximum found in the inspected public docs or tool schemas. |
| Total storage, file count, revision/artifact count | **Not established.** Byte/count metadata is exposed, not quota guarantees. |
| Rate limits and large-session viewer performance | **Not established.** No large upload or viewer test performed. |
| Artifact hosting/upload/bandwidth prices | **Not established.** The pricing page specifies models and web search, but no artifact tariff. Do not infer free or unlimited. [4] |
| Image attachments/custom session entries | Native Pi session rendering is documented, but exact fidelity and supported session-format versions were not specified. Test representative transcripts before promising full fidelity. [2] |
| Automatic secret removal | Not promised by inspected docs; absent from the inspected Pi export path. [1][2] |

A targeted follow-up search for artifact quotas/pricing did not resolve the missing limits. Ask Radius at `feedback@earendil.com` for maximum raw/decompressed upload size, storage/revision quotas, rate limits, charges, and artifact-specific privacy guarantees before relying on large or sensitive sessions. The contact is provided by Radius's docs. [5][7]

## Recommendation

Proceed with Radius as the preferred **sharing destination**, with the product expectation of an explicitly published snapshot, not an archive or live mirror. Before implementing, settle the intended audience (organization-only versus public-link), disclosure scope, and expiration behavior. Before general availability, resolve the undocumented limits and test a synthetic session containing tool output, images, and custom entries. No real session needs to be published merely to validate integration mechanics.

## Sources

1. [Installed Pi 1.1.0 sharing/RPC source research](2026-10-13-pi-share-rpc.md), including exact dependency-file references.
2. [Radius: Artifacts](https://radius.earendil.com/docs/artifacts), fetched 2026-10-13.
3. [Radius: Organizations](https://radius.earendil.com/docs/organizations), fetched 2026-10-13.
4. [Radius: Pricing and billing](https://radius.earendil.com/docs/pricing), fetched 2026-10-13.
5. [Radius: FAQ](https://radius.earendil.com/docs/faq), fetched 2026-10-13.
6. Official Radius MCP catalog available in this session, inspected 2026-10-13; schema descriptions only, no operations executed:
   - `artifacts_create`: `POST /v1/artifacts`, formats, visibility, TTL, metadata.
   - `artifacts_versions_publish`: `POST /v1/artifacts/{slug}/versions`, member permissions and expiry refresh.
   - `artifacts_read`, `artifacts_versions_read`: metadata, history, pinned revision manifests.
   - `artifacts_visibility_update`: owner-only, applies to all revisions.
   - `artifacts_ttl_update`: reset expiry, custom/default TTL.
   - `artifacts_delete`: permanently deletes all revisions.
   - `artifacts_files_download`, `artifacts_scratch_files_put`: original-byte transfers and 10-minute presigned URLs.
   - `organizations_artifactTtlPolicy_update`: maximum and non-retroactive policy behavior.
   - `organizations_artifactVisibilityPolicy_update`: non-retroactive default visibility.
7. [Radius documentation](https://radius.earendil.com/docs), fetched 2026-10-13.

Verification: public-document and schema review only; no upload, permission, deletion, expiry, viewer-fidelity, or quota tests. Documentation-only changes require no application run or new regression tests.
