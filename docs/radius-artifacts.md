# Radius artifact tools

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

## Confirmation and uncertainty

**No mutation is automatically retried.** Repeating an operation key only reads to reconcile; a
new key is for new, reviewed work, never a retry workaround. A create response that leaves no ID
returns `unknown` and is not created again. An intent is not confirmation. No local-file
fallback exists.

## Verification boundary

Regression tests use real Pi credential resolution and the real MCP SDK against an isolated HTTP
adapter, with fake credentials. Live Radius publication, private-link browser access, quotas and
transfer-host behavior remain unverified until separately authorized.
