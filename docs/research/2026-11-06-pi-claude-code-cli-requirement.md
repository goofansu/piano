# Does pi-claude-code load models without the Claude CLI?

Research date: 2026-11-06. Source: `earendil-works/pi-claude-code` at
`d5b5e04c314d3452d357174d16d10dda34daa2d2` (current checkout after forced librarian
refresh; package version `0.1.0`). This is source inspection, not a live inference test.

## Answer

**It loads model definitions, but does not make them usable without Claude Code.**
The extension unconditionally registers the `claude-code` provider with a built-in
fallback catalog. Its authentication check returns unconfigured when the executable
is missing or not logged in, explicitly so Pi hides those models from normal available-model
selection. A raw/unfiltered catalog can therefore contain Claude Code models even though
they cannot run. Account-specific discovery and inference both require an external Claude
Code executable. [S1–S5]

This answer concerns this extension's **Claude Code Subscription (Experimental)** provider,
not independently configured Anthropic providers. The catalog borrows Anthropic model
metadata but explicitly changes the provider, API and base URL to the Claude Code process
transport; that is not a direct-API fallback. [S2, S3]

## Evidence and caveats

| Layer | Behavior without a resolvable Claude CLI | Primary evidence |
| --- | --- | --- |
| Extension/provider registration | Still registers the provider and static model definitions; no executable check gates registration. | [S1], [S2], [S3] |
| Normal available-model selection | Auth check returns `undefined` when unavailable or logged out; the source explicitly says this hides the models in Pi. Registration is not readiness. | [S2], [S4] |
| Account catalog discovery | Resolves the CLI, then throws the install hint if absent. With a CLI, starts `claude -p`, initializes it and sends `shouldQuery: false`; this is a catalog probe, not inference. | [S5] |
| New inference worker | Requires a resolvable, logged-in CLI, then spawns it with `-p` and stream-JSON arguments. No CLI means failure, not a switch to another backend. | [S6], [S7] |

### Executable and packaging

- `PI_CLAUDE_CODE_COMMAND` selects an executable path or name; otherwise the name is
  `claude`. A path containing separators is resolved directly; a bare name is searched
  on `PATH` (with `PATHEXT` handling on Windows). Merely lacking a *global* CLI installation
  is not fatal if an executable is available through that override or `PATH`. [S8]
- The package does **not** bundle/install Claude Code or the Claude Agent SDK: its manifest
  has Pi peer/dev dependencies, no runtime CLI/SDK dependency or install script, and its
  tracked files contain the adapter, not a Claude binary. The resolver does not download a
  CLI or look for an SDK-bundled one. Missing resolution produces the explicit install-or-set-
  `PI_CLAUDE_CODE_COMMAND` hint. [S8, S9]

### Authentication and fallbacks

- Claude Code owns authentication. The adapter invokes `claude auth status`; no executable
  means `available: false`, while a CLI without `loggedIn: true` is not ready. Its Pi login
  hook tells the user to run `claude auth login` externally rather than importing credentials.
  The `external-process` API key and OAuth marker are transport/UI markers, not credentials
  that replace the CLI. [S2, S4]
- The advertised requirement is a Claude subscription. More precisely, the code's readiness
  gate checks `loggedIn`, not subscription status; it uses `subscriptionType` to label a
  subscription login. This is not proof that any particular account/model will be entitled
  to inference. [S4, S6, S10]
- Child environments strip `ANTHROPIC_API_KEY`; request/discovery setup rejects configured
  auth-token/base-URL and Bedrock/Vertex/Foundry overrides. The built-in fallback catalog is
  **metadata only**, not alternative authentication or inference. [S3, S11a, S11b]
- Successful readiness checks are cached for 60 seconds. Removing a CLI/login during a
  running session need not instantly update every view or existing worker; that does not
  provide a CLI-free inference path. [S6]

## Scope

Inspected the clean librarian checkout, manifest, tracked file list, registration, catalog,
executable resolver, status/discovery and worker-launch code. The extension-loading test also
asserts registration has models, but was only read, not run. [S12] The visibility conclusion
is the extension's explicit available-model contract, not an observed Piano/browser journey;
host versions, unfiltered lists or stale UI state can differ. No Claude installation/login,
credential inspection, model calls, application tests, deployment or running Piano/database
changes were performed. Documentation review is sufficient for this research-only change.

## Permanent sources

All links pin the inspected commit, rather than a moving branch.

- [S1 — unconditional extension registration](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/index.ts#L5-L18).
- [S2 — provider auth, static catalog and discovery hooks](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/provider.ts#L34-L110).
- [S3 — fallback definitions and explicit process transport](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/model-catalog.ts#L30-L153).
- [S4 — CLI auth-status and missing-executable result](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/claude-cli.ts#L220-L271).
- [S5 — CLI-only model discovery](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/claude-cli.ts#L317-L413).
- [S6 — cached readiness gate](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/claude-cli.ts#L273-L305).
- [S7 — inference worker launch](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/claude-cli.ts#L970-L1036).
- [S8 — install hint and executable resolution](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/claude-cli.ts#L24-L136).
- [S9 — complete package manifest](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/package.json#L1-L48).
- [S10 — documented requirements and external login](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/README.md#L26-L63).
- [S11a — API-key stripping and config-directory override](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/claude-cli.ts#L154-L165).
- [S11b — conflicting backend/auth rejection](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/src/claude-cli.ts#L563-L582).
- [S12 — registration test, inspected only](https://github.com/earendil-works/pi-claude-code/blob/d5b5e04c314d3452d357174d16d10dda34daa2d2/tests/extension-loading.test.ts#L12-L25).
