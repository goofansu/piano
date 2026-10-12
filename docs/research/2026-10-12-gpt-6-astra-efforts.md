# Missing xhigh/max effort for `exe-dev-openai/gpt-6-astra@llm`

## Claim

On the `pi-piano` host, Piano's model picker offers `off, minimal, low, medium, high`
for `exe-dev-openai/gpt-6-astra@llm`, while `yejun-dev` offers `low, medium, high, xhigh, max`.
The cause is the exe.dev Pi extension adapter, not Piano and not the installed Pi packages:
the `pi-piano` copy of `integration_catalog.ts` drops `thinkingLevelMap` when it builds a
`ProviderModelConfig` from an integration model, so Pi sees a reasoning model with no effort
table and applies its default effort set.

## Evidence (read-only offline RPC, no running instance touched)

`.scratch/reasoning-effort/compare.py` ran `pi --mode rpc --offline --no-session --no-approve`
on both hosts, issued one `get_available_models`, and recorded the Astra entry plus SHA-256 of
the files in the derivation chain. Output: `.scratch/reasoning-effort/rpc-comparison.json`.

| | `yejun-dev` | `pi-piano` |
| --- | --- | --- |
| `reasoning` | `true` | `true` |
| `thinkingLevelMap` | `{off: null, minimal: null, low, medium, high, xhigh, max}` | absent |
| supported efforts | `low, medium, high, xhigh, max` | `off, minimal, low, medium, high` |
| `server/PiRecords.ts` SHA-256 prefix | `7cb5efcadcd9` | `7cb5efcadcd9` |
| `pi-ai/dist/models.js` SHA-256 prefix | `0911bab24272` | `0911bab24272` |
| `extensions/exe-dev/integration_catalog.ts` SHA-256 prefix | `11d3fe78fda4` | `db66474470e0` |

The compared Piano decoder and Pi effort-derivation files are byte-identical across the
hosts. Both installed Pi packages (`@earendil-works/pi-coding-agent` and
`@earendil-works/pi-ai`) report 1.1.0. The adapter differs; the controlled fixture below
isolates its effect without assuming that all other host configuration is identical.

## The two-line difference

Captured copies: `.scratch/reasoning-effort/{yejun-dev,pi-piano}-integration_catalog.ts`
(from `~/.pi/agent/extensions/exe-dev/integration_catalog.ts` on each host).
`diff` reports exactly two added lines on `yejun-dev`:

```diff
@@ CatalogModel (pi-piano line 24)
   reasoning?: boolean;
+  thinkingLevelMap?: ProviderModelConfig["thinkingLevelMap"];
@@ configFromIntegrationModel (pi-piano line 348)
     reasoning: fallback?.reasoning ?? false,
+    ...(fallback?.thinkingLevelMap ? { thinkingLevelMap: fallback.thinkingLevelMap } : {}),
```

`configFromIntegrationModel` (pi-piano copy, lines 330–356) composes each integration model from
the live integration listing plus a `fallback` entry looked up in the bundled pricing catalog
(`fallbackCatalogModel`, lines 321–328). It already forwards `reasoning`, `input`,
`contextWindow`, `maxTokens`, `cost` and `compat` from that fallback. Without the two lines
above, `thinkingLevelMap` never reaches Pi through this translation, and the
`CatalogModel` type does not declare it.

## Why dropping the map changes the offered efforts

1. Pi composes extension-registered models through
   `node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:132-148`
   (`extensionModelFromDefinition` spreads the definition as given — nothing restores a
   missing `thinkingLevelMap`).
2. `get_available_models` returns those model objects verbatim
   (`dist/modes/rpc/rpc-mode.js:381-383`).
3. The effort set is derived by `getSupportedThinkingLevels`
   (`node_modules/@earendil-works/pi-ai/dist/models.js:678-689`): a non-reasoning model gets
   `["off"]`; a level mapped to `null` is removed; `xhigh` and `max` require an explicit entry.
   With `reasoning: true` and **no** map, every base level survives and the two top levels are
   unreachable — exactly `off, minimal, low, medium, high`. With the upstream OpenAI map
   (`off: null`, `minimal: null`, rest mapped), the result is `low, medium, high, xhigh, max`.
4. Piano reproduces that rule rather than inventing one: `server/PiRecords.ts:687-696` decodes
   `reasoning` and `thinkingLevelMap`, `:709-718` is a line-for-line copy of
   `getSupportedThinkingLevels`, and `:742-765` emits `ModelChoice.thinkingLevels` in Pi's order.
   The client only displays and clamps within that set (`web/src/lib/modelChoice.ts:34-48`).
   `@llm` in the model id is ordinary id text; no special handling exists in Piano or Pi.

So Piano faithfully reports what Pi advertises, and Pi advertises what the adapter registered.

## Scope and caveats

- The probe issued one RPC query per host in a separate offline process with `--no-session`;
  no inference was requested. No backend restart, deployment, registry edit or intentional
  configuration write was performed. Probe processes were terminated after the response.
- The existing browser menus and inference at `xhigh`/`max` were not independently exercised;
  the observed RPC metadata and controlled fixture reproduce the supplied screenshots.
- `yejun-dev` moved from `2c23cb0` to `1f3a5dd` during the investigation (both hosts started at
  `2c23cb0`). The recorded hashes show `server/PiRecords.ts` and `pi-ai/dist/models.js` stayed
  identical across that change, so the concurrent source change does not affect the comparison;
  the Piano revisions in `rpc-comparison.json` nevertheless differ by that commit.

## Controlled fixture probe

`node .scratch/reasoning-effort/adapter-fixture.mjs` passed. It supplies the same synthetic
integration listing and pricing fallback, including Astra's exact effort map, to
`providerInfosFromIntegrationCatalogs` in each captured adapter. The output models then pass
through Pi 1.1.0's actual `getSupportedThinkingLevels`, not a reimplementation.
The yejun-dev adapter produces `low, medium, high, xhigh, max`; the pi-piano adapter drops the
map and produces `off, minimal, low, medium, high`. Assertions protect both results.
Output: `.scratch/reasoning-effort/adapter-fixture-output.txt`. No network or inference is used.

## Relationship to issue #2

[goofansu/piano#2](https://github.com/goofansu/piano/issues/2), **exe.dev Pi extension loses
reasoning capability and supported effort levels**, remains open. Its body explicitly tracks
two faults: missing reasoning flags in the sidecar and dropped `thinkingLevelMap` in the
adapter. Both current Astra entries have `reasoning: true`, so this discrepancy is the second
fault, not the original `off`-only symptom. The two added lines on yejun-dev match the local
workaround documented in the issue; their installation provenance was not established.
`gh issue view 2 --repo goofansu/piano` and `issue-graph 2 --repo goofansu/piano --no-snapshot`
returned no comments or linked PRs. That does not establish the upstream extension's status.

## Implications

- No change is indicated in Piano: `PiRecords.ts` and `modelChoice.ts` already mirror Pi's rule,
  and a fix in Piano would mean diverging from `getSupportedThinkingLevels`.
- The remedy belongs in the exe.dev adapter on `pi-piano` (carry `thinkingLevelMap` through
  `CatalogModel` and `configFromIntegrationModel`), i.e. bringing it to the `yejun-dev` version.
- The meaningful upstream regression check is that provider registration preserves the exact
  map, including `null` entries. Updating Pi alone or refreshing a catalog cannot repair a
  translator that discards the field.
- This is documentation-only research. No application tests/build were rerun; document/source
  review and the two focused probes cover the research claim. No fix was applied during research.

## Follow-up: align yejun-dev with pi-chat (user-requested)

The user subsequently identified `pi-chat.exe.xyz` as the extension reference and requested
correction of yejun-dev's divergence. Comparison found that pi-chat's adapter matches
pi-piano's unpatched copy. Of the extension's TypeScript files, `package.json` and
`catalog.json`, only three files differed on yejun-dev: `integration_catalog.ts`,
`integration_catalog.test.ts` and `catalog.json`. The sidecar on pi-chat also lacks Astra's map.

Those three files were restored byte-for-byte from pi-chat after checking their expected
pre-change hashes and backing up yejun-dev's originals to:
`/home/exedev/.pi/agent/extension-backups/exe-dev-before-pi-chat-align-20261012T060708Z`.
No credentials, preferences, unrelated extension files or backend processes were changed.
This removes the local workaround; it **does not fix issue #2**.

Observed separate offline, non-persisted terminal Pi 1.1.0 RPC processes before and after:
`python3 .scratch/reasoning-effort/pi-chat-reference/verify.py before` reported divergence;
`... verify.py after` passed, with all three hashes and Astra's metadata matching pi-chat.
Both now advertise `reasoning: true`, no map and `off, minimal, low, medium, high`.
Evidence: `.scratch/reasoning-effort/pi-chat-reference/{before,after}.json`.
The restored extension's `node --test *.test.ts` passed **26/26**; output is
`.scratch/reasoning-effort/pi-chat-reference/extension-tests.txt`.
Existing Piano catalogs and already-running Pi sessions were not refreshed or browser-tested;
they may retain their previous metadata until refreshed/recreated. No deployment or restart.
