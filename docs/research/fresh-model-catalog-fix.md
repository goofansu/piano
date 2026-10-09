# Fresh model catalog discovery

## Claim and cause

A configured Radius-compatible gateway with no cached catalog must appear on initial discovery,
and Refresh must read changed availability. Preserves INV-01 and INV-12: Pi owns credentials,
model metadata, CLI resource loading and model selection.

Pi 1.1.0 RPC starts a background catalog refresh but `get_available_models` reads a snapshot.
Piano's one-shot probe can finish before discovery. Repeated probes can also interrupt that
background refresh while it holds the model-store lock, delaying later startups.

The default CLI entry now awaits Pi's `ModelRuntime` catalog refresh with a 15-second bound,
then runs the normal CLI with startup network refresh disabled (`--offline`). This does not
put model inference offline. Explicit offline configuration and custom CLI overrides remain
untouched. Normal starts may take longer because discovery now completes before readiness.

## Evidence

Environment: Node on exe.dev, locked Pi 1.1.0; branch `fix-no-models` based on the revision
`a8af968`, plus `server/PiCli.ts`, `server/PiRpcCli.ts` and
`test/RealPiCatalog.test.ts`.

- Real CLI regression through `PiSessions.probe`, isolated agent directory, dummy credential,
  local Radius catalog, no inference or external fetches. Raw CLI fails the first-model
  assertion; bootstrapped CLI discovers `first`, then replaces it with `second`.
- Eight consecutive focused runs passed after preventing the redundant background refresh.
- `npm test`: 96 passed; `npm run typecheck` and `npm run lint`: passed.
- `agent-browser` against scratch backend 7171/UI 7172: choose scratch folder, observe
  `scratch-radius/first`, open model picker, change local catalog, click Refresh, observe
  only `scratch-radius/second` and enabled Refresh. Final output retained at
  `/tmp/piano-catalog-final-first.txt`, `/tmp/piano-catalog-final-refresh.txt` and
  `/tmp/piano-catalog-final-refresh.png` on the verification VM.
- Scratch processes/storage cleaned up; user's service and registry were not changed.

Limitations: no access to the reported new machine, no real Radius OAuth or exe.dev integration
roundtrip, and no inference call. This verifies discovery, not that arbitrary provider credentials
or integration configuration are valid. CLI overrides intentionally bypass the workaround.
