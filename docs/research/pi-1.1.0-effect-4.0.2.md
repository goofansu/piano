# Pi 1.1.0 and Effect 4.0.2 upgrade

Exact pins move Pi from 1.0.4 to 1.1.0 and Effect/platform-node from
4.0.0-rc.118 to stable 4.0.2. The web workspace also pins Effect 4.0.2;
`npm ls` confirms a single deduplicated version. The lockfile updates Pi's
companion packages, platform-node-shared and its required @types/ws version.
No application API changes were needed.

Pi's published `CHANGELOG.md` for 1.1.0 adds `aborted` to `agent_settled` and
reports MCP OAuth cancellation/shutdown fixes. Piano's existing settled-event
handling remains compatible in the exercised abort journey. These checks do
not independently reproduce upstream OAuth/provider fixes.

## Verification — INV-12

Tested base `28cfaf4` plus this dependency diff on Node 24.21.0.
Local output is retained at `/tmp/piano-bump-deps/`:

- `npm test`: 90 passed, zero failures/skips, including real-Pi boundary checks.
- `npm run typecheck`, `npm run lint`, `npm run build`: passed.
- `git diff --check`: passed; dependency diff inspected for unrelated updates.
- `node /tmp/piano-bump-deps/browser-supported-script.mjs /tmp/piano-bump-deps/browser`:
  passed using `npx agent-browser`, scratch backend/UI on loopback 7171/7172,
  and a fixture wrapper importing the locked repository Pi CLI. Verified
  command/prompt handling, supported dialog answer after reload, project model
  and high thinking, project MCP disable override, native abort, explicit child
  exit and reload without replay. Evidence includes commands, screenshots,
  server logs, Pi facts and fixture environment. Zero paid model calls;
  scratch processes and fixture storage cleaned up.

The executed scratch script reuses the supported journey retained from the
1.0.4 upgrade, with its fixture import pointed at this checkout. The historical
`test/browser-phase0.mjs` still has documented expectation drift; startup-dialog
compatibility remains untested. External CLI overrides and real provider
credentials/authentication were not exercised. Existing coverage was sufficient
for these dependency-only changes, so no new regression test was added.

`npm audit` reports seven high findings; its JSON is retained alongside the
checks. This is not a general security cleanup. No service restart or deployment
was performed; the live registry and instance were left alone.
