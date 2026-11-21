# Radius artifact tools

Artifact requests mean Radius by default. Local files are only staging unless the user explicitly
asks for local delivery. A failed publication is never silently delivered as a local file.

### Use without Piano

This is a standalone Pi package with no Piano environment requirements. It imports dependency-free
modules from the checkout's `shared/` and `server/shared/LocalFile.ts` by relative path, so load it from a
checkout rather than a copied folder. From a checkout with `npm install` completed, try it for one
invocation:

```sh
pi --extension /absolute/path/to/piano/features/radius/extension/index.ts
```

To keep it in standalone Pi's setup, explicitly install the local package:

```sh
pi install /absolute/path/to/piano/features/radius
```

The package's `pi.extensions` manifest exposes `extension/index.ts`. The shared SDK client lives in `server/RadiusClient.ts`. Runtime dependencies belong to the package; Pi supplies its peer packages.
The package is currently private/local, not published to npm. Do not install a second copy into a
Piano session: Piano already supplies it. This change does not install into or restart a running
Piano.

## Confirmation and uncertainty

**No mutation is automatically retried.** Repeating an operation key only reads to reconcile; a
new key is for new, reviewed work, never a retry workaround. A create response that leaves no ID
returns `unknown` and is not created again. An intent is not confirmation. No local-file
fallback exists.

## Publishing from a file

`radius_artifact_create` and `radius_artifact_update` take the document either as `content` or as
`path`, exactly one of them. `path` names a local file, absolute or relative to the session's
working directory. The extension reads it and publishes its exact text, so a large page does not
have to be written out by the model or stored in the session history. The file is the staging copy
only: the result is still the confirmed Radius URL, never the local path.

The file must be a readable, non-empty, valid UTF-8 text file within the [file bound](#file-size).
Anything else is refused before any request, with a message that does not repeat the path. The
tool reads any file the Pi process can read, as Pi's own `read` tool does, and the model may not
have seen its contents; review the file for secrets before publishing.

The session prompt tells the model to publish a long document, or one already on disk, by `path`.
Pi does not execute a tool call whose response was cut off at the output token limit, so a document
too long to write inline as `content` publishes nothing and only costs the tokens.

An `operationKey` is bound to the text that was read. Retrying with the same key re-reads the
file: unchanged text reconciles as before, and changed text is refused as different content, not
published.

## Reading text in chunks

`radius_artifact_view` keeps `content` as a string, but returns only one page. Its optional
`offset` is a zero-based **UTF-8 byte offset**, not a character or line number; it defaults to 0.
`maxBytes` defaults to 16 KiB (16384), accepts 4–32768 bytes, and bounds the returned text.
The minimum lets every UTF-8 codepoint fit so a non-EOF page always makes progress. Pages stop before a split codepoint, so a page can be shorter than requested even before EOF.
Single-line HTML and NDJSON can be paged without line-length assumptions.

A text result also returns `path`, `offset`, `totalBytes` (actual downloaded size) and `nextOffset`.
A non-null `nextOffset` means the content is incomplete. Continue by sending the returned
`artifactId`, **`revision`**, `path` and `offset: nextOffset`; do not omit the revision or use
`latestRevision`, which may have advanced. A nonzero offset requires a revision. `nextOffset: null`
means EOF. Reading exactly at EOF, including an empty file at offset 0, returns `content: ""` and
`nextOffset: null`. An offset beyond EOF or inside a UTF-8 codepoint returns an error, not a rounded
position. Pi applies its normal schema argument coercion before execution.

For example, after `{ revision: 2, path: "index.md", nextOffset: 16383, ... }`, the next call is:

```json
{ "artifactId": "your-artifact-id", "revision": 2, "path": "index.md", "offset": 16383 }
```

Each call downloads the entire selected file into memory before returning the page: no HTTP Range
support, local file, cache or automatic continuation is assumed. Downloads are capped at **25 MiB**
(see [File size](#file-size)) and retain the request's
60-second deadline and cancellation. Repeated pages repeat that download cost. Invalid UTF-8 is
rejected rather than silently replaced. Read only the pages needed for the task.

The page budget measures unescaped content bytes, **not tokens or total serialized result bytes**.
JSON escaping can expand text by up to six times, so pages also stop before their JSON-escaped text
exceeds 32 KiB (excluding the string delimiters). Metadata and the manifest add overhead; neither
budget promises an exact token count. Structured callers receive the same bounded string. The
separate MCP reply cap remains 4 MiB. Multi-file artifacts without a selected path, empty manifests
and non-text files still return metadata and
manifest only, without content or page fields. Transport credentials and signed URLs stay internal.

## File size

One bound covers every Piano function that sends a file to Radius or reads one back:
`RADIUS_ARTIFACT_FILE_BYTES` in [`shared/radius/radiusArtifacts.ts`](../../shared/radius/radiusArtifacts.ts),
**25 MiB** of UTF-8 bytes per file. It is Radius's documented per-file limit.

Source: <https://radius.pi.dev/v1/openapi.json>, in the description of the **Artifacts** tag under
"Limits" (search the document for "Each file is limited"):

> Each file is limited to 25 MiB, a revision may contain at most 1000 files, and an artifact may
> contain at most 100 revisions.

| Function | Over the bound |
| --- | --- |
| `radius_artifact_create` / `update` document, from `content` or `path` | Refused before any request; never truncated |
| `radius_artifact_view` download | Stopped and reported as an error; never truncated |
| [Session Share](../sharing/README.md) saved JSONL | Refused before any upload |

The create/update `content` schema also carries the number as a codepoint length, which is looser
than the byte check that decides. View page sizes are a separate, model-facing budget. Radius's
other limits, 1000 files per revision and 100 revisions per artifact, are left to Radius to
enforce. Piano publishes through Radius's MCP tools with the text inline; that route accepting
25 MiB is unverified against the live service.

## Owners and verification

- [`features/radius/extension/index.ts`](extension/index.ts) registers
  create/update/view, validates tool arguments through Pi's schemas and pins view revisions.
- [`RadiusClient.ts`](server/RadiusClient.ts) owns bounded MCP/transfer
  requests and UTF-8 page reads; Radius remains the owner of revision content.
- [`server/shared/LocalFile.ts`](../../server/shared/LocalFile.ts) reads a document given by `path`: regular files
  only, bounded, cancellable and refused if its length changes during the read. File previews and
  Session Share read through it too.
- [`shared/radius/radiusArtifacts.ts`](../../shared/radius/radiusArtifacts.ts) defines the additive structured
  result contract and publication receipts; viewing does not write a receipt.
- [`features/radius/tests/RadiusArtifactExtension.test.ts`](tests/RadiusArtifactExtension.test.ts) exercises the
  registered tools using real Pi argument validation, credential resolution and session history,
  plus the real MCP SDK against an isolated HTTP adapter with fake credentials. Run:
  `node --test --import ./test/setup.ts features/radius/tests/RadiusArtifactExtension.test.ts`.
  It covers exact Unicode reconstruction, pinned continuation while latest advances, 25 MiB reads,
  page/download bounds, EOF, invalid offsets, abort, manifest selection and credential containment.
- The [Open a session recipe](../../.agents/skills/verify-piano/features/open-session.md) covers the
  Artifacts menu's confirmed-publication links. Its fake tool results do not prove chunk reading;
  use the extension check above for that API contract. Chunk reads change no browser controls or
  rendering and add no transcript row kind.

Live Radius publication, private-link browser access, quotas and transfer-host behavior remain
unverified until separately authorized. The extension harness proves the tool contract, not a live
model's choice of continuation arguments or a browser journey.
