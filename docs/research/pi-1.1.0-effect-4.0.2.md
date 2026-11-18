# Pi 1.1.0 and Effect 4.0.2 upgrade

Pi moves from 1.0.4 to an exact 1.1.0 pin. Effect/platform-node move from
4.0.0-rc.118 to stable 4.0.2. Per user preference, root and web Effect declarations
use `^4.0.2`, allowing later compatible 4.x releases; the lockfile retains 4.0.2.
`npm ls` confirms a single deduplicated version. The lockfile updates Pi's
companion packages, platform-node-shared and its required @types/ws version.
No application API changes were needed.

Pi's published `CHANGELOG.md` for 1.1.0 adds `aborted` to `agent_settled` and
reports MCP OAuth cancellation/shutdown fixes. Piano's existing settled-event
handling remains compatible in the exercised abort journey. These checks do
not independently reproduce upstream OAuth/provider fixes.

## Effect changelog review: rc.118 → 4.0.2

Reviewed the 4.0.0, 4.0.1 and 4.0.2 sections of the upstream
[Effect changelog](https://github.com/Effect-TS/effect/blob/effect%404.0.2/packages/effect/CHANGELOG.md),
[Node changelog](https://github.com/Effect-TS/effect/blob/effect%404.0.2/packages/platform/node/CHANGELOG.md)
and [Node-shared changelog](https://github.com/Effect-TS/effect/blob/effect%404.0.2/packages/platform/node-shared/CHANGELOG.md).
The release tag resolves to `269a7c864351231d42e6e95b7fa8f32050df3691`.
Piano inspected at `dc9d251`. **No additional application migration is indicated.**

- **Breaking RC-to-stable changes:** partition/separate helpers now return
  successes before failures; Schema branding is type-only and accepts one
  concrete identifier; TestSchema renames its roundtrip assertion; Queue taker
  internals and encoded Effect RPC interruption IDs change. Piano does not use
  these APIs/internals. Its Pi RPC is not Effect RPC. Existing `effect/http`,
  `effect/socket` and `effect/process` imports already use the v4 paths.
- **WebSockets:** 4.0.0 chooses close codes 1000/1001/1011 from the handler exit
  while preserving explicit codes. `web/src/lib/ws.ts` reconnects for these codes
  and retains special handling of explicit 1009/1013. Node 4.0.1 fails refused
  upgrades instead of hanging; 4.0.2 reports successful upgrades as HTTP 101.
  No wire or reconnect change is needed. Keep reader-before-writer acquisition.
- **Shutdown:** Node-shared 4.0.1 honors `forceKillAfter` for surviving descendants
  after a nonzero leader exit. `server/PiSessions.ts` already sets one second.
  Node 4.0.2 fixes keep-alive shutdown by retaining request handlers until shutdown
  completes ([patch](https://github.com/Effect-TS/effect/pull/8846)); it does not
  replace Piano's explicit upgraded-socket drain in `server/main.ts`.
- **Concurrency:** fixes to race loser interruption, Queue cancellation/shutdown,
  PubSub delivery ordering and scope finalization directly benefit PiSessions,
  BoundedDelivery, Broadcast and SessionHosts without call-site changes. Capacities
  are already positive integers. The host observer's `Effect.retry({})` still
  retries typed delivery overflow; the new refusal to retry mixed defect or
  interruption causes does not require restoring the old unsafe behavior.
- **HTTP/Schema:** static-file If-Range validation and lazy file streams improve
  the built-UI serving path. Schema parser reuse fixes require no schema changes.
  AI/SQL/Atom/Effect-RPC migrations and tracing dashboard renames do not apply to
  Piano's current integrations; Pi owns model and MCP behavior.
- **Version policy:** upstream explicitly identifies 4.0.0 as the first stable v4
  release, requires matching Effect package versions and TypeScript ≥5.9.
  Piano meets these requirements. Stable release does not mean every module is
  stable: 4.0.2 marks HTTP and ChildProcess APIs `@stability unstable`, permitting
  breaking changes in minor releases. The requested `^4.0.2` ranges allow these
  minor releases, so keep Effect packages aligned and run deliberate upgrade
  checks when updating the lockfile. A range alone does not establish compatibility.

This follow-up is documentation-only: source/changelog inspection and link review,
with the existing upgrade verification below retained rather than rerun. Individual
upstream race and keep-alive fixes were not independently reproduced.

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

Range follow-up: tested `2126d46` plus the `^4.0.2` declaration/lockfile-metadata
changes on the same Node/runtime versions. `npm test`, `npm run typecheck` and
`npm run lint` passed again (`/tmp/piano-bump-deps/ranges-*.log`). No resolved
package changed, so the earlier browser evidence still covers the runtime;
no additional browser run or regression test was needed.
